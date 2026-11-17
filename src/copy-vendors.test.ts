import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PARTNER = id(1);
const SYSTEM = id(2);

const read = (file: string) =>
	readFile(new URL(`../schema/${file}`, import.meta.url), "utf8");
const [SCHEMA, ATTRIBUTION, COPY] = await Promise.all([
	read("next.sql"),
	read("copy-attribution.sql"),
	read("copy-vendors.sql"),
]);

// A row shaped like today's vendor, last changed by the system unless it says otherwise.
const oldVendor = (
	n: number,
	party: number,
	row: Record<string, string> = {},
) => {
	const full = {
		id: id(n),
		party_id: id(party),
		category: "Example category",
		created_by: SYSTEM,
		updated_by: SYSTEM,
		...row,
	};
	return `insert into public.vendor (${Object.keys(full)})
		values (${Object.values(full).map((value) => `'${value}'`)});`;
};

const ORIGINAL_STAGES = [
	"prospect_uncontacted",
	"unrated",
	"target_not_yet_met",
	"building_working_on_it",
	"decent_relationship",
	"important_strengthening",
	"fully_aligned",
	"avoid_not_a_good_partner",
	"tabled_parked_drip_only",
];

// Old parties 10 to 19, of which 15 was merged into 10 and 18 into 17, and 16 was not copied.
const SETUP = `begin;
select set_config('engine.job', 'old_system', true);
insert into party (id, kind, name) values ('${PARTNER}', 'person', 'Example User'), ('${id(10)}', 'company', 'Example Bank'),
	('${id(11)}', 'person', 'Example Builder'), ('${id(17)}', 'company', 'Example Parked'), ('${id(19)}', 'person', 'Example Avoided');
insert into app_user values ('${PARTNER}');
insert into outside_id (source, value, party_id) values ('old_system_ref', 'P-0010', '${id(10)}'),
	${[1, 10, 11, 15, 17, 18, 19].map((n) => `('old_system', '${id(n)}', '${id({ 15: 10, 18: 17 }[n] ?? n)}')`)};
insert into public.actor (id, slug, kind, display_name) values
	('${PARTNER}', 'partner_one', 'human', 'Example User'), ('${SYSTEM}', 'example-system', 'system', 'Example system');
insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 10);
insert into public.party (id, kind, name, created_by, updated_by)
	select id, 'person', 'Example party', '${SYSTEM}', '${SYSTEM}' from unnest(array[${[10, 11, 15, 16, 17, 18, 19].map((n) => `'${id(n)}'::uuid`)}]) id;
insert into public.vendor_category (slug, label, sort) values
	('lender', 'Example lender', 10), ('gc', 'Example contractor', 50), ('cpa', 'Example accountant', 20);
insert into public.vendor_stage (slug, label, sort) values ('example', 'Example stage', 0),
	${ORIGINAL_STAGES.map((slug, i) => `('${slug}', 'Example original', ${i + 1})`)};
insert into public.vendor_disposition (slug, label, workable, sort) values
	('active', 'Example active', true, 10), ('parked', 'Example parked', false, 20), ('avoid', 'Example avoid', false, 30);
insert into public.vendor_relationship_level (level, label, note) values (2, 'Example', 'Example'), (3, 'Example', 'Example'), (4, 'Example', 'Example');
${oldVendor(40, 10, {
	vendor_ref: " V-0040 ",
	category_slug: "gc",
	stage: "example",
	relationship_level: "2",
	created_at: "2024-01-02T03:04:05Z",
	updated_by: PARTNER,
	updated_at: "2025-01-02T03:04:05Z",
	territory: "Example territory",
	out_of_market: "false",
	trust_override: `{"tier": "Proven", "recorded_by": "partner_one", "reason": "Example reason", "recorded_at": "2025-01-01"}`,
})}
${oldVendor(41, 15, {
	vendor_ref: "V-0041",
	category_slug: "lender",
	stage: "prospect_uncontacted",
	relationship_level: "3",
	is_target: "true",
	verticals: "{dental,medical}",
})}
${oldVendor(42, 11, { vendor_ref: "P-0010", category: "Misc", relationship_level: "4", enrich: "true" })}
${oldVendor(43, 16)}
${oldVendor(44, 17, { disposition: "parked", category_slug: "cpa" })}
${oldVendor(45, 18, { vendor_ref: "V-0045" })}
${oldVendor(46, 19, { disposition: "avoid", is_target: "false" })}
${oldVendor(47, 10, {
	merged_into: id(40),
	category_slug: "cpa",
	stage: "avoid_not_a_good_partner",
	territory: "Example territory",
	offers: "Example offer",
})}
commit;`;

