import { type Kysely, sql, type Transaction } from "kysely";
import {
	BusinessRefusal,
	type Contract,
	type ListQuery,
	listAnswer,
	ownedByViewer,
	PAGE_SIZE,
	partnerId,
	recordAnswer,
	SORTS,
	type Stamp,
	searched,
	viewerIdOf,
} from "../clients/read.ts";
import type { DB } from "../database.d.ts";
import {
	lastRecordedContacts,
	VENDOR_RELATIONSHIPS,
	vendorIsQuiet,
	vendorQuietDays,
	vendorRelationship,
} from "../leads/follow-up-reads.ts";
import { DEFAULT_CADENCE } from "../leads/quiet-follow-ups.ts";
import type { DB as NextDB } from "../next-database.d.ts";
import { asText, inJsonbOrder } from "../reader.ts";
import { UUID } from "../uuid.ts";
import { activeTerritory, vendorMarkets } from "./markets.ts";
import { nextVendorContacts, people } from "./people.ts";
import {
	nextTrackRecordFacts,
	rateNextTrackRecord,
	rateTrackRecord,
	type TrackRecordFacts,
	trackRecordFacts,
} from "./track-record.ts";

export const VENDOR_SORTS = [...SORTS, "territory", "relationship"] as const;
export type VendorQuery = ListQuery<
	"vendors",
	(typeof VENDOR_SORTS)[number]
> & {
	category: string | null;
	stage: string | null;
	disposition: string | null;
	quiet?: true;
	no_category?: true;
	markets?: true;
};

// The legacy `category` column has no lookup key; `category_slug` does.
const category = sql<string>`coalesce(v.category_slug, v.category)`;
const vertical = sql<
	string | null
>`nullif(array_to_string(v.verticals, ', '), '')`;
const ORDER = {
	name: sql`lower(p.name) asc, v.id asc`,
	recent: sql`v.updated_at desc, v.id asc`,
	vertical: sql`lower(${vertical}) asc nulls last, lower(p.name), v.id`,
	deal_type: sql`lower(vc.label) asc nulls last, lower(p.name), v.id`,
	last_deal_desc: sql`vr.last_deal_at desc nulls last, lower(p.name), v.id`,
	last_deal_asc: sql`vr.last_deal_at asc nulls last, lower(p.name), v.id`,
	territory: sql`lower(v.territory) asc nulls last, lower(p.name), v.id`,
	// The old table records no ruling as active.
	relationship: sql`case v.disposition when 'avoid' then 6 when 'parked' then 5
		else coalesce(3 - v.relationship_level, 4) end, lower(p.name), v.id`,
};

const liveVendors = (db: Kysely<DB>) =>
	db
		.selectFrom("vendor as v")
		.innerJoin("party as p", "p.id", "v.party_id")
		.leftJoin("vendor_category as vc", (join) =>
			join.on("vc.slug", "=", category),
		)
		.leftJoin("vendor_stage as vs", "vs.slug", "v.stage")
		.leftJoin("vendor_disposition as vd", "vd.slug", "v.disposition")
		.leftJoin(
			"vendor_relationship_level as vrl",
			"vrl.level",
			"v.relationship_level",
		)
		.where("v.merged_into", "is", null)
		.where("p.merged_into", "is", null)
		.where("p.deleted_at", "is", null);

const withTrackRecord = (vendors: ReturnType<typeof liveVendors>) =>
	vendors.innerJoinLateral(trackRecordFacts.as("vr"), (join) => join.onTrue());

const V2 = "vendor-directory.v2";

// v2 adds the vendor's people and, as the old read did, passes the whole row
// through jsonb, which reorders its keys.
const contracted = <Row>(row: Row, contract: Contract) =>
	contract === V2 ? inJsonbOrder(row) : row;

// Stage, disposition and level have foreign keys, so only the category can
// be a code with no label.
function unlabelled(rows: { recorded_category_label: string | null }[]) {
	const count = rows.filter((r) => r.recorded_category_label === null).length;
	return count
		? {
				kind: "unlabelled_recorded_codes",
				count,
				fields: ["recorded_category"],
				note: "Some entries use a code that is not in the current list of options. The stored value is shown exactly as it is, and has not been renamed.",
			}
		: null;
}

