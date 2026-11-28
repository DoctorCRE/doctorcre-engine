import { sql } from "kysely";

export const activeTerritory = sql`pt.ended_on is null or pt.ended_on >= (now() at time zone 'America/Chicago')::date`;

export const vendorTerritories = (party: ReturnType<typeof sql.ref>) =>
	sql`select pt.territory_id from party_territory pt
		where pt.party_id = ${party} and (${activeTerritory})`;

type Market = { id: string; name: string };

export const vendorMarkets = (party: ReturnType<typeof sql.ref>) =>
	sql<Market>`select m.id, m.name from market m where exists (
		select from (${vendorTerritories(party)}) t
		join territory_piece piece on piece.territory_id = t.territory_id
		where piece.market_id = m.id or exists (
			select from market_county mc
			where mc.market_id = m.id and left(mc.county_fips, 2) = piece.state_fips
		)
	)`;