const name = `copy_vendors_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (sql: string) => (await db.query(sql)).rows;
const copy = async (sql = "") => {
	const results = await db.query(sql + COPY);
	return (results as unknown as pg.QueryResult[])
		.at(-1)
		?.rows.map((row) => Object.values(row));
};
const rolledBack = async (check: () => Promise<void>) => {
	await db.query("begin");
	try {
		await check();
	} finally {
		await db.query("rollback");
	}
};
const WAITING = [
	[id(43), "vendor", null, "its record is not copied"],
	[id(44), "disposition", "parked", "a ruling without a reason"],
	[
		id(45),
		"vendor",
		"V-0045",
		"another vendor of its record waits for a ruling",
	],
	[id(46), "disposition", "avoid", "a ruling without a reason"],
];
let report: unknown;

before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${SCHEMA} ${ATTRIBUTION} ${SETUP}`);
	await db.query("begin");
	report = await copy();
	await db.query("commit");
});

after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("each category is a vendor role, gc is contractor, and the roles vendors play on deals join them", async () => {
	// biome-ignore format: one row per role
	assert.deepEqual(await rows("select slug, label, category_of from role order by slug"), [
		{ slug: "architect", label: "Architect", category_of: "vendor" },
		{ slug: "attorney", label: "Attorney", category_of: "vendor" },
		{ slug: "contractor", label: "Example contractor", category_of: "vendor" },
		{ slug: "cpa", label: "Example accountant", category_of: "vendor" },
		{ slug: "inspector", label: "Inspector", category_of: "vendor" },
		{ slug: "landlord_rep", label: "Landlord rep", category_of: "vendor" },
		{ slug: "lender", label: "Example lender", category_of: "vendor" },
		{ slug: "title", label: "Title", category_of: "vendor" },
		{ slug: "vendor", label: "Vendor", category_of: null },
	]);
});

test("today's stages are vendor stages, but not the nine that migration 0047 split", async () => {
	assert.deepEqual(await rows("select role, slug, label from stage"), [
		{ role: "vendor", slug: "example", label: "Example stage" },
	]);
});

test("a record's vendors become one vendor role with each category, and a ruled vendor waits whole", async () => {
	// biome-ignore format: one row per role
	assert.deepEqual(await rows("select party_id, role, stage, relationship_level, disposition, is_target from party_role order by party_id, role"), [
		{ party_id: id(10), role: "contractor", stage: null, relationship_level: null, disposition: null, is_target: false },
		{ party_id: id(10), role: "cpa", stage: null, relationship_level: null, disposition: null, is_target: false },
		{ party_id: id(10), role: "lender", stage: null, relationship_level: null, disposition: null, is_target: false },
		{ party_id: id(10), role: "vendor", stage: "example", relationship_level: 2, disposition: null, is_target: true },
		{ party_id: id(11), role: "vendor", stage: null, relationship_level: null, disposition: null, is_target: false },
	]);
});

test("a vendor role keeps when its vendor was stored and who last changed it", async () => {
	assert.deepEqual(
		await rows(
			`select role, created_at::text, changed_by_user_id, changed_by_job, changed_at::text
			from party_role where party_id = '${id(10)}' and role in ('vendor', 'contractor') order by role`,
		),
		["contractor", "vendor"].map((role) => ({
			role,
			created_at: "2024-01-02 03:04:05+00",
			changed_by_user_id: PARTNER,
			changed_by_job: null,
			changed_at: "2025-01-02 03:04:05+00",
		})),
	);
});