function matchingVendors(db: Kysely<DB>, query: VendorQuery, viewer: string) {
	const { q, owner, territory } = query;
	let vendors = liveVendors(db);
	if (query.scope === "mine")
		vendors = vendors.where("v.owner_id", "=", partnerId(db, viewer));
	if (owner !== "all")
		vendors = vendors.where("v.owner_id", "=", partnerId(db, owner));
	if (territory !== null)
		vendors = vendors.where("v.territory", "=", territory);
	if (q !== null) vendors = vendors.where(searched(q, sql.ref("v.vendor_ref")));
	if (query.category !== null)
		vendors = vendors.where(category, "=", query.category);
	if (query.stage !== null)
		vendors = vendors.where("v.stage", "=", query.stage);
	if (query.disposition !== null)
		vendors = vendors.where("v.disposition", "=", query.disposition);
	return vendors;
}

export async function readVendorList(
	db: Kysely<DB>,
	viewer: string,
	query: VendorQuery,
	stamp: Stamp,
) {
	const ownerId = await viewerIdOf(db, viewer);
	const matching = matchingVendors(db, query, viewer);
	const { total } = await matching
		.select(sql<number>`count(*)::int`.as("total"))
		.executeTakeFirstOrThrow();
	const rows = await withTrackRecord(matching)
		.select((eb) => [
			"v.id",
			"v.vendor_ref as ref",
			"p.name",
			"p.kind as party_kind",
			"p.city",
			"p.state",
			category.as("recorded_category"),
			"vc.label as recorded_category_label",
			"v.stage as recorded_stage",
			"vs.label as recorded_stage_label",
			"v.disposition as recorded_disposition",
			"vd.label as recorded_disposition_label",
			"v.relationship_level",
			"vrl.label as relationship_level_label",
			"v.referral_active",
			"v.is_target",
			"v.out_of_market",
			"v.last_touch",
			"vr.facts as relationship",
			vertical.as("vertical"),
			"vc.label as deal_type",
			asText(eb.ref("vr.last_deal_at")).as("last_deal_at"),
			"v.territory",
			"v.owner_label",
			ownedByViewer(sql.ref("v.owner_id"), ownerId).as("owned_by_viewer"),
			asText(eb.ref("v.updated_at")).as("updated_at"),
		])
		.$if(query.contract === V2, (qb) => qb.select(people.as("people")))
		.orderBy(ORDER[query.sort])
		.limit(PAGE_SIZE)
		.offset((query.page - 1) * PAGE_SIZE)
		.execute();
	const lookup = (table: "vendor_category" | "vendor_stage") =>
		db
			.selectFrom(table)
			.select(["slug", "label"])
			.orderBy("sort")
			.orderBy("slug")
			.execute();
	const facets = {
		categories: await lookup("vendor_category"),
		stages: await lookup("vendor_stage"),
		dispositions: await db
			.selectFrom("vendor_disposition")
			.select(["slug", "label", "workable"])
			.orderBy("sort")
			.orderBy("slug")
			.execute(),
	};
	const territories = query.contract
		? await liveVendors(db)
				.where("v.territory", "<>", "")
				.select(["v.territory as slug", "v.territory as label"])
				.distinct()
				.orderBy("v.territory")
				.execute()
		: null;
	if (query.scope === "mine" && ownerId === null)
		throw new BusinessRefusal({ error: "VIEWER_OWNER_UNKNOWN" });
	const now = stamp.observedAt.valueOf();
	return listAnswer(
		viewer,
		query,
		total,
		{
			rows: rows.map((row) => {
				if (query.contract) {
					const shaped = contracted(row, query.contract);
					return {
						...shaped,
						relationship: rateTrackRecord(shaped.relationship, now),
					};
				}
				const {
					relationship,
					vertical,
					deal_type,
					last_deal_at,
					territory,
					...legacy
				} = row;
				return legacy;
			}),
			facets: territories ? { ...facets, territories } : facets,
			partial: unlabelled(rows),
		},
		stamp,
	);
}

