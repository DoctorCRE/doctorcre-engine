import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PARTNER = id(1);
const AUTOMATION = id(2);
const SYSTEM = id(3);
// Made up. No NPI issued yet starts with 9, so none can be anyone's.
const NPI = "9000000015";

const read = (file: string) =>
	readFile(new URL(`../schema/${file}`, import.meta.url), "utf8");
const [SCHEMA, COPY] = await Promise.all([
	read("next.sql"),
	read("copy-parties.sql"),
]);

// A row shaped like today's party, last changed by the system unless it says otherwise.
const oldParty = (n: number, row: Record<string, string> = {}) => {
	const full = {
		id: id(n),
		kind: "person",
		name: `Example ${n}`,
		created_by: SYSTEM,
		updated_by: SYSTEM,
		...row,
	};
	return `insert into public.party (${Object.keys(full)})
		values (${Object.values(full).map((value) => `'${value}'`)});`;
};
const OLD = `
insert into public.actor (id, slug, kind, display_name) values
	('${PARTNER}', 'example-partner', 'human', 'Jordan Example'),
	('${AUTOMATION}', 'example-job', 'automation', 'Example job'),
	('${SYSTEM}', 'example-system', 'system', 'Example system');
insert into public.contact_state (slug, label, contactable, sort) values
	('active', 'Example active', true, 10), ('nurture', 'Example nurture', true, 20),
	('paused', 'Example paused', false, 30), ('do_not_contact', 'Example do not contact', false, 40);
${oldParty(10, {
	npi: ` ${NPI} `,
	created_at: "2024-03-04T05:06:07Z",
	updated_by: PARTNER,
	updated_at: "2025-01-02T03:04:05Z",
	email:
		"Avery Example <bad@example>; Avery@Example.com, second@example.net avery@example.com",
	phone: "(217) 555-0100 ext. 12",
	cell: "1-217-555-0101",
	contact_state: "do_not_contact",
	contact_state_reason: " ",
})}
${oldParty(11, {
	kind: "org",
	name: "Example Dental Group",
	npi: NPI,
	created_at: "2025-01-01T00:00:00Z",
	updated_by: AUTOMATION,
	updated_at: "2025-02-03T04:05:06Z",
	email: "ask the front desk",
	phone: "555-0100",
	cell: "217.555.0102",
	contact_state: "do_not_contact",
	contact_state_reason: " Example asked us to stop ",
	contact_state_set_by: PARTNER,
	contact_state_set_at: "2025-05-06T07:08:09Z",
})}
${oldParty(12, {
	merged_into: id(10),
	npi: "9000000023",
	email: "Merged@example.com avery@example.com",
	cell: "217-555-0105",
})}
${oldParty(13, {
	merged_into: id(12),
	contact_state: "do_not_contact",
	contact_state_reason: "Example asked again",
	contact_state_set_at: "2025-07-08T09:10:11Z",
})}
${oldParty(14, { deleted_at: "2026-01-05T00:00:00Z" })} ${oldParty(15, { merged_into: id(14) })}
${oldParty(16, {
	npi: "9000000016",
	phone: "+1 217 555 0103",
	cell: "2175550103",
	contact_state: "paused",
	contact_state_until: "2027-01-04",
})}
${oldParty(18, { merged_into: id(16), npi: "9000000031" })}
${oldParty(17, {
	email: "@example.com; ok@example.com",
	phone: "+44 20 7946 0958 x7",
	cell: "217-555-0104 (fax)",
	contact_state: "nurture",
})}
`;

const url = process.env.TEST_DATABASE_URL;
const snapshot = process.env.TEST_SNAPSHOT;
if (!url || !snapshot)
	throw new Error("Run npm run check to restore the test database first");
