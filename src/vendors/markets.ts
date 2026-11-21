import { sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";
import {
	activeTerritory,
	nextPeople,
	nextRef,
	nextVendorCategory,
} from "./read.ts";

const MARKET_CAP = 100;
const MEMBERSHIP_CAP = 5000;

// The old schema's check: 1 to 200 code points, at least one not a space.
export const isMarketName = (market: string) => {
	const length = [...market].length;
	return length >= 1 && length <= 200 && /\S/u.test(market);
};

type Registry = {
	market_count: number;
	membership_count: number;
	selected_market: string | null;
	markets: unknown[];
	vendors: unknown[];
};

// One row more than each cap is read, so an over-cap registry is refused, never cut.
const registry = (alias: string | null) => sql<Registry>`with
	markets as materialized (
		select t.id, t.name from territory t
		where exists (select from territory_piece tp where tp.territory_id = t.id and tp.market_id is not null)
		order by t.name, t.id limit ${MARKET_CAP + 1}),
	memberships as materialized (
		select distinct on (pt.territory_id, pt.party_id)
			pt.territory_id as market_slug, pt.party_id as vendor_id,
			coalesce(r.has_office, false) as office_presence, r.coverage as service_coverage,
			r.source, coalesce(r.reviewed_by_user_id::text, r.reviewed_by_job) as reviewed_by, r.reviewed_at
		from party_territory pt
		join markets m on m.id = pt.territory_id
		join party_role pr on pr.party_id = pt.party_id and pr.role = 'vendor'
		left join party_territory_review r on r.party_territory_id = pt.id
		where (${activeTerritory}) and (pt.started_on is null or pt.started_on <= (now() at time zone 'America/Chicago')::date)
		order by pt.territory_id, pt.party_id, pt.started_on desc nulls last
		limit ${MEMBERSHIP_CAP + 1})
	select (select count(*)::int from markets) as market_count,
		(select count(*)::int from memberships) as membership_count,
		(select id from markets where id::text = ${alias}
			or id = md5('old_system:market_territory:' || ${alias})::uuid
			order by (id::text = ${alias}) desc limit 1) as selected_market,
		coalesce((select jsonb_agg(jsonb_build_object(
			'slug', m.id, 'name', m.name, 'kind', 'market', 'boundary', '', 'source', '',
			'reviewed_by', null, 'reviewed_at', null, 'aliases', jsonb_build_array(m.id),
			'vendor_count', (select count(*)::int from memberships x where x.market_slug = m.id),
			'memberships', coalesce((select jsonb_agg(to_jsonb(x) order by x.vendor_id)
				from memberships x where x.market_slug = m.id), '[]'),
			'regional_references', '[]'::jsonb
		) order by m.name, m.id) from markets m), '[]') as markets,
		coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'ref', ${nextRef},
			'category', cat.slug, 'name', p.name, 'people', ${nextPeople},
			'market_slugs', (select jsonb_agg(x.market_slug order by x.market_slug)
				from memberships x where x.vendor_id = p.id)) order by p.id)
		from party p left join lateral ${nextVendorCategory} cat on true
		where p.id in (select vendor_id from memberships)), '[]') as vendors`;

export async function readVendorMarkets(
	db: Transaction<DB>,
	market: string | null,
) {
	const alias = market === null ? null : market.trim().toLowerCase();
	const [found] = (await registry(alias).execute(db)).rows;
	if (!found) throw new Error("The registry query returned no row");
	if (
		found.market_count > MARKET_CAP ||
		found.membership_count > MEMBERSHIP_CAP
	)
		return { error: "vendor_market_capacity_exceeded" } as const;
	if (
		alias !== null &&
		found.market_count > 0 &&
		found.selected_market === null
	)
		return { error: "vendor_market_not_found" } as const;
	return {
		ok: true,
		schema_version: "vendor-markets.v1",
		state: found.market_count === 0 ? "empty" : "ready",
		selected_market: found.selected_market,
		markets: found.markets,
		vendors: found.vendors,
	};
}
