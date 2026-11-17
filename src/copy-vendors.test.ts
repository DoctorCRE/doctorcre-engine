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
insert into public.vendor_stage (slug, label, sort) values ('prospect_uncontacted', 'Example original', 1), ('example', 'Example stage', 2);
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
${oldVendor(47, 10, { merged_into: id(40), category_slug: "cpa" })}
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
	assert.deepEqual(await rows(`select source, value, party_id from outside_id where value in ('${id(40)}', '${id(41)}', '${id(42)}', 'V-0040', 'V-0041', 'P-0010') order by source, value`), [
		{ source: "old_system", value: id(40), party_id: id(10) },
		{ source: "old_system", value: id(41), party_id: id(10) },
		{ source: "old_system", value: id(42), party_id: id(11) },
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
