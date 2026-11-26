import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, refuse } from "../answer.ts";
import { PARTNERS } from "../clients/read.ts";
import {
	lastRecordedContacts,
	VENDOR_RELATIONSHIPS,
	type VendorRelationship,
	vendorIsQuiet,
	vendorRelationship,
} from "../leads/follow-up-reads.ts";
import { DEFAULT_CADENCE } from "../leads/quiet-follow-ups.ts";
import type { DB } from "../next-database.d.ts";
import type { DatabaseEnv } from "../reader.ts";

type Counts = {
	count: number;
	relationship: Record<VendorRelationship, number>;
	quiet: number;
};
type Counted = Counts & { across: boolean; category: string | null };
const EMPTY: Counts = {
	count: 0,
	relationship: Object.fromEntries(
		VENDOR_RELATIONSHIPS.map(({ word }) => [word, 0]),
	) as Counts["relationship"],
	quiet: 0,
};

const OWNERS = ["all", ...PARTNERS] as const;
type Owner = (typeof OWNERS)[number];

const byRelationship = sql.join(
	VENDOR_RELATIONSHIPS.map(
		({ word }) =>
			sql`${word}::text, count(distinct party_id) filter (where relationship = ${word})::int`,
	),
);

const tiles = (db: Transaction<DB>, owner: Owner) =>
	sql<Counted>`with vendor as (
		select pr.party_id, ${vendorRelationship("pr")} as relationship,
			${vendorIsQuiet("pr", "recorded", DEFAULT_CADENCE.vendor_days)} as quiet
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
		count(distinct party_id)::int as count,
		json_build_object(${byRelationship}) as relationship,
		count(distinct party_id) filter (where quiet)::int as quiet
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
	const countsOf = (row?: Counted): Counts =>
		row
			? { count: row.count, relationship: row.relationship, quiet: row.quiet }
			: EMPTY;
	const inCategory = (slug: string | null) =>
		countsOf(rows.find((row) => !row.across && row.category === slug));
	return {
		all: countsOf(rows.find((row) => row.across)),
		no_category: inCategory(null),
		categories: categories.map((c) => ({ ...c, ...inCategory(c.slug) })),
	};
}

export const vendorSummary = new Hono<DatabaseEnv>().get(
	"/vendors/summary",
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
