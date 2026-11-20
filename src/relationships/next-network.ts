import { sql, type Transaction } from "kysely";
import { selectNextDeals } from "../deals/next-board.ts";
import type { DB } from "../next-database.d.ts";
import type { Snapshot } from "./network.ts";

// The app rejects names consisting only of characters removed by String.trim().
const nameWhitespace =
	"\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

export async function readNextNetwork(db: Transaction<DB>) {
	const deals = db
		.selectFrom(selectNextDeals(db).as("board"))
		.select(["id", "name", "owner", "phase", "outcome", "market", "client_id"]);
	const network = sql<Snapshot>`
		(with parties as (
			select * from party where btrim(name, ${nameWhitespace}) <> ''
		), deals as (
			select * from (${deals}) d where btrim(d.name, ${nameWhitespace}) <> ''
		), introductions as (
			select i.*, coalesce(i.introduced_on::timestamptz, i.created_at) as happened_at,
				nullif(nullif(i.introduced_by_user_id, i.introduced_party_id), i.vendor_id) as via
			from introduction i join parties v on v.id = i.vendor_id
			join parties p on p.id = i.introduced_party_id
		), credits (party_id, deal_id, kind, happened_at, summary, detail) as (
			select i.vendor_id, i.deal_id, 'referred', i.happened_at, 'referred',
				concat_ws(' · ', i.happened_at::date, i.note)
			from introductions i join deals d on d.id = i.deal_id where i.made_by = 'vendor'
			union all
			select p.party_id, p.deal_id,
				case when p.role = 'client' then 'client_deal'
					when r.slug = 'vendor' or r.category_of = 'vendor' then 'worked'
					else 'works_with' end,
				null, case when p.role = 'client' then d.phase else r.label end,
				case when p.role <> 'client' then concat(r.label, ' (recorded ', p.created_at::date, ')') end
			from deal_party p join role r on r.slug = p.role join deals d on d.id = p.deal_id
			join parties party on party.id = p.party_id
		), deal_edges as (
			select party_id, deal_id, kind, min(happened_at) as happened_at,
				string_agg(distinct summary, ', ' order by summary) as summary,
				string_agg(distinct detail, chr(10) order by detail) as detail
			from credits group by party_id, deal_id, kind
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
				'territory', coalesce((select t.name from party_territory pt join territory t on t.id = pt.territory_id
					where pt.party_id = p.id and (pt.started_on is null or pt.started_on <= current_date)
						and (pt.ended_on is null or pt.ended_on > current_date)
					order by exists (select from outside_id o where o.source = 'old_system' and o.party_id = p.id
						and t.id = md5('old_system:vendor_territory:' || o.value)::uuid) desc, t.name limit 1), p.city),
				'verticals', coalesce(
					(select array_agg(vertical order by vertical) from vendor_vertical where party_id = p.id),
					array_remove(array[coalesce(cv.vertical, l.segment)], null)),
				'owner', owner.slug, 'summary', coalesce(v.offers, (
					select a.summary from outside_id o
					cross join (values ('client', cr.party_id), ('lead', l.party_id)) origin(role, party_id)
					join activity a on a.id = md5('old_system:' || origin.role || ':' || o.value || ':notes')::uuid
					join activity_about ab on ab.activity_id = a.id and ab.party_id = o.party_id
					where o.source = 'old_system' and o.party_id = origin.party_id and a.kind = 'note'
					order by origin.role, a.happened_at desc, a.id limit 1)),
				'contact_state', case when held.party_id is null then 'active'
					when held.until_date is null then 'do_not_contact' else 'paused' end,
				'contact_state_until', held.until_date,
				'restricted', v.disposition is not distinct from 'avoid') as item
			from parties p
			left join party_role v on v.party_id = p.id and v.role = 'vendor'
			left join party_role cr on cr.party_id = p.id and cr.role = 'client'
			left join client c on c.party_id = cr.party_id
			left join client_vertical cv on cv.party_id = p.id
			left join party_role l on l.party_id = p.id and l.role = 'lead'
			left join app_user owner on owner.id = coalesce(v.owner_user_id, c.owner_user_id, l.owner_user_id)
			left join active_do_not_contact held on held.party_id = p.id
			union all
			select jsonb_build_object(
				'id', 'deal:' || d.id, 'record_id', d.id, 'name', d.name, 'kind', 'deal',
				'territory', d.market, 'verticals', array_remove(array[cv.vertical], null),
				'owner', d.owner, 'summary', d.phase, 'outcome', d.outcome, 'contact_state', 'active')
			from deals d left join client_vertical cv on cv.party_id = d.client_id
		), edges (id, "from", "to", via, kind, "when", summary, detail) as (
			select 'link:' || l.id, 'party:' || l.party_id, 'party:' || l.other_party_id, null,
				l.kind, coalesce(l.started_on::timestamptz, l.created_at), left(coalesce(l.note, ''), 180), l.note
			from party_link l join parties f on f.id = l.party_id join parties t on t.id = l.other_party_id
			where (l.started_on is null or l.started_on <= current_date)
				and (l.ended_on is null or l.ended_on > current_date)
			union all
			select 'introduction:' || i.id,
				'party:' || case when i.made_by = 'vendor' then i.vendor_id else i.introduced_party_id end,
				'party:' || case when i.made_by = 'vendor' then i.introduced_party_id else i.vendor_id end,
				'party:' || i.via, 'introduced', i.happened_at, left(i.note, 180), i.note
			from introductions i
			where i.via is null or exists (select from parties p where p.id = i.via)
			union all
			select 'deal-credit:' || e.party_id || ':' || e.deal_id || ':' || e.kind,
				'party:' || e.party_id, 'deal:' || e.deal_id, null, e.kind, e.happened_at, e.summary, e.detail
			from deal_edges e
		)
		select jsonb_build_object(
			'nodes', coalesce((select jsonb_agg(item order by item->>'name', item->>'id') from nodes), '[]'),
			'edges', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from edges e), '[]'),
			'referrals', coalesce((select jsonb_agg(to_jsonb(t) order by t.node_id) from (
				select 'party:' || r.party_id as node_id, count(*) as deals,
					count(*) filter (where d.outcome = 'won') as won,
					count(*) filter (where d.outcome = 'lost') as lost
				from deal_edges r join deals d on d.id = r.deal_id
				where r.kind = 'referred' group by r.party_id
			) t), '[]')))
	`;
	return (
		await db.selectNoFrom(network.as("snapshot")).executeTakeFirstOrThrow()
	).snapshot;
}