export async function readVendor(
	db: Kysely<DB>,
	viewer: string,
	id: string,
	contract: Contract | null,
	stamp: Stamp,
) {
	const ownerId = await viewerIdOf(db, viewer);
	const record = await withTrackRecord(liveVendors(db))
		.where("v.id", "=", id)
		.select((eb) => [
			"v.id",
			"v.vendor_ref as ref",
			"p.name",
			"p.kind as party_kind",
			"p.city",
			"p.state",
			"p.county",
			"p.title",
			"p.phone",
			"p.cell",
			"p.email",
			"p.contact_state",
			"p.contact_state_reason",
			"p.contact_state_until",
			"p.contact_state_cadence",
			category.as("recorded_category"),
			"vc.label as recorded_category_label",
			"v.stage as recorded_stage",
			"vs.label as recorded_stage_label",
			"v.disposition as recorded_disposition",
			"vd.label as recorded_disposition_label",
			"v.relationship_level",
			"vrl.label as relationship_level_label",
			"vrl.note as relationship_level_note",
			"v.verticals",
			"v.territory",
			"v.offers",
			"v.seeking",
			"v.rivalry_group",
			"v.originated",
			"v.referral_active",
			"v.is_target",
			"v.out_of_market",
			"v.last_touch",
			"vr.facts as relationship",
			"v.loan_programs",
			"v.intro_notes",
			"v.links_label",
			"v.owner_label",
			ownedByViewer(sql.ref("v.owner_id"), ownerId).as("owned_by_viewer"),
			"v.version as record_version",
			asText(eb.ref("v.created_at")).as("created_at"),
			asText(eb.ref("v.updated_at")).as("updated_at"),
		])
		.$if(contract === V2, (qb) => qb.select(people.as("people")))
		.executeTakeFirst();
	if (!record) throw new BusinessRefusal({ error: "RECORD_NOT_FOUND" });
	const partial = unlabelled([record]);
	if (contract) {
		const shaped = contracted(record, contract);
		const now = stamp.observedAt.valueOf();
		return recordAnswer(
			"vendors",
			viewer,
			{ ...shaped, relationship: rateTrackRecord(shaped.relationship, now) },
			partial,
			stamp,
		);
	}
	// The legacy shape keeps the territory, moved to the end.
	const { relationship, loan_programs, territory, ...legacy } = record;
	return recordAnswer(
		"vendors",
		viewer,
		{ ...legacy, territory },
		partial,
		stamp,
	);
}

const NEXT_DISPOSITIONS = [
	{ slug: "active", label: "Active", workable: true },
	{ slug: "parked", label: "Parked", workable: false },
	{ slug: "avoid", label: "Avoid", workable: false },
];
export const nextTerritory = sql<
	string | null
>`(select nullif(string_agg(distinct t.name, ', ' order by t.name), '')
	from party_territory pt join territory t on t.id = pt.territory_id
	where pt.party_id = p.id and (${activeTerritory}))`;
const nextVertical = sql<
	string | null
>`(select nullif(string_agg(vv.vertical, ', ' order by vv.vertical), '')
	from vendor_vertical vv where vv.party_id = p.id)`;
export const nextRef = sql<string>`coalesce(
	(select o.value from outside_id o
		where o.party_id = p.id and o.source = 'old_system_ref'
		order by (o.value like 'V-%') desc, o.value asc limit 1),
	p.id::text)`;
const nextPartyKind = sql<
	"person" | "org"
>`case p.kind when 'company' then 'org' else p.kind end`;
const nextDisposition = sql<string>`coalesce(pr.disposition, 'active')`;
const nextDispositionLabel = sql<string>`case pr.disposition
	when 'parked' then 'Parked' when 'avoid' then 'Avoid' else 'Active' end`;
const nextUpdatedAt = sql`greatest(p.changed_at, pr.changed_at)`;
const nextLoanPrograms = sql<
	string[] | null
>`(select array_agg(loan_program order by loan_program)
	from vendor_loan_program where party_id = p.id)`;
const nextEmail = (party: ReturnType<typeof sql.ref>) =>
	sql<string | null>`(select pe.address::text from party_email pe
		where pe.party_id = ${party} order by pe.is_primary desc, pe.created_at, pe.id limit 1)`;
const nextPhone = (party: ReturnType<typeof sql.ref>, mobile: boolean) =>
	sql<string | null>`(select concat(pp.number, ' x' || pp.extension)
		from party_phone pp where pp.party_id = ${party}
			and pp.label ${mobile ? sql.raw("=") : sql.raw("<>")} 'mobile'
		order by pp.is_primary desc, pp.created_at, pp.id limit 1)`;
