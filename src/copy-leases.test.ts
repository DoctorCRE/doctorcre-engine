import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sql = (file: string) =>
	readFile(new URL(`../schema/${file}`, import.meta.url), "utf8");
const schema = await sql("next.sql");
const attribution = await sql("copy-attribution.sql");
const copy = await sql("copy-leases.sql");
const name = `copy_leases_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (text: string) => (await db.query(text)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	const result = await db.query(copy);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const reasons = (report: pg.QueryResultRow[], n: number) =>
	report.filter((r) => r.old_id === id(n)).map((r) => r.reason);
const file = (n: number) =>
	`('${id(n)}', 'deal', '${id(10)}', 'leases/${n}.pdf', 'Example lease ${n}.pdf', 'application/pdf', '${sha(n)}', 1000, '${id(1)}')`;
const sha = (n: number) => String(n).repeat(22).slice(0, 64);
const lease = (n: number, columns: string, values: string) =>
	`insert into public.lease (id, created_by, created_at, updated_at, ${columns}) values ('${id(n)}', '${id(1)}', '2025-01-01', '2025-03-01', ${values});`;
let report: pg.QueryResultRow[];
before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User'), ('${id(2)}', 'company', 'Example Client');
 insert into app_user values ('${id(1)}');
 insert into how_found values ('referral', 'Example referral');
 update party set how_found = 'referral';
 insert into role (slug, label) values ('client', 'Example client');
 insert into party_role (party_id, role) values ('${id(2)}', 'client');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(1)}', '${id(1)}'), ('old_system', '${id(6)}', '${id(2)}');
 insert into deal (id, name, owner_user_id) values ('${id(10)}', 'Example deal', '${id(1)}'), ('${id(11)}', 'Example other deal', '${id(1)}');
 insert into deal_party (deal_id, party_id, role) values ('${id(10)}', '${id(2)}', 'client'), ('${id(11)}', '${id(2)}', 'client');
 insert into property (id, address) values ('${id(90)}', '100 Example Way');
 insert into deal_property (deal_id, property_id) values ('${id(10)}', '${id(90)}');
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) values ('${id(6)}', 'org', 'Example Client', '${id(1)}', '${id(1)}');
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(3)}', '${id(6)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('closed', 'Example closed');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by) select v, '${id(3)}', 'Example deal', 'lease', 'closed', 'partner_one', '${id(1)}', '${id(1)}'
 from unnest(array['${id(10)}'::uuid, '${id(11)}'::uuid, '${id(12)}'::uuid]) v;
 insert into public.building (id, address, city, state, zip, created_by, updated_by, updated_at) values
 ('${id(90)}', '100 Example Way', '', '', '', '${id(1)}', '${id(1)}', '2025-01-01'), ('${id(91)}', '200 Example Way', 'Example City', 'TX', '75000', '${id(1)}', '${id(1)}', '2025-01-02');
 insert into public.space (id, building_id, suite, created_by, updated_by) values ('${id(92)}', '${id(90)}', ' Suite 100 ', '${id(1)}', '${id(1)}'),
 ('${id(160)}', '${id(90)}', null, '${id(1)}', '${id(1)}'), ('${id(93)}', '${id(91)}', 'B1', '${id(1)}', '${id(1)}'), ('${id(163)}', '${id(91)}', 'B1', '${id(1)}', '${id(1)}');
 update public.space set floor = 1, area_amount = 1200, area_basis = 'rentable', condition = 'Shell' where id = '${id(92)}';
 insert into public.premises (id, deal_id, label, created_by) values ('${id(94)}', '${id(10)}', 'Example', '${id(1)}'),
 ('${id(95)}', null, 'Example', '${id(1)}'), ('${id(96)}', null, 'Example', '${id(1)}');
 insert into public.premises_space values ('${id(94)}', '${id(92)}'), ('${id(94)}', '${id(160)}'), ('${id(95)}', '${id(93)}'), ('${id(96)}', '${id(92)}'), ('${id(96)}', '${id(93)}');
 insert into public.attachment (id, subject_type, subject_id, r2_key, filename, mime, sha256, bytes, created_by) values
 ${[200, 201, 202, 203, 204].map(file).join(", ")};
 ${lease(100, "deal_id, client_id, premises_id, doc_attachment, executed_on, commencement_on, expiration_on, rate_amount, rate_basis, term_months, ti_amount, free_rent_months, escalator, options_note, opex_structure, evidence_kind, evidence_ref, status, source", `'${id(10)}', '${id(3)}', '${id(94)}', '${id(200)}', '2024-12-01', '2025-02-01', '2030-01-31', 2, 'usd_sf_mo', 60, 20, 2, '3% each year', 'Two five-year renewals', 'NNN', 'executed_lease', 'Example lease file', 'superseded', 'stated'`)}
 ${lease(101, "deal_id, client_id, premises_id, doc_attachment, expiration_on, rate_amount, rate_basis, supersedes_lease_id, status", `'${id(10)}', '${id(3)}', '${id(94)}', '${id(201)}', '2032-01-31', 5000, 'usd_mo_gross', '${id(100)}', 'superseded'`)}
 ${lease(102, "deal_id, client_id, premises_id, expiration_on, evidence_kind, evidence_ref, supersedes_lease_id", `'${id(10)}', '${id(3)}', '${id(94)}', '2034-01-31', 'lease_amendment', 'Example email', '${id(101)}'`)}
 ${lease(103, "deal_id, client_id, premises_id, doc_attachment, expiration_on, supersedes_lease_id", `'${id(10)}', '${id(3)}', '${id(94)}', '${id(203)}', '2036-01-31', '${id(102)}'`)}
 ${lease(110, "client_id, premises_id, doc_attachment, expiration_on, status", `'${id(3)}', '${id(95)}', '${id(202)}', '2027-06-30', 'legacy_unverified'`)}
 ${lease(111, "client_id, premises_id, doc_attachment, expiration_on", `'${id(3)}', '${id(96)}', '${id(204)}', '2027-06-30'`)}
 ${lease(112, "client_id, premises_id, doc_attachment, commencement_on, expiration_on", `'${id(3)}', '${id(95)}', '${id(204)}', '2027-06-30', '2027-06-30'`)}
 ${lease(120, "deal_id, client_id, premises_id, doc_attachment, expiration_on", `'${id(12)}', '${id(3)}', '${id(94)}', '${id(204)}', '2027-06-30'`)}
 ${lease(121, "deal_id, client_id, premises_id, doc_attachment", `'${id(11)}', '${id(3)}', '${id(94)}', '${id(204)}'`)}
 ${lease(130, "client_id, premises_id, doc_attachment, expiration_on", `'${id(3)}', '${id(95)}', '${id(204)}', '2027-06-30'`)}
 ${lease(131, "client_id, premises_id, doc_attachment, expiration_on, supersedes_lease_id", `'${id(3)}', '${id(95)}', '${id(204)}', '2027-06-30', '${id(130)}'`)}
 update public.lease set supersedes_lease_id = '${id(131)}' where id = '${id(130)}';
 commit;`);
	await db.query("begin");
	report = await run();
	await db.query("commit");
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("a deal's amendment chain becomes one lease with consecutive versions on its deal, client and building", async () => {
	assert.deepEqual(
		await rows(
			`select id, deal_id, party_id, property_id, created_at::text from lease where deal_id = '${id(10)}'`,
		),
		[
			{
				id: id(100),
				deal_id: id(10),
				party_id: id(2),
				property_id: id(90),
				created_at: "2025-01-01 00:00:00+00",
			},
		],
	);
	assert.deepEqual(
		await rows(
			`select id, version, document_id, changed_by_user_id, changed_at::text from lease_version where lease_id = '${id(100)}' order by version`,
		),
		[
			{
				id: id(100),
				version: 1,
				document_id: id(200),
				changed_by_user_id: id(1),
				changed_at: "2025-03-01 00:00:00+00",
			},
			{
				id: id(101),
				version: 2,
				document_id: id(201),
				changed_by_user_id: id(1),
				changed_at: "2025-03-01 00:00:00+00",
			},
		],
	);
	assert.deepEqual(reasons(report, 102), ["no_source_file"]);
	assert.deepEqual(reasons(report, 103), ["earlier_version_not_copied"]);
});