// Today's tables come from the check's snapshot, and the new schema loads beside them.
const name = `engine_copy_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: url });
const target = new URL(url);
target.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: target.href,
	options: "-c search_path=next -c TimeZone=UTC",
});

const copy = async (sql = "") => {
	const results = await db.query(sql + COPY);
	return (results as unknown as pg.QueryResult[])
		.at(-1)
		?.rows.map((row) => Object.values(row));
};
const rows = async (query: string) => (await db.query(query)).rows;
const rolledBack = async (check: () => Promise<void>) => {
	await db.query("begin");
	try {
		await check();
	} finally {
		await db.query("rollback");
	}
};
let report: unknown;

before(async () => {
	await admin.connect();
	await admin.query(`create database "${name}" template "${snapshot}"`);
	await db.connect();
	await db.query(`create schema next; ${SCHEMA}`);
	report = await copy(OLD);
});

after(async () => {
	await db.end();
	await admin.query(`drop database "${name}" with (force)`);
	await admin.end();
});

test("people and companies keep their ids and names, a company is no longer an org, and a partner is a user", async () => {
	assert.deepEqual(await rows("select id, kind, name from party order by id"), [
		{ id: PARTNER, kind: "person", name: "Jordan Example" },
		{ id: id(10), kind: "person", name: "Example 10" },
		{ id: id(11), kind: "company", name: "Example Dental Group" },
		{ id: id(16), kind: "person", name: "Example 16" },
		{ id: id(17), kind: "person", name: "Example 17" },
	]);
	assert.deepEqual(await rows("select id from app_user"), [{ id: PARTNER }]);
});

test("each old id maps to the record it became, a merged-away one to where its merges end", async () => {
	assert.deepEqual(
		await rows(
			"select value, party_id from outside_id where source = 'old_system' order by value",
		),
		[1, 10, 11, 12, 13, 16, 17, 18].map((n) => ({
			value: id(n),
			party_id: id({ 12: 10, 13: 10, 18: 16 }[n] ?? n),
		})),
	);
});

test("each value it does not copy is listed, with why", () => {
	// biome-ignore format: one row per value
	assert.deepEqual(report, [
		[id(10), "contact_state", "do_not_contact", "do not contact without a reason"],
		[id(10), "email", "bad@example", "not an email address"],
		[id(11), "email", "ask the front desk", "not an email address"],
		[id(11), "npi", NPI, `also held by ${id(10)}`],
		[id(11), "phone", "555-0100", "not a phone number"],
		[id(12), "npi", "9000000023", "its record holds another NPI"],
		[id(14), "party", "Example 14", "deleted"],
		[id(15), "party", "Example 15", "merged into a record not copied"],
		[id(16), "contact_state", "paused until 2027-01-04", "no place in the new database"],
		[id(16), "npi", "9000000016", "not an NPI"],
		[id(17), "cell", "217-555-0104 (fax)", "not a phone number"],
		[id(17), "contact_state", "nurture", "no place in the new database"],
		[id(17), "email", "@example.com; ok@example.com", "not an email address"],
	]);
});

test("each row keeps when it was stored, and names the partner who last changed it, or the old system", async () => {
	const stamp = `distinct created_at::text, changed_by_user_id, changed_by_job, changed_at::text`;
	const byPartner = {
		created_at: "2024-03-04 05:06:07+00",
		changed_by_user_id: PARTNER,
		changed_by_job: null,
		changed_at: "2025-01-02 03:04:05+00",
	};
	for (const [table, key] of [
		["party", "id"],
		["party_email", "party_id"],
		["party_phone", "party_id"],
	] as const)
		assert.deepEqual(
			await rows(`select ${stamp} from ${table} where ${key} = '${id(10)}'`),
			[byPartner],
			table,
		);
	assert.deepEqual(
		await rows(`select ${stamp} from party where id = '${id(11)}'`),
		[
			{
				created_at: "2025-01-01 00:00:00+00",
				changed_by_user_id: null,
				changed_by_job: "old_system",
				changed_at: "2025-02-03 04:05:06+00",
			},
		],
	);
});

test("each address in an email is a work row in lower case, once, and the first stored is primary", async () => {
	// biome-ignore format: one row per address
	assert.deepEqual(await rows("select party_id, address, label, is_primary from party_email order by address"), [
		{ party_id: id(10), address: "avery@example.com", label: "work", is_primary: true },
		{ party_id: id(10), address: "merged@example.com", label: "work", is_primary: false },
		{ party_id: id(17), address: "ok@example.com", label: "work", is_primary: true },
		{ party_id: id(10), address: "second@example.net", label: "work", is_primary: false },
	]);
});

test("a phone is a work number and a cell a mobile one, in E.164 with the extension apart, and the first stored is primary", async () => {
	// biome-ignore format: one row per number
	assert.deepEqual(await rows("select party_id, number, extension, label, is_primary from party_phone order by party_id, number"), [
		{ party_id: id(10), number: "+12175550100", extension: "12", label: "work", is_primary: true },
		{ party_id: id(10), number: "+12175550101", extension: null, label: "mobile", is_primary: false },
		{ party_id: id(10), number: "+12175550105", extension: null, label: "mobile", is_primary: false },
		{ party_id: id(11), number: "+12175550102", extension: null, label: "mobile", is_primary: true },
		{ party_id: id(16), number: "+12175550103", extension: null, label: "work", is_primary: true },
		{ party_id: id(17), number: "+442079460958", extension: "7", label: "work", is_primary: true },
	]);
});

test("do not contact keeps its reason and who set it and when, and a survivor takes its duplicate's", async () => {
	assert.deepEqual(
		await rows(
			"select party_id, reason, created_at::text, changed_by_user_id, changed_by_job, changed_at::text from do_not_contact order by party_id",
		),
		[
			{
				party_id: id(10),
				reason: "Example asked again",
				created_at: "2025-07-08 09:10:11+00",
				changed_by_user_id: null,
				changed_by_job: "old_system",
				changed_at: "2025-07-08 09:10:11+00",
			},
			{
				party_id: id(11),
				reason: "Example asked us to stop",
				created_at: "2025-05-06 07:08:09+00",
				changed_by_user_id: PARTNER,
				changed_by_job: null,
				changed_at: "2025-05-06 07:08:09+00",
			},
		],
	);
});

test("an NPI stays with the first record that holds it, and a survivor without one takes its duplicate's", async () => {
	assert.deepEqual(
		await rows("select id, npi from party where npi is not null order by id"),
		[
			{ id: id(10), npi: NPI },
			{ id: id(16), npi: "9000000031" },
		],
	);
});

test("a second run copies only what is new, finds a record merged since through the map, and lists again what it left", () =>
	rolledBack(async () => {
		const merged = `select set_config('engine.user_id', '${PARTNER}', true), merge_party('${id(17)}', '${id(16)}');
			${oldParty(20, { merged_into: id(17), email: "late@example.com" })} ${oldParty(21, { npi: ` ${NPI} ` })}`;
		// biome-ignore format: one row per value
		assert.deepEqual(await copy(merged), [
			[id(14), "party", "Example 14", "deleted"],
			[id(15), "party", "Example 15", "merged into a record not copied"],
			[id(20), "party", "Example 20", "merged into a record copied before, so its values are not copied"],
			[id(21), "npi", ` ${NPI} `, `also held by ${id(10)}`],
		]);
		assert.deepEqual(
			await rows(
				`select value, party_id from outside_id where value in ('${id(17)}', '${id(20)}', '${id(21)}') order by value`,
			),
			[
				{ value: id(17), party_id: id(16) },
				{ value: id(20), party_id: id(16) },
				{ value: id(21), party_id: id(21) },
			],
		);
	}));

test("after the copy, a change is stamped with who made it again", () =>
	rolledBack(async () => {
		await db.query(`select set_config('engine.job', '', true), set_config('engine.user_id', '${PARTNER}', true);
			update party set name = 'Example renamed' where id = '${id(10)}';
			update party_email set label = 'personal';
			update party_phone set label = 'home';
			insert into do_not_contact (party_id, reason) values ('${id(16)}', 'Example asked us to stop')`);
		for (const table of [
			"party",
			"party_email",
			"party_phone",
			"do_not_contact",
		])
			assert.deepEqual(
				await rows(
					`select distinct changed_by_user_id, changed_by_job from ${table} where changed_at = now()`,
				),
				[{ changed_by_user_id: PARTNER, changed_by_job: null }],
				table,
			);
	}));