export const nextVendorContact = sql`jsonb_build_object(
	'id', c.id, 'name', c.name, 'email', ${nextEmail(sql.ref("c.id"))},
	'phone', ${nextPhone(sql.ref("c.id"), false)}, 'cell', ${nextPhone(sql.ref("c.id"), true)})`;
const nextPeople = sql<object[]>`(select coalesce(jsonb_agg(jsonb_build_object(
	'company', c.company,
	'contact', ${nextVendorContact},
	'office', null,
	'research', jsonb_build_object('status', 'not_researched', 'finding_id', null,
		'observed_at', null, 'expires_on', null)
) order by c.id), '[]') from ${nextVendorContacts} c where btrim(c.name) <> '')`;

export const nextVendorCategory = sql<{ slug: string; label: string }>`(
	select r.slug, r.label from party_role cr
	join role r on r.slug = cr.role where cr.party_id = p.id and r.category_of = 'vendor'
	order by r.slug limit 1)`;

const NEXT_ORDER = {
	name: sql`lower(p.name) asc, p.id asc`,
	recent: sql`${nextUpdatedAt} desc, p.id asc`,
	vertical: sql`lower(${nextVertical}) asc nulls last, lower(p.name), p.id`,
	deal_type: sql`lower(cat.label) asc nulls last, lower(p.name), p.id`,
	last_deal_desc: sql`vr.last_deal_at desc nulls last, lower(p.name), p.id`,
	last_deal_asc: sql`vr.last_deal_at asc nulls last, lower(p.name), p.id`,
	territory: sql`lower(${nextTerritory}) asc nulls last, lower(p.name), p.id`,
	relationship: sql`array_position(array[${sql.join(VENDOR_RELATIONSHIPS.map((r) => sql`${r.word}`))}]::text[],
		${vendorRelationship("pr")}), lower(p.name), p.id`,
};

const nextCategories = sql<{ slug: string; label: string }[]>`(
	select coalesce(jsonb_agg(jsonb_build_object('slug', r.slug, 'label', r.label) order by r.label, r.slug), '[]')
	from party_role cr join role r on r.slug = cr.role where cr.party_id = p.id and r.category_of = 'vendor')`;

async function nextViewerId(db: Transaction<NextDB>, viewer: string) {
	const user = await db
		.selectFrom("app_user")
		.select("id")
		.where("slug", "=", viewer)
		.executeTakeFirst();
	return user?.id ?? null;
}

const liveNextVendors = (db: Transaction<NextDB>) =>
	db
		.selectFrom("party_role as pr")
		.innerJoin("party as p", "p.id", "pr.party_id")
		.leftJoin("app_user as ou", "ou.id", "pr.owner_user_id")
		.leftJoin("party as op", "op.id", "pr.owner_user_id")
		.leftJoin("stage as s", (join) =>
			join.on("s.role", "=", "vendor").onRef("s.slug", "=", "pr.stage"),
		)
		.leftJoin("relationship_level as rl", "rl.level", "pr.relationship_level")
		.leftJoin("vendor_track_record as vtr", "vtr.party_id", "p.id")
		.leftJoinLateral(nextVendorCategory.as("cat"), (join) => join.onTrue())
		.where("pr.role", "=", "vendor");

function nextVendorRows(
	vendors: ReturnType<typeof liveNextVendors>,
	ownerId: string | null,
	contract: Contract | null | undefined,
) {
	return vendors
		.innerJoinLateral(nextTrackRecordFacts.as("vr"), (join) => join.onTrue())
		.select((eb) => [
			"p.id",
			"p.name",
			"p.city",
			nextRef.as("ref"),
			nextPartyKind.as("party_kind"),
			sql<null>`null`.as("state"),
			"cat.slug as recorded_category",
			"cat.label as recorded_category_label",
			"pr.stage as recorded_stage",
			"s.label as recorded_stage_label",
			nextDisposition.as("recorded_disposition"),
			nextDispositionLabel.as("recorded_disposition_label"),
			"pr.relationship_level",
			"rl.label as relationship_level_label",
			"pr.refers_business as referral_active",
			"pr.is_target",
			sql<null>`null`.as("out_of_market"),
			asText(eb.ref("vr.last_touch")).as("last_touch"),
			"op.name as owner_label",
			ownedByViewer(sql.ref("pr.owner_user_id"), ownerId).as("owned_by_viewer"),
			asText(nextUpdatedAt).as("updated_at"),
		])
		.$if(Boolean(contract), (qb) => qb.select("vr.facts as relationship"))
		.$if(contract === V2, (qb) => qb.select(nextPeople.as("people")));
}

