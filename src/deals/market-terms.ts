import { Hono } from "hono";
import { type RawBuilder, sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import type { DB } from "../next-database.d.ts";
import type { DatabaseEnv } from "../reader.ts";

// The figures a round and a signed lease version both record, in display order.
const TERMS = [
	"rent_per_sf_yr",
	"nnn_per_sf_yr",
	"ti_per_sf",
	"free_rent_months",
	"term_months",
	"escalation_pct",
] as const;

type Documents = { id: string; name: string }[];
type Filters = { market?: string; use_type?: string; as_of?: string };
const onOrBefore = (asOf: string | undefined, date: RawBuilder<unknown>) =>
	asOf ? sql<boolean>`${date} <= ${asOf}::date` : sql<boolean>`true`;

// A market's terms are those on properties in its counties (docs/new-database.md, Markets and territories).
const propertyMatches = ({ market, use_type }: Filters) => sql<boolean>`
	(${market ?? null}::text is null or exists (select from market_county mc join market m on m.id = mc.market_id
		where mc.county_fips = p.county_fips and lower(m.name) = lower(${market ?? null})))
	and (${use_type ?? null}::text is null or lower(btrim(p.building_type)) = lower(${use_type ?? null}))`;

const propertyOf = sql<{
	id: string;
	name: string | null;
	address: string;
}>`jsonb_build_object('id', p.id, 'name', p.name, 'address', p.address)`;

const termOf = (table: "o" | "v", term: (typeof TERMS)[number]) =>
	sql<number | null>`${sql.ref(`${table}.${term}`)}::float8`.as(term);

function rounds(db: Transaction<DB>, filters: Filters) {
	const offeredOn = sql`(o.offered_at at time zone 'America/Chicago')::date`;
	return db
		.selectFrom("offer as o")
		.innerJoin("deal as d", "d.id", "o.deal_id")
		.innerJoin("property as p", "p.id", "o.property_id")
		.select([
			sql.lit("round").$castTo<"round" | "lease">().as("stage"),
			"d.id as deal_id",
			"d.name as deal_name",
			propertyOf.as("property"),
			sql<number>`o.round`.as("number"),
			sql<string | null>`${offeredOn}::text`.as("recorded_on"),
			sql<string | null>`null::text`.as("expense_structure"),
			sql<boolean>`exists (select from offer later where later.deal_id = o.deal_id
					and later.property_id = o.property_id and later.round > o.round
					and ${onOrBefore(filters.as_of, sql`(later.offered_at at time zone 'America/Chicago')::date`)})`.as(
				"superseded",
			),
			...TERMS.map((term) => termOf("o", term)),
			sql<Documents>`(select coalesce(jsonb_agg(jsonb_build_object('id', doc.id, 'name', doc.name)
				order by doc.name, doc.id), '[]') from offer_document od join document doc on doc.id = od.document_id
				where od.offer_id = o.id)`.as("documents"),
		])
		.where(onOrBefore(filters.as_of, offeredOn))
		.where(propertyMatches(filters));
}

function leaseVersions(db: Transaction<DB>, filters: Filters) {
	return (
		db
			.selectFrom("lease_version as v")
			.innerJoin("lease as l", "l.id", "v.lease_id")
			.innerJoin("deal as d", "d.id", "l.deal_id")
			.innerJoin("property as p", "p.id", "l.property_id")
			.innerJoin("document as doc", "doc.id", "v.document_id")
			.select([
				sql.lit("lease").$castTo<"round" | "lease">().as("stage"),
				"d.id as deal_id",
				"d.name as deal_name",
				propertyOf.as("property"),
				sql<number>`v.version`.as("number"),
				sql<string | null>`v.executed_on::text`.as("recorded_on"),
				"v.expense_structure",
				// An amendment is the next version; one signed by the date replaces this one.
				sql<boolean>`exists (select from lease_version later where later.lease_id = v.lease_id
					and later.version > v.version
					and ${onOrBefore(filters.as_of, sql`later.executed_on`)})`.as(
					"superseded",
				),
				...TERMS.map((term) => termOf("v", term)),
				sql<Documents>`jsonb_build_array(jsonb_build_object('id', doc.id, 'name', doc.name))`.as(
					"documents",
				),
			])
			// A version without its signing date has no place in a dated comparison.
			.where(onOrBefore(filters.as_of, sql`v.executed_on`))
			.where(propertyMatches(filters))
	);
}

async function readMarketTerms(db: Transaction<DB>, filters: Filters) {
	const recorded = await rounds(db, filters)
		.unionAll(leaseVersions(db, filters))
		.execute();
	const rows = recorded.flatMap((record) =>
		TERMS.flatMap((term) => {
			const value = record[term];
			if (value === null) return [];
			const { deal_id, deal_name, property, stage, number, recorded_on } =
				record;
			return [
				{
					deal_id,
					deal_name,
					property,
					stage,
					number,
					recorded_on,
					term,
					value,
					expense_structure: record.expense_structure,
					superseded: record.superseded,
					documents: record.documents,
				},
			];
		}),
	);
	rows.sort(
		(a, b) =>
			(b.recorded_on ?? "").localeCompare(a.recorded_on ?? "") ||
			a.deal_name.localeCompare(b.deal_name) ||
			a.deal_id.localeCompare(b.deal_id) ||
			a.stage.localeCompare(b.stage) ||
			a.number - b.number ||
			TERMS.indexOf(a.term) - TERMS.indexOf(b.term),
	);
	return { schema_version: "compare-terms.v1", ...filters, rows };
}

export const marketTerms = new Hono<DatabaseEnv>().get(
	"/market-terms",
	async (c): Promise<Response> => {
		const params = new URL(c.req.url).searchParams;
		const refused = checkFields(params, ["market", "use_type", "as_of"]);
		if (refused) return refuse(c, refused);
		const filters: Filters = {};
		for (const field of ["market", "use_type", "as_of"] as const) {
			const value = params.get(field)?.trim();
			if (value) filters[field] = value;
		}
		if (filters.as_of !== undefined && !isCalendarDate(filters.as_of))
			return refuse(
				c,
				new Refusal(400, "invalid_field_value", { fields: ["as_of"] }),
			);
		return answerNextRead(c, "read-market-terms", (db) =>
			readMarketTerms(db, filters),
		);
	},
);
