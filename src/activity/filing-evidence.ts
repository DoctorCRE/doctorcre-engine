import { type Expression, sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";

export type About =
	| { deal_id: string }
	| { party_id: string }
	| { property_id: string };

export const filingReviewEvidence = "Needs filing review.";
export const filingReviewTitle = "Review where to file this email";

// Home also reads databases where the filing judgment migration is still pending.
export const filingScope = (proposal: string) =>
	sql<string | null>`to_jsonb(${sql.ref(proposal)})->>'filing_scope'`;

export function filingChoices(scope: string | null | undefined) {
	return [
		...(scope === "deal" || scope === "both"
			? [{ kind: "deal", label: "Choose deal" }]
			: []),
		...(scope === "vendor" || scope === "both"
			? [{ kind: "vendor", label: "Choose vendor" }]
			: []),
	];
}

export const filingReceiptKey = (activityId: Expression<string | null>) =>
	sql<string>`md5('email_filing:' || ${activityId}::uuid)::uuid`;

export function hasFiledFacts(
	activityId: Expression<string | null>,
	toDeal = false,
) {
	return sql<boolean>`exists (select from save_receipt r
		where r.idempotency_key = ${filingReceiptKey(activityId)} and r.verb = 'file-email-facts'
			and (not ${toDeal} or r.answer->>'deal_id' is not null))`;
}

function partnerUnlinked(
	activityId: Expression<string | null>,
	target: Expression<unknown>,
) {
	return sql<boolean>`exists (
		select from change removed
		where removed.table_name = 'activity_about' and removed.action = 'delete'
			and removed.changed_by_user_id is not null
			and removed.old_value->>'activity_id' = ${activityId}::uuid::text
			and removed.old_value @> ${target}
	)`;
}

export function filingReviewNeeded(
	activityId: Expression<string | null>,
	dealId: Expression<string | null>,
) {
	return sql<boolean>`not exists (
		select from activity_about filed
		where filed.activity_id = ${activityId} and filed.deal_id = ${dealId}
	) and not ${partnerUnlinked(
		activityId,
		sql`jsonb_build_object('deal_id', ${dealId})`,
	)} and not ${hasFiledFacts(activityId, true)}`;
}

export async function eligibleMailLinks(
	tx: Transaction<DB>,
	activityId: string,
	about: About[],
	allowConflictingDeals = false,
) {
	if (!about.length) return about;
	const { rows } = await sql<{ link: About }>`
		select jsonb_strip_nulls(to_jsonb(candidate)) as link
		from jsonb_to_recordset(${JSON.stringify(about)}::jsonb)
			candidate(deal_id uuid, party_id uuid, property_id uuid)
		where not ${partnerUnlinked(sql.val(activityId), sql`jsonb_strip_nulls(to_jsonb(candidate))`)}
			and (${allowConflictingDeals} or not exists (
				select from activity_about filed
				where filed.activity_id = ${activityId} and filed.deal_id <> candidate.deal_id
			))
			and not exists (
				select from proposal p
				where p.activity_id = ${activityId} and p.deal_id = candidate.deal_id
					and p.kind = 'file_to_deal' and p.status = 'dismissed'
			)
	`.execute(tx);
	return rows.map(({ link }) => link);
}

export async function knownMailDestination(
	tx: Transaction<DB>,
	{
		conversation_id,
		sender,
	}: { conversation_id: string | null; sender: string },
	firstDelivery: boolean,
) {
	const {
		rows: [destination],
	} = await sql<{ link: About }>`
		with thread_deals as (
			select distinct about.deal_id
			from email
			join activity_about about using (activity_id)
			where email.conversation_id = ${conversation_id}
				and about.deal_id is not null
			limit 2
		), senders as (
			select party_id from party_email where ${firstDelivery} and address = ${sender} limit 2
		), sender_vendors as (
			select role.party_id
			from senders s
			join party_role role on role.role = 'vendor' and (
				role.party_id = s.party_id or exists (
					select from party_company pc
					where pc.person_id = s.party_id and pc.company_id = role.party_id
						and pc.ended_on is null and (pc.started_on is null or pc.started_on <= current_date)
				)
			)
			where (select count(*) from senders) = 1
				and not exists (select from app_user where id = s.party_id)
			limit 2
		), destinations as (
			select jsonb_build_object('deal_id', d.deal_id) as link
			from thread_deals d
			where (select count(*) from thread_deals) = 1
				and coalesce((
					select phase from deal_phase_change
					where deal_id = d.deal_id order by happened_at desc limit 1
				), '') not in ('closed', 'dead')
			union all
			select jsonb_build_object('party_id', v.party_id)
			from sender_vendors v
			where not exists (select from thread_deals)
				and (select count(*) from sender_vendors) = 1
		)
		select link from destinations
	`.execute(tx);
	return destination?.link;
}
