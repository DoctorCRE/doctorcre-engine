import { sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";
import { selectNextDeals } from "./next-board.ts";

type ClientFitFilters = {
	vertical: string | null;
	city: string | null;
	state: string | null;
};
type Evidence = { deal_id: string; closed_on: string; deal_name: string };

const PROFILE_LIMIT = 1000;

export async function readClientFit(
	db: Transaction<DB>,
	filters: ClientFitFilters,
) {
	const profiles = await profilesOf(db, filters).execute();
	// The old system refused rather than cut the list short.
	if (profiles.length > PROFILE_LIMIT)
		return { error: "too_many_profiles" } as const;
	return {
		schema_version: "ideal-client-profile.v1",
		coverage: "recorded_closed_won_only",
		profiles: profiles.map((profile) => ({
			...profile,
			hypothesis: "Historical fit, not a prediction or qualification rule.",
		})),
	};
}

// Census ANSI state codes mapped to the USPS abbreviations used by the state filter.
const stateCodes = `{
	"01":"AL", "02":"AK", "04":"AZ", "05":"AR", "06":"CA", "08":"CO", "09":"CT",
	"10":"DE", "11":"DC", "12":"FL", "13":"GA", "15":"HI", "16":"ID", "17":"IL",
	"18":"IN", "19":"IA", "20":"KS", "21":"KY", "22":"LA", "23":"ME", "24":"MD",
	"25":"MA", "26":"MI", "27":"MN", "28":"MS", "29":"MO", "30":"MT", "31":"NE",
	"32":"NV", "33":"NH", "34":"NJ", "35":"NM", "36":"NY", "37":"NC", "38":"ND",
	"39":"OH", "40":"OK", "41":"OR", "42":"PA", "44":"RI", "45":"SC", "46":"SD",
	"47":"TN", "48":"TX", "49":"UT", "50":"VT", "51":"VA", "53":"WA", "54":"WV",
	"55":"WI", "56":"WY", "60":"AS", "66":"GU", "69":"MP", "72":"PR", "78":"VI"
}`;

const wins = (db: Transaction<DB>) =>
	db
		.selectFrom(selectNextDeals(db).select("d.market_id").as("d"))
		.leftJoin("client_vertical as cv", "cv.party_id", "d.client_id")
		.leftJoin("lease", "lease.deal_id", "d.id")
		.leftJoin("property as premises", "premises.id", "lease.property_id")
		.select([
			"d.id",
			"d.name",
			"d.client_id",
			"d.type as deal_type",
			"d.closed_on",
			"d.market as city",
			sql<
				string | null
			>`${stateCodes}::jsonb ->> coalesce(left(premises.county_fips, 2),
				(select min(left(mc.county_fips, 2)) from market_county mc where mc.market_id = d.market_id
					having count(distinct left(mc.county_fips, 2)) = 1))`.as("state"),
			sql<
				string | null
			>`coalesce(cv.vertical, (select string_agg(nullif(s.label, ''), ', ' order by s.label)
				from party_specialty ps join specialty s on s.slug = ps.specialty
				where ps.person_id = d.client_id))`.as("vertical"),
		])
		.where("d.client_id", "is not", null)
		.where("d.phase", "=", "closed")
		.where("d.outcome", "=", "won")
		.where(sql<string>`d.closed_on::date`, "<=", sql<string>`current_date`);

const profilesOf = (
	db: Transaction<DB>,
	{ vertical, city, state }: ClientFitFilters,
) =>
	db
		.with("wins", () => wins(db))
		.selectFrom("wins")
		.select((eb) => [
			"vertical",
			"deal_type",
			"city",
			"state",
			eb.cast<number>(eb.fn.countAll(), "integer").as("won_deals"),
			eb
				.cast<number>(eb.fn.count("client_id").distinct(), "integer")
				.as("clients"),
			sql<
				Evidence[]
			>`jsonb_agg(jsonb_build_object('deal_id', id, 'closed_on', closed_on, 'deal_name', name) order by closed_on, id)`.as(
				"evidence",
			),
		])
		.$if(vertical !== null, (q) => q.where("vertical", "=", vertical))
		.$if(city !== null, (q) => q.where("city", "=", city))
		.$if(state !== null, (q) => q.where("state", "=", state))
		.groupBy(["vertical", "deal_type", "city", "state"])
		.orderBy("won_deals", "desc")
		.orderBy("vertical")
		.orderBy("deal_type")
		.orderBy("city")
		.orderBy("state")
		.limit(PROFILE_LIMIT + 1);