test("each copied vendor's id and reference number lead to its record", async () => {
	// biome-ignore format: one row per id
	assert.deepEqual(await rows(`select source, value, party_id from outside_id where value in ('${id(40)}', '${id(41)}', '${id(42)}', '${id(47)}', 'V-0040', 'V-0041', 'P-0010') order by source, value`), [
		{ source: "old_system", value: id(40), party_id: id(10) },
		{ source: "old_system", value: id(41), party_id: id(10) },
		{ source: "old_system", value: id(42), party_id: id(11) },
		{ source: "old_system", value: id(47), party_id: id(10) },
		{ source: "old_system_ref", value: "P-0010", party_id: id(10) },
		{ source: "old_system_ref", value: "V-0040", party_id: id(10) },
		{ source: "old_system_ref", value: "V-0041", party_id: id(10) },
	]);
});

test("each value it does not copy is listed, with why", () => {
	// biome-ignore format: one row per value
	assert.deepEqual(report, [
		[id(40), "territory", "Example territory", "no place in the new database"],
		[id(40), "trust_override", "Proven", "a hand-set rating, which the new database does not keep"],
		[id(41), "relationship_level", "3", "its record holds another level"],
		[id(41), "verticals", "dental, medical", "no place in the new database"],
		[id(42), "category", "Misc", "not a vendor category"],
		[id(42), "enrich", "true", "no place in the new database"],
		[id(42), "relationship_level", "4", "not a relationship level"],
		[id(42), "vendor_ref", "P-0010", `also the id of ${id(10)}`],
		...WAITING,
		[id(47), "offers", "Example offer", "no place in the new database"],
	]);
});

test("a second run changes nothing, lists again what still waits, and lists a vendor added to a copied record", () =>
	rolledBack(async () => {
		const roles = await rows(
			"select * from party_role order by party_id, role",
		);
		const history = await rows("select * from change order by id");
		await db.query("discard temp");
		assert.deepEqual(await copy(oldVendor(48, 10, { vendor_ref: "V-0048" })), [
			...WAITING,
			[
				id(48),
				"vendor",
				"V-0048",
				"its record holds a vendor role copied before",
			],
		]);
		assert.deepEqual(
			await rows("select * from party_role order by party_id, role"),
			roles,
		);
		assert.deepEqual(await rows("select * from change order by id"), history);
	}));

const link = (
	n: number,
	from: number,
	to: number,
	kind: string,
	via?: number,
) =>
	`insert into public.party_link (id, from_party, to_party, kind, source, created_by, created_at, via_party, occurred_on, note)
		values ('${id(n)}', '${id(from)}', '${id(to)}', '${kind}', 'example', '${PARTNER}', '2025-03-04T00:00:00Z',
		${via ? `'${id(via)}'` : "null"}, '2025-03-01', ' Example note ${n} ');`;
const evidence = (vendor: number, ...entries: [string, number][]) =>
	`update public.vendor set deal_evidence = '${JSON.stringify(
		entries.map(([role, deal]) => ({
			deal_id: id(deal),
			role,
			occurred_at: "2025-04-01T02:00:00Z",
			evidence_ref: `Example ${role}`,
		})),
	)}' where id = '${id(vendor)}';`;