test("known dates and per-foot rent copy; other wording stays in other terms and nothing is inferred", async () => {
	// biome-ignore format: one row per version
	assert.deepEqual((await rows(`select executed_on::text, commencement_on::text, expiration_on::text, rent_per_sf_yr, term_months, ti_per_sf, free_rent_months, escalation_pct, expense_structure, other_terms from lease_version where lease_id = '${id(100)}' order by version`)).map(Object.values), [
 ["2024-12-01", "2025-02-01", "2030-01-31", "24.00", 60, null, "2.0", null, "NNN", "TI: 20.00\nEscalator: 3% each year\nOptions: Two five-year renewals"],
 [null, null, "2032-01-31", null, null, null, null, null, null, "Rent: 5000.00 usd_mo_gross"],
 ]);
	assert.deepEqual(await rows("select * from lease_option"), []);
	assert.deepEqual(
		report.filter((r) => r.old_id === id(100)).map((r) => [r.field, r.reason]),
		[
			["evidence", "no_typed_destination"],
			["options_note", "option_terms_unparsed"],
		],
	);
});

test("source files become stored documents, waiting to be filed to their deal", async () => {
	assert.deepEqual(
		await rows(
			`select name, r2_bucket, r2_key, content_type, sha256, bytes, deal_id, kind from document where id = '${id(200)}'`,
		),
		[
			{
				name: "Example lease 200.pdf",
				r2_bucket: "deal_documents",
				r2_key: "leases/200.pdf",
				content_type: "application/pdf",
				sha256: sha(200),
				bytes: "1000",
				deal_id: null,
				kind: null,
			},
		],
	);
});