function rateNextVendor<Row extends { relationship?: TrackRecordFacts }>(
	row: Row,
	now: number,
) {
	return row.relationship
		? {
				...row,
				relationship: rateNextTrackRecord(row.relationship, now),
			}
		: row;
}

export async function readNextVendorList(
	db: Transaction<NextDB>,
	viewer: string,
	query: VendorQuery,
	stamp: Stamp,
) {
	const ownerId = await nextViewerId(db, viewer);
	if (query.scope === "mine" && ownerId === null)
		throw new BusinessRefusal({ error: "VIEWER_OWNER_UNKNOWN" });
	const { category, disposition, owner, q, quiet, scope, stage, territory } =
		query;
	const uncategorized = query.no_category === true;
	// A category's table filters in place, so it needs every vendor at once.
	const whole = category !== null || uncategorized || query.markets;
	const term = q === null ? null : `%${q.replace(/([\\%_])/g, "\\$1")}%`;
	const days = DEFAULT_CADENCE.vendor_days;
	const matching = liveNextVendors(db)
		.leftJoin(sql`(${lastRecordedContacts})`.as("recorded"), (join) =>
			join.on(sql<boolean>`recorded.party_id = p.id`),
		)
		.$if(quiet === true, (qb) =>
			qb.where(sql<boolean>`${vendorIsQuiet("pr", "recorded", days)}`),
		)
		.where(sql<boolean>`
		(${scope === "team"} or pr.owner_user_id = ${ownerId}::uuid)
		and (${owner === "all"} or ou.slug = ${owner})
		and (${stage}::text is null or pr.stage = ${stage})
		and (${disposition}::text is null or ${nextDisposition} = ${disposition})
		and (${category}::text is null or exists (select from party_role cr join role r on r.slug = cr.role
			where cr.party_id = p.id and r.category_of = 'vendor' and cr.role = ${category}))
		and (not ${uncategorized} or not exists (select from party_role cr join role r on r.slug = cr.role
			where cr.party_id = p.id and r.category_of = 'vendor'))
		and (${territory}::text is null or ${nextTerritory} = ${territory} or exists
			(select from party_territory pt join territory t on t.id = pt.territory_id
			where pt.party_id = p.id and (${activeTerritory}) and t.name = ${territory}))
		and (${term}::text is null or p.name ilike ${term} or p.id::text ilike ${term} or exists
			(select from outside_id o where o.party_id = p.id and o.source = 'old_system_ref' and o.value ilike ${term}))
	`);
	const { total } = await matching
		.select(sql<number>`count(*)::int`.as("total"))
		.executeTakeFirstOrThrow();
	const pageSize = whole ? Math.max(total, 1) : PAGE_SIZE;
	const rows = await nextVendorRows(matching, ownerId, query.contract)
		.$if(Boolean(query.contract), (qb) =>
			qb.select([
				nextVertical.as("vertical"),
				"cat.label as deal_type",
				asText(sql.ref("vr.last_deal_at")).as("last_deal_at"),
				nextTerritory.as("territory"),
				nextCategories.as("categories"),
				sql<boolean>`${vendorIsQuiet("pr", "recorded", days)}`.as("quiet"),
				vendorQuietDays("pr", "recorded", days).as("quiet_days"),
			]),
		)
		.$if(query.markets === true && !query.contract, (qb) =>
			qb.select(nextTerritory.as("territory")),
		)
		.$if(query.markets === true, (qb) =>
			qb.select(
				sql<{ id: string; name: string }[]>`(
				select coalesce(jsonb_agg(m order by m.name), '[]')
				from (${vendorMarkets(sql.ref("p.id"))}) m
			)`.as("markets"),
			),
		)
		.orderBy(NEXT_ORDER[query.sort])
		.limit(pageSize)
		.offset((query.page - 1) * pageSize)
		.execute();
	const facets = await db
		.selectNoFrom([
			sql`(select coalesce(json_agg(r order by r.label, r.slug), '[]')
			from (select slug, label from role where category_of = 'vendor') r)`.as(
				"categories",
			),
			sql`(select coalesce(json_agg(s order by s.label, s.slug), '[]')
			from (select slug, label from stage where role = 'vendor') s)`.as(
				"stages",
			),
		])
		.$if(Boolean(query.contract), (qb) =>
			qb.select(
				sql`(select coalesce(json_agg(t order by t.slug), '[]') from (
			select distinct t.name as slug, t.name as label
			from party_role pr join party_territory pt on pt.party_id = pr.party_id
			join territory t on t.id = pt.territory_id where pr.role = 'vendor' and (${activeTerritory})
		) t)`.as("territories"),
			),
		)
		.executeTakeFirstOrThrow();
	return listAnswer(
		viewer,
		query,
		total,
		{
			rows: rows.map((row) => rateNextVendor(row, stamp.observedAt.valueOf())),
			facets: { ...facets, dispositions: NEXT_DISPOSITIONS },
			partial: null,
		},
		stamp,
		undefined,
		pageSize,
	);
}

