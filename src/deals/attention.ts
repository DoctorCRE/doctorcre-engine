import { sql } from "kysely";
import { ENDED_PHASES } from "./shared.ts";

// The deal and board reads share this. It uses the select's aliases
// (d, p, imported, last_close) and unqualified names, so a partner read
// hits the partner views and a job read hits the tables.
// First match wins, in the order in docs/new-database.md#deal-attention.
// A parked or ended deal stays on its list and answers null. The stored
// needs_attention flag is not read.
const importedCurrent = sql`imported.phase is not null
	and imported.phase_at is not distinct from p.happened_at`;
const openDeal = sql`d.parking_reason is null
	and not exists (select from deal_invoiced where deal_id = d.id)
	and (case when ${importedCurrent} then imported.outcome
		when p.phase is not distinct from 'dead' then 'lost'
		when last_close.happened_at is not null then 'won' end) is null
	and (case when ${importedCurrent} then imported.closed_on
		when p.phase = 'dead' then (p.happened_at at time zone 'America/Chicago')::date
		else (last_close.happened_at at time zone 'America/Chicago')::date end) is null
	and coalesce(case when ${importedCurrent} then imported.phase else p.phase end, '')
		not in (${sql.join(ENDED_PHASES)})`;

const central = (at: ReturnType<typeof sql>) =>
	sql`(${at} at time zone 'America/Chicago')::date`;

export const dealAttention = sql<{ reason: string; since: string } | null>`
	case when ${openDeal} then (
		select jsonb_build_object('reason', hit.reason, 'since', hit.since)
		from (select (now() at time zone 'America/Chicago')::date as today) days
		cross join lateral (
			select 1 as rank, 'A next step is late.' as reason,
				(min(s.due_on) + 1)::text as since
			from next_step s
			where s.deal_id = d.id and s.status = 'open' and s.item_title is null
				and s.due_on < days.today
			having min(s.due_on) is not null
			union all
			select 2, 'A critical date is within 7 days or past and not done.',
				(min(cd.due_on) - 7)::text
			from critical_date cd
			where cd.deal_id = d.id and cd.status in ('proposed', 'open')
				and cd.due_on <= days.today + 7
			having min(cd.due_on) is not null
			union all
			select 3, 'This deal has no next step and no suggestion.', quiet.since::text
			from (
				select max(day) as since from (
					select ${central(sql`d.created_at`)} as day
					union all
					select ${central(sql`s.done_at`)} from next_step s
					where s.deal_id = d.id and s.item_title is null and s.status <> 'open'
						and s.done_at is not null
					union all
					select ${central(sql`s.resolved_at`)} from next_step s
					where s.deal_id = d.id and s.item_title is null and s.status <> 'open'
						and s.resolved_at is not null
					union all
					select ${central(sql`pr.decided_at`)} from proposal pr
					where pr.deal_id = d.id and pr.status <> 'pending' and pr.decided_at is not null
				) earlier
			) quiet
			where not exists (
				select from next_step s
				where s.deal_id = d.id and s.status = 'open' and s.item_title is null
			) and not exists (
				select from proposal pr where pr.deal_id = d.id and pr.status = 'pending'
			)
			union all
			select 4, 'A client or broker email has had no answer for 2 working days.',
				min(waiting.due)::text
			from (
				select (
					select (${central(sql`a.happened_at`)} + walked.n)::date
					from generate_series(1, 21) as walked(n)
					where extract(isodow from ${central(sql`a.happened_at`)} + walked.n) < 6
					offset 1 limit 1
				) as due
				from activity_about ab
				join activity a on a.id = ab.activity_id and a.kind = 'email'
				join email e on e.activity_id = a.id
				where ab.deal_id = d.id
					and exists (
						select from deal_party dp
						join party_email pe on pe.party_id = dp.party_id and pe.address = e.sender
						where dp.deal_id = d.id
							and dp.role in ('client', 'client_contact', 'listing_agent', 'landlord_rep')
					)
					and not exists (
						select from app_user u
						join party_email pe on pe.party_id = u.id and pe.address = e.sender
						where u.is_account_partner
					)
					and not exists (
						select from activity_about reply_about
						join activity reply on reply.id = reply_about.activity_id and reply.kind = 'email'
						join email reply_email on reply_email.activity_id = reply.id
						join party_email pe on pe.address = reply_email.sender
						join app_user u on u.id = pe.party_id and u.is_account_partner
						where reply_about.deal_id = d.id and reply.happened_at > a.happened_at
							and (e.conversation_id is null or reply_email.conversation_id = e.conversation_id)
					)
			) waiting
			where waiting.due <= days.today
			having min(waiting.due) is not null
			union all
			select 5, 'A suggestion has waited 2 days.',
				(min(${central(sql`pr.created_at`)}) + 2)::text
			from proposal pr
			where pr.deal_id = d.id and pr.status = 'pending'
				and ${central(sql`pr.created_at`)} + 2 <= days.today
			having min(${central(sql`pr.created_at`)}) is not null
			union all
			select 6, 'Nothing has happened for 14 days.', (quiet.last_on + 14)::text
			from (
				select max(${central(sql`moment`)}) as last_on from (
					select d.created_at as moment
					union all
					select max(a.happened_at) from activity_about ab
					join activity a on a.id = ab.activity_id where ab.deal_id = d.id
					union all
					select max(s.created_at) from next_step s where s.deal_id = d.id
					union all
					select max(s.done_at) from next_step s where s.deal_id = d.id
					union all
					select max(pc.happened_at) from deal_phase_change pc where pc.deal_id = d.id
				) moments
			) quiet
			where quiet.last_on + 14 <= days.today
		) hit
		order by hit.rank
		limit 1
	) end
`;