// Old deals 70 and 72 were copied, 71 was not, and each is the deal of client 60, who is record 20.
const DEALS = `select set_config('engine.job', 'old_system', true);
insert into party (id, kind, name) values ('${id(20)}', 'person', 'Example Client');
insert into deal (id, name, owner_user_id) values ('${id(70)}', 'Example deal', '${PARTNER}'), ('${id(72)}', 'Example deal', '${PARTNER}');
insert into outside_id (source, value, party_id, deal_id) values ('old_system', '${id(20)}', '${id(20)}', null),
	('old_system', '${id(70)}', null, '${id(70)}'), ('old_system', '${id(72)}', null, '${id(72)}');
insert into public.party (id, kind, name, created_by, updated_by) values ('${id(1)}', 'person', 'Example', '${SYSTEM}', '${SYSTEM}'),
	('${id(20)}', 'person', 'Example', '${SYSTEM}', '${SYSTEM}');
insert into public.client (id, party_id, created_by, updated_by) values ('${id(60)}', '${id(20)}', '${SYSTEM}', '${SYSTEM}');
insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
insert into public.deal_phase (slug, label) values ('negotiation', 'Example negotiation');
insert into public.deal (id, client_id, name, deal_type, phase, created_by, updated_by)
	select deal, '${id(60)}', 'Example deal', 'lease', 'negotiation', '${SYSTEM}', '${SYSTEM}' from unnest(array['${id(70)}'::uuid, '${id(72)}'::uuid]) deal;
insert into public.party_link_kind (slug, label, sort) values
	('knows', 'Example', 1), ('introduced', 'Example', 2), ('intro', 'Example', 3), ('referral', 'Example', 4), ('referred', 'Example', 5);
${link(50, 20, 1, "introduced", 10)} ${link(51, 11, 20, "intro", 1)} ${link(52, 10, 20, "referral")} ${link(53, 10, 20, "referred")}
${link(54, 10, 20, "knows", 11)} ${link(55, 20, 11, "introduced", 17)} ${link(56, 16, 20, "introduced", 10)} ${link(57, 20, 1, "intro", 1)}
insert into public.party_link_deal (link_id, deal_id, referred_by, note, created_by)
	values ('${id(52)}', '${id(70)}', '${id(10)}', 'Example deal referral', '${PARTNER}');
alter table public.vendor disable trigger vendor_touch;
${evidence(40, ["worked", 70], ["worked", 71], ["referred", 72], ["referred", 70], ["example", 70])}
${evidence(42, ["worked", 70], ["referred", 72])}
${evidence(41, ["referred", 20])}
${evidence(47, ["worked", 72])}`;
const DEAL_FIELDS = ["deal_evidence", "party_link", "party_link_deal"];

test("introductions either way, and the deals a vendor worked or referred, are copied, or listed with why", () =>
	rolledBack(async () => {
		const listed = (await copy(DEALS))?.filter((row) =>
			DEAL_FIELDS.includes(row[1] as string),
		);
		// biome-ignore format: one row per introduction
		assert.deepEqual(await rows("select vendor_id, made_by, introduced_by_user_id, introduced_party_id, introduced_on::text, deal_id, note from introduction order by vendor_id, made_by, deal_id"), [
			{ vendor_id: id(10), made_by: "vendor", introduced_by_user_id: null, introduced_party_id: id(20), introduced_on: null, deal_id: id(70), note: "Example deal referral" },
			{ vendor_id: id(10), made_by: "vendor", introduced_by_user_id: null, introduced_party_id: id(20), introduced_on: "2025-03-31", deal_id: id(72), note: "Example referred" },
			{ vendor_id: id(10), made_by: "vendor", introduced_by_user_id: null, introduced_party_id: id(20), introduced_on: "2025-03-01", deal_id: null, note: "Example note 50" },
			{ vendor_id: id(11), made_by: "team", introduced_by_user_id: PARTNER, introduced_party_id: id(20), introduced_on: "2025-03-01", deal_id: null, note: "Example note 51" },
			{ vendor_id: id(11), made_by: "vendor", introduced_by_user_id: null, introduced_party_id: id(20), introduced_on: "2025-03-31", deal_id: id(72), note: "Example referred" },
		]);
		assert.deepEqual(
			await rows(
				"select deal_id, party_id, role from deal_party order by party_id, deal_id",
			),
			[
				{ deal_id: id(70), party_id: id(10), role: "contractor" },
				{ deal_id: id(72), party_id: id(10), role: "cpa" },
				{ deal_id: id(70), party_id: id(11), role: "vendor" },
			],
		);
		// biome-ignore format: one row per value
		assert.deepEqual(listed, [
			[id(40), "deal_evidence", `example ${id(70)}`, "neither worked nor referred"],
			[id(40), "deal_evidence", `worked ${id(71)}`, "its deal is not copied"],
			[id(41), "deal_evidence", `referred ${id(20)}`, "its deal is not copied"],
			[id(53), "party_link", "referred", "who made it is not recorded"],
			[id(55), "party_link", "introduced", "made by neither a copied vendor nor a user"],
			[id(56), "party_link", "introduced", "a party it links is not copied"],
			[id(57), "party_link", "intro", "no single copied vendor on either side"],
		]);
		const history = await rows("select * from change order by id");
		await db.query("discard temp");
		assert.deepEqual(
			(await copy())?.filter((row) => DEAL_FIELDS.includes(row[1] as string)),
			listed,
		);
		assert.deepEqual(await rows("select * from change order by id"), history);
	}));