export async function readNextVendor(
	db: Transaction<NextDB>,
	viewer: string,
	id: string,
	contract: Contract | null,
	stamp: Stamp,
) {
	const requestedUuid = UUID.test(id) ? id : null;
	const source = requestedUuid ? "old_system" : "old_system_ref";
	const value = requestedUuid?.toLowerCase() ?? id;
	const ownerId = await nextViewerId(db, viewer);
	const record = await nextVendorRows(liveNextVendors(db), ownerId, contract)
		// Kysely joins raw SQL to the other conditions as is, so its ors need their own parentheses.
		.where(sql<boolean>`(p.id = ${requestedUuid}::uuid
			or p.id = (select party_id from outside_id where source = ${source} and value = ${value})
			or p.id = (select survivor_id from merged_party where id = ${requestedUuid}::uuid))`)
		.orderBy(sql`p.id = ${requestedUuid}::uuid`, "desc")
		.leftJoin("active_do_not_contact as dnc", "dnc.party_id", "p.id")
		.select((eb) => [
			sql<null>`null`.as("county"),
			sql<string | null>`(select pc.title from party_company pc
				where pc.person_id = p.id and pc.ended_on is null and pc.title is not null
				order by pc.started_on desc nulls last, pc.created_at desc, pc.id desc limit 1)`.as(
				"title",
			),
			nextPhone(sql.ref("p.id"), false).as("phone"),
			nextPhone(sql.ref("p.id"), true).as("cell"),
			nextEmail(sql.ref("p.id")).as("email"),
			sql<string>`case when dnc.party_id is not null then 'do_not_contact' else 'active' end`.as(
				"contact_state",
			),
			"dnc.reason as contact_state_reason",
			asText(eb.ref("dnc.until_date")).as("contact_state_until"),
			sql<null>`null`.as("contact_state_cadence"),
			"rl.meaning as relationship_level_note",
			sql<string[] | null>`(select array_agg(vv.vertical order by vv.vertical)
				from vendor_vertical vv where vv.party_id = p.id)`.as("verticals"),
			nextTerritory.as("territory"),
			"pr.offers",
			"pr.seeking",
			"pr.rivalry_note as rivalry_group",
			"pr.relationship_origin as originated",
			sql<
				string | null
			>`(select string_agg(a.summary, E'\n\n' order by a.happened_at, a.id)
				from outside_id o join activity a on a.id = md5('old_system:vendor:' || o.value || ':intro_notes')::uuid
				where o.source = 'old_system' and o.party_id = p.id)`.as("intro_notes"),
			sql<null>`null`.as("links_label"),
			sql<null>`null`.as("record_version"),
			asText(eb.ref("pr.created_at")).as("created_at"),
		])
		.$if(Boolean(contract), (qb) =>
			qb.select(nextLoanPrograms.as("loan_programs")),
		)
		.executeTakeFirst();
	if (!record) throw new BusinessRefusal({ error: "RECORD_NOT_FOUND" });
	return recordAnswer(
		"vendors",
		viewer,
		rateNextVendor(
			{ ...record, id: requestedUuid ?? record.id, party_id: record.id },
			stamp.observedAt.valueOf(),
		),
		null,
		stamp,
	);
}