test("a lease negotiated elsewhere names only its tenant and building, and its ending is on the work list", async () => {
	assert.deepEqual(
		await rows(
			`select lease_id, deal_id, party_id, property_id, expiration_on::text from lease_ending order by expiration_on`,
		),
		[
			{
				lease_id: id(110),
				deal_id: null,
				party_id: id(2),
				property_id: id(91),
				expiration_on: "2027-06-30",
			},
			{
				lease_id: id(100),
				deal_id: id(10),
				party_id: id(2),
				property_id: id(90),
				expiration_on: "2032-01-31",
			},
		],
	);
	assert.deepEqual(
		await rows(`select address from property where id = '${id(91)}'`),
		[{ address: "200 Example Way, Example City, TX, 75000" }],
	);
});

test("each copied version covers its premises' spaces as suites, and a label shared in one building waits", async () => {
	// biome-ignore format: one row per suite
	assert.deepEqual((await rows("select id, property_id, label, floor, area_sf, area_basis, condition from suite order by id")).map(Object.values), [
 [id(92), id(90), "Suite 100", 1, "1200.0", "rentable", "Shell"],
 [id(160), id(90), null, null, null, null, null],
 ]);
	assert.deepEqual(
		(
			await rows(
				"select lease_version_id, suite_id from lease_suite order by 1, 2",
			)
		).map(Object.values),
		[
			[id(100), id(92)],
			[id(100), id(160)],
			[id(101), id(92)],
			[id(101), id(160)],
		],
	);
	assert.deepEqual(reasons(report, 93), [
		"suite_not_copied",
		"duplicate_suite_label",
	]);
});

test("leases that cannot map are listed with a reason, never invented", async () => {
	assert.ok(reasons(report, 111).includes("several_properties"));
	assert.ok(reasons(report, 112).includes("dates_out_of_order"));
	assert.ok(reasons(report, 120).includes("deal_not_copied"));
	assert.ok(reasons(report, 121).includes("no_expiration"));
	assert.ok(reasons(report, 121).includes("property_not_on_deal"));
	assert.deepEqual(reasons(report, 130), ["no_first_version"]);
	assert.deepEqual(reasons(report, 131), ["no_first_version"]);
	assert.deepEqual(
		await rows(
			`select id from lease where id not in ('${id(100)}', '${id(110)}')`,
		),
		[],
	);
});

test("a repeat changes nothing", async () => {
	const tables = [
		"lease",
		"lease_version",
		"document",
		"property",
		"suite",
		"lease_suite",
		"change",
	];
	const snapshot = async () => {
		const all = [];
		for (const t of tables)
			all.push(await rows(`select * from ${t} order by 1`));
		return all;
	};
	const before = await snapshot();
	await db.query("begin");
	const again = await run();
	await db.query("commit");
	assert.deepEqual(await snapshot(), before);
	assert.deepEqual(reasons(again, 102), ["no_source_file"]);
});

