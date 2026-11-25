import { Hono } from "hono";
import { type RawBuilder, sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, refuse } from "../answer.ts";
import { PARTNERS } from "../clients/read.ts";
import {
	lastRecordedContacts,
	openPartySteps,
} from "../leads/follow-up-reads.ts";
import { DEFAULT_CADENCE } from "../leads/quiet-follow-ups.ts";
import type { DB } from "../next-database.d.ts";
import type { DatabaseEnv } from "../reader.ts";

const NO_VENDORS = {
	core: 0,
	established: 0,
	building: 0,
	prospective: 0,
	not_rated: 0,
	parked: 0,
	avoid: 0,
};
type Tile = {
	vendors: number;
	quiet: number;
	relationships: typeof NO_VENDORS;
};
type Counted = Tile & { across: boolean; category: string | null };
const EMPTY: Tile = { vendors: 0, quiet: 0, relationships: NO_VENDORS };

const OWNERS = ["all", ...PARTNERS] as const;
type Owner = (typeof OWNERS)[number];

const chicagoDay = (at: RawBuilder<unknown>) =>
	sql`(${at} at time zone 'America/Chicago')::date`;
const byRelationship = sql.join(
	Object.keys(NO_VENDORS).map(
		(word) =>
			sql`${word}::text, count(distinct party_id) filter (where relationship = ${word})::int`,
	),
);

// Quiet is the vendor half of GET /quiet-follow-ups, at its default cadence.
const tiles = (db: Transaction<DB>, owner: Owner) =>
	sql<Counted>`with vendor as (
		select pr.party_id,
			-- A ruling outranks the level.
			case when pr.disposition is not null then pr.disposition
				else case pr.relationship_level when 3 then 'core' when 2 then 'established'
					when 1 then 'building' when 0 then 'prospective' else 'not_rated' end
			end as relationship,
			pr.disposition is null
				and not exists (select from active_do_not_contact dnc where dnc.party_id = pr.party_id)
				and not exists (${openPartySteps(sql.ref("pr.party_id"))})
				and coalesce(${chicagoDay(sql.ref("recorded.happened_at"))}, ${chicagoDay(sql.ref("pr.created_at"))})
					+ ${DEFAULT_CADENCE.vendor_days}::int <= ${chicagoDay(sql`now()`)} as quiet
		from party_role pr
		left join app_user u on u.id = pr.owner_user_id
		left join (${lastRecordedContacts}) recorded on recorded.party_id = pr.party_id
		where pr.role = 'vendor' and (${owner}::text = 'all' or u.slug = ${owner}::text)
	), placed as (
		select v.*, cr.role as category from vendor v
		left join (party_role cr join role r on r.slug = cr.role and r.category_of = 'vendor')
			on cr.party_id = v.party_id
	)
	select grouping(category) = 1 as across, category,
		count(distinct party_id)::int as vendors,
		count(distinct party_id) filter (where quiet)::int as quiet,
		json_build_object(${byRelationship}) as relationships
	from placed group by grouping sets ((), (category))`.execute(db);

async function readVendorSummary(db: Transaction<DB>, owner: Owner) {
	const { rows } = await tiles(db, owner);
	const categories = await db
		.selectFrom("role")
		.select(["slug", "label"])
		.where("category_of", "=", "vendor")
		.orderBy("label")
		.orderBy("slug")
		.execute();
	const tileOf = (row?: Counted): Tile =>
		row
			? {
					vendors: row.vendors,
					quiet: row.quiet,
					relationships: row.relationships,
				}
			: EMPTY;
	const inCategory = (slug: string | null) =>
		tileOf(rows.find((row) => !row.across && row.category === slug));
	return {
		schema_version: "vendor-summary.v1",
		owner,
		quiet_days: DEFAULT_CADENCE.vendor_days,
		all_vendors: tileOf(rows.find((row) => row.across)),
		categories: categories.map((c) => ({ ...c, ...inCategory(c.slug) })),
		no_category: inCategory(null),
	};
}

export const vendorSummary = new Hono<DatabaseEnv>().get(
	"/vendor-summary",
	async (c) => {
		const params = new URL(c.req.url).searchParams;
		const refused = checkFields(params, ["owner"], {
			vocabularies: { owner: OWNERS },
		});
		if (refused) return refuse(c, refused);
		const owner = OWNERS.find((o) => o === params.get("owner")) ?? "all";
		return answerNextRead(c, "read-vendor-summary", (db) =>
			readVendorSummary(db, owner),
		);
	},
);
