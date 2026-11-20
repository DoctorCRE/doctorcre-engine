import { sql, type Transaction } from "kysely";
import { selectNextDeals } from "../deals/next-board.ts";
import type { DB } from "../next-database.d.ts";
import type { Snapshot } from "./network.ts";

export async function readNextNetwork(db: Transaction<DB>) {
	const deals = db
		.selectFrom(selectNextDeals(db).as("board"))
		.select(["id", "name", "owner", "phase", "outcome", "market", "client_id"]);
	const network = sql<Snapshot>`
		(with deals as (${deals}), introductions as (
			select id, created_at, vendor_id, made_by, introduced_party_id, introduced_on, deal_id, note
			from introduction
		), referrals as (
			select distinct vendor_id, deal_id from introductions
			where made_by = 'vendor' and deal_id is not null
		), nodes as (
			select jsonb_build_object(
				'id', 'party:' || p.id, 'record_id', p.id, 'name', p.name,
				'kind', case when v.party_id is not null then 'vendor'
					when cr.party_id is not null then 'client'
					when l.party_id is not null then 'lead' else 'contact' end,
				'ref', (select min(o.value) from outside_id o
					where o.source = 'old_system_ref' and o.party_id = p.id
						and left(o.value, 2) in ('V-', 'C-', 'L-', 'P-')
					group by left(o.value, 2) having count(*) = 1
					order by array_position(array['V-', 'C-', 'L-', 'P-'], left(o.value, 2)) limit 1),
				'territory', p.city,
				'verticals', coalesce(
					(select array_agg(vertical order by vertical) from vendor_vertical where party_id = p.id),
					array_remove(array[coalesce(cv.vertical, l.segment)], null)),
				'owner', owner.slug, 'summary', v.offers,
				'contact_state', case when held.party_id is null then 'active'
					when held.until_date is null then 'do_not_contact' else 'paused' end,
				'contact_state_until', held.until_date,
				'restricted', v.disposition is not distinct from 'avoid') as item
			from party p
			left join party_role v on v.party_id = p.id and v.role = 'vendor'
			left join party_role cr on cr.party_id = p.id and cr.role = 'client'
			left join client c on c.party_id = cr.party_id
			left join client_vertical cv on cv.party_id = p.id
			left join party_role l on l.party_id = p.id and l.role = 'lead'
			left join app_user owner on owner.id = coalesce(v.owner_user_id, c.owner_user_id, l.owner_user_id)
			left join do_not_contact held on held.party_id = p.id
			union all
			select jsonb_build_object(
				'id', 'deal:' || d.id, 'record_id', d.id, 'name', d.name, 'kind', 'deal',
				'territory', d.market, 'verticals', array_remove(array[cv.vertical], null),
				'owner', d.owner, 'summary', d.phase, 'outcome', d.outcome, 'contact_state', 'active')
			from deals d left join client_vertical cv on cv.party_id = d.client_id
		), edges (id, "from", "to", kind, "when", summary, detail) as (
			select 'link:' || l.id, 'party:' || l.party_id, 'party:' || l.other_party_id,
				l.kind, coalesce(l.started_on::timestamptz, l.created_at), left(coalesce(l.note, ''), 180), l.note
			from party_link l
			where (l.started_on is null or l.started_on <= current_date)
				and (l.ended_on is null or l.ended_on > current_date)
			union all
			select 'introduction:' || i.id,
				'party:' || case when i.made_by = 'vendor' then i.vendor_id else i.introduced_party_id end,
				'party:' || case when i.made_by = 'vendor' then i.introduced_party_id else i.vendor_id end,
				'introduced', coalesce(i.introduced_on::timestamptz, i.created_at), left(i.note, 180), i.note
			from introductions i
			union all
			select 'introduction-deal:' || i.id, 'party:' || i.vendor_id, 'deal:' || i.deal_id,
				'referred', coalesce(i.introduced_on::timestamptz, i.created_at), 'referred', i.note
			from introductions i where i.made_by = 'vendor' and i.deal_id is not null
			union all
			select case when p.role = 'client' then 'client-deal:' || p.deal_id
					else 'participant:' || p.deal_id || ':' || p.party_id || ':' || p.role end,
				'party:' || p.party_id, 'deal:' || p.deal_id,
				case when p.role = 'client' then 'client_deal'
					when r.slug = 'vendor' or r.category_of = 'vendor' then 'worked'
					else 'works_with' end,
				null, case when p.role = 'client' then d.phase else r.label end, null
			from deal_party p join role r on r.slug = p.role join deals d on d.id = p.deal_id
		)
		select jsonb_build_object(
			'nodes', coalesce((select jsonb_agg(item order by item->>'name', item->>'id') from nodes), '[]'),
			'edges', coalesce((select jsonb_agg(to_jsonb(e) || '{"via":null}'::jsonb order by e.id) from edges e), '[]'),
			'referrals', coalesce((select jsonb_agg(to_jsonb(t) order by t.node_id) from (
				select 'party:' || r.vendor_id as node_id, count(*) as deals,
					count(*) filter (where d.outcome = 'won') as won,
					count(*) filter (where d.outcome = 'lost') as lost
				from referrals r join deals d on d.id = r.deal_id group by r.vendor_id
			) t), '[]')))
	`;
	return (
		await db.selectNoFrom(network.as("snapshot")).executeTakeFirstOrThrow()
	).snapshot;
}