test("a later run adds an amendment once its source file is known", async () => {
	await db.query("begin");
	try {
		await db.query(
			`update public.lease set doc_attachment = '${id(203)}' where id = '${id(102)}'`,
		);
		await run();
		assert.deepEqual(
			await rows(
				`select id, version from current_lease where lease_id = '${id(100)}'`,
			),
			[{ id: id(103), version: 4 }],
		);
	} finally {
		await db.query("rollback");
	}
});

test("values the new columns cannot hold, unresolved buildings and taken ids are listed without aborting the copy", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into public.attachment (id, subject_type, subject_id, r2_key, filename, mime, sha256, bytes, created_by) values ${[205, 206].map(file).join(", ")};
 update public.attachment set mime = ' ' where id = '${id(205)}';
 insert into document (name, r2_bucket, r2_key, content_type, sha256, bytes) values ('Example', 'deal_documents', 'leases/206.pdf', 'text/plain', '${sha(206)}', 7);
 insert into public.building (id, address, merged_into, created_by, updated_by) values ('${id(99)}', '300 Example Way', '${id(99)}', '${id(1)}', '${id(1)}');
 insert into public.space (id, building_id, created_by, updated_by) values ('${id(98)}', '${id(99)}', '${id(1)}', '${id(1)}');
 insert into public.premises (id, label, created_by) values ('${id(97)}', 'Example', '${id(1)}');
 insert into public.premises_space values ('${id(97)}', '${id(93)}'), ('${id(97)}', '${id(98)}');
 insert into lease (id, party_id, property_id) values ('${id(144)}', '${id(2)}', '${id(90)}');
 insert into lease_version (id, lease_id, version, document_id, expiration_on) values ('${id(145)}', '${id(144)}', 1, '${id(200)}', '2027-06-30');
 ${lease(140, "client_id, premises_id, doc_attachment, expiration_on", `'${id(3)}', '${id(95)}', '${id(205)}', '2027-06-30'`)}
 ${lease(141, "client_id, premises_id, doc_attachment, expiration_on, rate_amount, rate_basis, opex_structure", `'${id(3)}', '${id(95)}', '${id(204)}', '2027-06-30', 100000000, 'usd_sf_yr', E'\\t'`)}
 ${lease(142, "client_id, premises_id, doc_attachment, expiration_on", `'${id(3)}', '${id(97)}', '${id(204)}', '2027-06-30'`)}
 ${lease(143, "client_id, premises_id, doc_attachment, expiration_on", `'${id(3)}', '${id(95)}', '${id(206)}', '2027-06-30'`)}
 ${["144", "145"].map((n) => lease(Number(n), "client_id, premises_id, doc_attachment, expiration_on", `'${id(3)}', '${id(95)}', '${id(204)}', '2027-06-30'`)).join("\n")}`);
		const refused = await run();
		assert.deepEqual(reasons(refused, 140), ["source_file_incomplete"]);
		assert.deepEqual(reasons(refused, 142), ["building_merge_unresolved"]);
		assert.deepEqual(reasons(refused, 143), ["source_file_conflict"]);
		assert.deepEqual(reasons(refused, 144), [
			"lease_id_taken",
			"version_number_taken",
		]);
		assert.deepEqual(reasons(refused, 145), ["version_id_taken"]);
		assert.deepEqual(
			await rows(
				`select rent_per_sf_yr, expense_structure, other_terms from lease_version where id = '${id(141)}'`,
			),
			[
				{
					rent_per_sf_yr: null,
					expense_structure: null,
					other_terms: "Rent: 100000000.00 usd_sf_yr",
				},
			],
		);
	} finally {
		await db.query("rollback");
	}
});

test("a copied lease whose building later changes is listed and left as it was", async () => {
	await db.query("begin");
	try {
		await db.query(
			`update public.lease set premises_id = '${id(94)}' where id = '${id(110)}'`,
		);
		const again = await run();
		assert.ok(reasons(again, 110).includes("lease_id_taken"));
		assert.deepEqual(
			await rows(`select property_id from lease where id = '${id(110)}'`),
			[{ property_id: id(91) }],
		);
	} finally {
		await db.query("rollback");
	}
});
