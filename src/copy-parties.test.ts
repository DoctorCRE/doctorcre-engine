import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PARTNER = id(1);
const AUTOMATION = id(2);
const SYSTEM = id(3);
// Made up. No NPI issued yet starts with 9, so none can be anyone's.
const NPI = "9000000015";

const COPY = await readSchema("copy-parties.sql");
const COPY_VENDORS = await readSchema("copy-vendors.sql");

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
	('${PARTNER}', 'partner_one', 'human', 'Jordan Example'),
	('${AUTOMATION}', 'example-job', 'automation', 'Example job'),
	('${SYSTEM}', 'example-system', 'system', 'Example system');
insert into public.contact_state (slug, label, contactable, sort) values
	('active', 'Example active', true, 10), ('nurture', 'Example nurture', true, 20),
	('paused', 'Example paused', false, 30), ('do_not_contact', 'Example do not contact', false, 40);
${oldParty(14, { deleted_at: "2026-01-05T00:00:00Z" })} ${oldParty(15, { merged_into: id(14) })}
${oldParty(11, {
	kind: "org",
	name: "Example Dental Group",
	city: " \t ",
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
	specialty: "Dental",
	ref: " P-0011 ",
	org_id: id(11),
})}
${oldParty(25, { kind: "org", merged_into: id(11) })}
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
	specialty: "GP; Ortho, ORTHO,",
	ref: "P-0010",
	org_id: id(11),
	title: " Office Manager ",
	city: " Springfield \t",
	state: "IL",
	county: "Example County",
	contact_state_cadence: "quarterly",
	notes_path: "notes/example-10.md",
})}
${oldParty(12, {
	merged_into: id(10),
	created_at: "2024-01-01T00:00:00Z",
	npi: "9000000023",
	email: "Merged@example.com avery@example.com",
	cell: "217-555-0105",
	specialty: " gp",
	org_id: id(11),
	title: "Manager",
})}
${oldParty(13, {
	merged_into: id(12),
	contact_state: "do_not_contact",
	contact_state_reason: "Example asked again",
	contact_state_set_at: "2025-07-08T09:10:11Z",
	ref: "P-0013",
})}
${oldParty(16, {
	npi: "9000000016",
	phone: "+1 217 555 0103",
	cell: "2175550103",
	contact_state: "paused",
	contact_state_reason: "Example pause",
	contact_state_until: "2027-01-04",
	specialty: "\tPhysical Therapy",
	org_id: id(14),
})}
${oldParty(18, { merged_into: id(16), npi: "9000000031", title: "Owner" })}
${oldParty(17, {
	email: "@example.com; ok@example.com",
	phone: "+44 20 7946 0958 x7",
	cell: "217-555-0104 (fax)",
	contact_state: "nurture",
	specialty: "--",
	org_id: id(16),
	title: "Dentist",
})}
${oldParty(26, { org_id: id(25) })}
${oldParty(27, { merged_into: id(26), org_id: id(11), title: "Lead" })}
insert into public.vendor_disposition (slug, label, workable, sort) values ('active', 'Example active', true, 10);
insert into public.lead_stage (slug, label) values ('example', 'Example stage');
insert into public.vendor (id, party_id, category, created_by, updated_by) values
	('${id(40)}', '${id(16)}', 'example', '${SYSTEM}', '${SYSTEM}'),
	('${id(41)}', '${id(17)}', 'example', '${SYSTEM}', '${SYSTEM}');
insert into public.lead (id, party_id, stage, created_by, updated_by) values
	('${id(42)}', '${id(11)}', 'example', '${SYSTEM}', '${SYSTEM}'),
	('${id(43)}', '${id(14)}', 'example', '${SYSTEM}', '${SYSTEM}');
insert into public.client (id, party_id, created_by, updated_by) values ('${id(44)}', '${id(12)}', '${SYSTEM}', '${SYSTEM}');
insert into public.record_source (entity_type, entity_id, source_system, external_key) values
	('vendor', '${id(40)}', 'vendors.xlsx', 'V-EX-001'),
	('vendor', '${id(41)}', 'Vendors XLSX', 'V-EX-001'),
	('lead', '${id(42)}', 'Lead Registry.', 'L-EX-002'),
	('lead', '${id(43)}', 'lead-registry', 'L-EX-001'),
	('client', '${id(44)}', 'client-roster', ' C-EX-001 '),
	('client', '${id(44)}', 'dup_candidate', 'C-EX-001:C-EX-002'),
	('client', '${id(44)}', '2024 import', 'X-EX-1'),
	('client', '${id(44)}', 'client-roster-2', ' '),
	('party', '${id(16)}', 'example-brokers', 'B-EX-1'),
	('vendor', '${id(30)}', 'vendors.xlsx', 'V-EX-030'),
	('contact', '${id(16)}', 'example-contacts', 'K-EX-1'),
	('lead', '${id(17)}', 'lead-registry', 'L-EX-017'),
	('party', '${id(11)}', 'Old System', 'X-EX-2'),
	('activity', '${id(31)}', 'example-ledger', 'A-EX-1'),
	('deal', '${id(32)}', 'example-deals', 'D-EX-1');
`;

const { db, setup, cleanup } = copyTest();

const copyResults = async (sql = "") =>
	(await db.query(sql + COPY)) as unknown as pg.QueryResult[];
const copy = async (sql = "") =>
	(await copyResults(sql)).at(-1)?.rows.map((row) => Object.values(row));
const rows = async (query: string) => (await db.query(query)).rows;
const rolledBack = async (check: () => Promise<void>) => {
	await db.query("begin");
	try {
		await check();
	} finally {
		await db.query("rollback");
	}
};
let report: Awaited<ReturnType<typeof copy>>;

before(async () => {
	await setup();
	report = await copy(OLD);
});

after(cleanup);

test("people and companies keep their ids and names, a company is no longer an org, and a partner is a user", async () => {
	assert.deepEqual(await rows("select id, kind, name from party order by id"), [
		{ id: PARTNER, kind: "person", name: "Jordan Example" },
		{ id: id(10), kind: "person", name: "Example 10" },
		{ id: id(11), kind: "company", name: "Example Dental Group" },
		{ id: id(16), kind: "person", name: "Example 16" },
		{ id: id(17), kind: "person", name: "Example 17" },
		{ id: id(26), kind: "person", name: "Example 26" },
	]);
	assert.deepEqual(await rows("select id from app_user"), [{ id: PARTNER }]);
});

test("each old id maps to the record it became, a merged-away one to where its merges end", async () => {
	assert.deepEqual(
		await rows(
			"select value, party_id from outside_id where source = 'old_system' order by value",
		),
		[1, 10, 11, 12, 13, 16, 17, 18, 25, 26, 27].map((n) => ({
			value: id(n),
			party_id: id({ 12: 10, 13: 10, 18: 16, 25: 11, 27: 26 }[n] ?? n),
		})),
	);
});

test("the copy trims the recorded city and leaves missing or blank cities null", async () => {
	assert.deepEqual(
		await rows(
			`select id, city from party where id in ('${id(10)}', '${id(11)}', '${id(16)}') order by id`,
		),
		[
			{ id: id(10), city: "Springfield" },
			{ id: id(11), city: null },
			{ id: id(16), city: null },
		],
	);
});

test("the database refuses an untrimmed or blank city", async () => {
	for (const city of [" Example", "Example\t", "", " \t "]) {
		await rolledBack(async () => {
			await db.query("select set_config('engine.job', 'old_system', true)");
			await assert.rejects(
				db.query("update party set city = $1 where id = $2", [city, id(10)]),
				{ code: "23514", constraint: "party_city_check" },
			);
		});
	}
});

test("each value it does not copy is listed, with why", async () => {
	assert.deepEqual(await rows("select * from party_role"), []);
	// biome-ignore format: one row per value
	assert.deepEqual(report, [
		[id(10), "contact_state", "do_not_contact", "do not contact without a reason"],
		[id(10), "contact_state_cadence", "quarterly", "no place in the new database"],
		[id(10), "county", "Example County", "no place in the new database"],
		[id(10), "email", "bad@example", "not an email address"],
		[id(10), "notes_path", "notes/example-10.md", "no place in the new database"],
		[id(10), "state", "IL", "no place in the new database"],
		[id(11), "email", "ask the front desk", "not an email address"],
		[id(11), "npi", NPI, `also held by ${id(10)}`],
		[id(11), "org_id", id(11), "company links are only kept as brand memberships"],
		[id(11), "phone", "555-0100", "not a phone number"],
		[id(11), "record_source", "Old System X-EX-2", "a source the copy keeps for itself"],
		[id(11), "specialty", "Dental", "only a person holds a specialty"],
		[id(12), "npi", "9000000023", "its record holds another NPI"],
		[id(12), "record_source", "2024 import X-EX-1", "not an outside id"],
		[id(12), "record_source", "client-roster-2  ", "not an outside id"],
		[id(12), "record_source", "dup_candidate C-EX-001:C-EX-002", "a hint of a duplicate, not an id"],
		[id(12), "title", "Manager", "its record holds another title there"],
		[id(14), "party", "Example 14", "deleted"],
		[id(14), "record_source", "lead-registry L-EX-001", "its record is not copied"],
		[id(15), "party", "Example 15", "merged into a record not copied"],
		[id(16), "npi", "9000000016", "not an NPI"],
		[id(16), "org_id", id(14), "its company is not copied"],
		[id(16), "record_source", "example-contacts K-EX-1", "no place in the new database"],
		[id(17), "cell", "217-555-0104 (fax)", "not a phone number"],
		[id(17), "contact_state", "nurture", "its record has no lead role"],
		[id(17), "email", "@example.com; ok@example.com", "not an email address"],
		[id(17), "org_id", id(16), "not a company"],
		[id(17), "record_source", "lead-registry L-EX-017", "its record is not copied"],
		[id(17), "record_source", "Vendors XLSX V-EX-001", `also the id of ${id(16)}`],
		[id(17), "specialty", "--", "not a specialty"],
		[id(17), "title", "Dentist", "its company is not copied"],
		[id(18), "title", "Owner", "a title without a company"],
		[id(30), "record_source", "vendors.xlsx V-EX-030", "its record is not copied"],
	]);
});

for (const [label, kind, client, reported] of [
	["unmerged company client", "org", "unmerged", false],
	["merged company client", "org", "merged", true],
	["company without a client", "org", "none", true],
	["person client merged into a company", "person", "unmerged", true],
] as const) {
	test(`a company parent belongs to the brand copy only for a source company client: ${label}`, () =>
		rolledBack(async () => {
			let setup = oldParty(80, { kind, org_id: id(11) });
			if (kind === "person")
				setup =
					oldParty(81, { kind: "org" }) +
					oldParty(80, { kind, org_id: id(11), merged_into: id(81) });
			if (client !== "none") {
				const mergedInto = client === "merged" ? `'${id(44)}'` : "null";
				setup += `insert into public.client (id, party_id, merged_into, created_by, updated_by)
					values ('${id(180)}', '${id(80)}', ${mergedInto}, '${SYSTEM}', '${SYSTEM}');`;
			}
			const first = await copy(setup);
			const expected = reported
				? [
						[
							id(80),
							"org_id",
							id(11),
							"company links are only kept as brand memberships",
						],
					]
				: [];
			assert.deepEqual(
				first?.filter((row) => row[0] === id(80)),
				expected,
			);
			await db.query("discard temp");
			assert.deepEqual(await copy(), first);
		}));
}

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
		["party_specialty", "person_id"],
		["party_company", "person_id"],
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
			"select party_id, reason, created_at::text, changed_by_user_id, changed_by_job, changed_at::text from do_not_contact where until_date is null order by party_id",
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

test("a person's specialties are on the specialty list once however spelled, labelled as first typed", async () => {
	assert.deepEqual(
		await rows("select slug, label from specialty order by slug"),
		[
			{ slug: "gp", label: "gp" },
			{ slug: "ortho", label: "Ortho" },
			{ slug: "physical_therapy", label: "Physical Therapy" },
		],
	);
	assert.deepEqual(
		await rows(
			"select person_id, specialty from party_specialty order by person_id, specialty",
		),
		[
			{ person_id: id(10), specialty: "gp" },
			{ person_id: id(10), specialty: "ortho" },
			{ person_id: id(16), specialty: "physical_therapy" },
		],
	);
});

test("a person keeps their company, through its merges, and a title from the survivor first, then any", async () => {
	// biome-ignore format: one row per place
	assert.deepEqual(await rows("select person_id, company_id, title, started_on, ended_on from party_company order by person_id"), [
		{ person_id: id(10), company_id: id(11), title: "Office Manager", started_on: null, ended_on: null },
		{ person_id: id(26), company_id: id(11), title: "Lead", started_on: null, ended_on: null },
	]);
});

test("placeholder employers stay out of the copy while vendor contacts and real company links carry over", () =>
	rolledBack(async () => {
		const first = await copyResults(
			oldParty(90, { kind: "org", name: "(TBD — enrich)", ref: "P-0090" }) +
				oldParty(91, { kind: "org", name: "(TBD)" }) +
				oldParty(92, { kind: "org", name: "Example TBD Holdings" }) +
				oldParty(93, { kind: "org", name: "(TBD Holdings)" }) +
				oldParty(94, { kind: "org", name: "(TBD)", merged_into: id(92) }) +
				oldParty(95, { org_id: id(90), title: "Example broker" }) +
				oldParty(96, { org_id: id(91) }) +
				oldParty(97, { org_id: id(94) }) +
				`insert into public.vendor (id, party_id, category, created_by, updated_by)
					values ('${id(98)}', '${id(95)}', 'example', '${SYSTEM}', '${SYSTEM}');`,
		);
		await db.query("discard temp");
		await db.query(COPY_VENDORS);

		assert.deepEqual(
			await rows(
				`select id, kind, name from party where id between '${id(90)}' and '${id(97)}' order by id`,
			),
			[
				{ id: id(92), kind: "company", name: "Example TBD Holdings" },
				{ id: id(93), kind: "company", name: "(TBD Holdings)" },
				{ id: id(95), kind: "person", name: "Example 95" },
				{ id: id(96), kind: "person", name: "Example 96" },
				{ id: id(97), kind: "person", name: "Example 97" },
			],
		);
		assert.deepEqual(
			await rows(`select value, party_id from outside_id
				where value in ('${id(90)}', '${id(91)}', '${id(94)}', 'P-0090') order by value`),
			[{ value: id(94), party_id: id(92) }],
		);
		assert.deepEqual(
			await rows(`select person_id, company_id from party_company
				where person_id between '${id(95)}' and '${id(97)}' order by person_id`),
			[{ person_id: id(97), company_id: id(92) }],
		);
		assert.deepEqual(
			await rows(`select role from party_role where party_id = '${id(95)}'`),
			[{ role: "vendor" }],
		);
		assert.deepEqual(first.at(-2)?.rows, [
			{ skipped_companies: "2", skipped_affiliations: "2" },
		]);

		const changes = await rows("select count(*) from change");
		await db.query("discard temp");
		const again = await copyResults();
		assert.deepEqual(
			again.slice(-2).map((result) => result.rows),
			first.slice(-2).map((result) => result.rows),
		);
		await db.query("discard temp");
		await db.query(COPY_VENDORS);
		assert.deepEqual(await rows("select count(*) from change"), changes);
	}));

test("today's import history and reference numbers are outside ids of the record each old one became", async () => {
	// biome-ignore format: one row per id
	assert.deepEqual(await rows("select source, value, party_id from outside_id where source <> 'old_system' order by source, value"), [
		{ source: "client_roster", value: "C-EX-001", party_id: id(10) },
		{ source: "example_brokers", value: "B-EX-1", party_id: id(16) },
		{ source: "lead_registry", value: "L-EX-002", party_id: id(11) },
		{ source: "old_system_ref", value: "P-0010", party_id: id(10) },
		{ source: "old_system_ref", value: "P-0011", party_id: id(11) },
		{ source: "old_system_ref", value: "P-0013", party_id: id(10) },
		{ source: "vendors_xlsx", value: "V-EX-001", party_id: id(16) },
	]);
});

test("every copy folds an outside source to lower-case words joined by _ and trims only the space around its key", async () => {
	assert.deepEqual(
		await rows(`select k.* from (values ('  Vendors.XLSX ', E' \\tV-EX  1\\n'), ('--Lead  Registry 2--', 'L-EX-1'))
		as r (source_system, external_key) cross join lateral copy_outside_id(source_system, external_key) k`),
		[
			{ source: "vendors_xlsx", value: "V-EX  1" },
			{ source: "lead_registry_2", value: "L-EX-1" },
		],
	);
});

test("a second run copies only what is new, finds a record merged since through the map, and lists again what it left", () =>
	rolledBack(async () => {
		const merged = `select set_config('engine.user_id', '${PARTNER}', true), merge_party('${id(17)}', '${id(16)}');
			update specialty set label = 'Orthodontics' where slug = 'ortho';
			${oldParty(20, { merged_into: id(17), email: "late@example.com", city: "Example City" })}
			${oldParty(21, { npi: ` ${NPI} `, specialty: "ORTHO", ref: "P-0021" })}
			${oldParty(22, { merged_into: id(17), specialty: "Example" })}
			${oldParty(23, { merged_into: id(17), org_id: id(11) })}
			${oldParty(24, { merged_into: id(17), notes_path: "notes/example-24.md" })}
			${oldParty(28, { merged_into: id(17), title: "Example title" })}
			${oldParty(29, { merged_into: id(17), contact_state: "do_not_contact", contact_state_reason: "Example stop" })}`;
		const again = await copy(merged);
		assert.ok(report);
		// Merging 17 into 16 makes its vendor key belong to the record that already holds it.
		assert.deepEqual(
			again?.filter(
				(row) => ![20, 21, 22, 23, 24, 28, 29].some((n) => row[0] === id(n)),
			),
			report.filter(
				(row) => !(row[0] === id(17) && row[2] === "Vendors XLSX V-EX-001"),
			),
		);
		// biome-ignore format: one row per value
		assert.deepEqual(again?.filter((row) => [20, 21, 22, 23, 24, 28, 29].some((n) => row[0] === id(n))), [
			[id(20), "city", "Example City", "its record does not hold this city"],
			[id(20), "email", "late@example.com", "its record does not hold this value"],
			[id(21), "npi", ` ${NPI} `, `also held by ${id(10)}`],
			[id(22), "specialty", "Example", "its record does not hold this specialty"],
			[id(23), "org_id", id(11), "its record does not hold this company"],
			[id(24), "notes_path", "notes/example-24.md", "no place in the new database"],
			[id(28), "title", "Example title", "a title without a company"],
			[id(29), "contact_state", "do_not_contact", "its record does not hold this restriction"],
		]);
		await db.query("discard temp");
		assert.deepEqual(await copy(), again);
		assert.deepEqual(
			await rows(
				`select value, party_id from outside_id where value in ('${id(17)}', '${id(20)}', '${id(21)}', 'P-0021') order by value`,
			),
			[
				{ value: id(17), party_id: id(16) },
				{ value: id(20), party_id: id(16) },
				{ value: id(21), party_id: id(21) },
				{ value: "P-0021", party_id: id(21) },
			],
		);
		assert.deepEqual(
			await rows(
				`select s.slug, s.label from specialty s join party_specialty p on p.specialty = s.slug where p.person_id = '${id(21)}'`,
			),
			[{ slug: "ortho", label: "Orthodontics" }],
		);
	}));

test("a late-merged title names the missing company link when its company was copied", () =>
	rolledBack(async () => {
		const first = await copy(
			oldParty(70, {
				merged_into: id(16),
				org_id: id(11),
				title: "Example Partner",
			}),
		);
		assert.deepEqual(
			first?.filter((row) => row[0] === id(70)),
			[
				[id(70), "org_id", id(11), "its record does not hold this company"],
				[
					id(70),
					"title",
					"Example Partner",
					"its record does not hold this company",
				],
			],
		);
		assert.deepEqual(
			await rows(
				`select id from party where id = '${id(11)}' and kind = 'company'`,
			),
			[{ id: id(11) }],
		);
		assert.deepEqual(
			await rows(
				`select * from party_company where person_id = '${id(16)}' and company_id = '${id(11)}'`,
			),
			[],
		);
		await db.query("discard temp");
		assert.deepEqual(await copy(), first);
	}));

test("a rerun lists the full unchanged correction list without changing copied rows", () =>
	rolledBack(async () => {
		const saved = async () => {
			const state = [];
			for (const table of [
				"party",
				"app_user",
				"party_email",
				"party_phone",
				"do_not_contact",
				"party_role",
				"specialty",
				"party_specialty",
				"party_company",
				"outside_id",
				"change",
			])
				state.push(
					await rows(`select * from ${table} t order by to_jsonb(t)::text`),
				);
			return state;
		};
		const before = await saved();
		assert.deepEqual(await copy(), report);
		await db.query("discard temp");
		assert.deepEqual(await copy(), report);
		assert.deepEqual(await saved(), before);
	}));

test("previously copied source claims cannot take an NPI from a newly copied survivor", () =>
	rolledBack(async () => {
		await copy(
			oldParty(61, { npi: "9000000049" }) +
				oldParty(60, {
					merged_into: id(61),
					npi: "9000000023",
					created_at: "2020-01-01",
				}),
		);
		await db.query("discard temp");
		const copied = await copy(
			oldParty(62, { npi: "9000000023" }) +
				`update public.party set merged_into = '${id(62)}' where id = '${id(61)}';`,
		);
		assert.deepEqual(
			await rows(`select npi from party where id = '${id(62)}'`),
			[{ npi: "9000000023" }],
		);
		await db.query("discard temp");
		assert.deepEqual(await copy(), copied);
	}));

test("an unassigned competing NPI never names a record holding another NPI, including on reruns", () =>
	rolledBack(async () => {
		const first = await copy(
			oldParty(50, { npi: "9000000049", created_at: "2020-01-01" }) +
				oldParty(51, {
					merged_into: id(50),
					npi: "9000000023",
					created_at: "2020-01-02",
				}) +
				oldParty(52, { npi: "9000000023", created_at: "2020-01-03" }),
		);
		assert.deepEqual(
			first?.filter((row) => [id(51), id(52)].includes(String(row[0]))),
			[
				[id(51), "npi", "9000000023", "its record holds another NPI"],
				[id(52), "npi", "9000000023", "no record holds this NPI"],
			],
		);
		assert.deepEqual(
			await rows(
				`select id, npi from party where id in ('${id(50)}', '${id(52)}') order by id`,
			),
			[
				{ id: id(50), npi: "9000000049" },
				{ id: id(52), npi: null },
			],
		);
		await db.query("discard temp");
		assert.deepEqual(await copy(), first);
	}));

test("a mapped record relists a changed reference without copying it again", () =>
	rolledBack(async () => {
		const first = await copy(
			`update public.party set ref = 'P-EX-CHANGED' where id = '${id(10)}';`,
		);
		assert.ok(
			first?.some(
				(row) =>
					row[0] === id(10) &&
					row[1] === "ref" &&
					row[3] === "its record does not hold this outside id",
			),
		);
		assert.deepEqual(
			await rows("select * from outside_id where value = 'P-EX-CHANGED'"),
			[],
		);
		await db.query("discard temp");
		assert.deepEqual(await copy(), first);
	}));

test("after the copy, a change is stamped with who made it again", () =>
	rolledBack(async () => {
		await db.query(`select set_config('engine.job', '', true), set_config('engine.user_id', '${PARTNER}', true);
			update party set name = 'Example renamed' where id = '${id(10)}';
			update party_email set label = 'personal';
			update party_phone set label = 'home';
			update do_not_contact set until_date = null where party_id = '${id(16)}';
			insert into party_specialty (person_id, specialty) values ('${id(16)}', 'gp');
			update party_company set title = 'Example title'`);
		for (const table of [
			"party",
			"party_email",
			"party_phone",
			"do_not_contact",
			"party_specialty",
			"party_company",
		])
			assert.deepEqual(
				await rows(
					`select distinct changed_by_user_id, changed_by_job from ${table} where changed_at = now()`,
				),
				[{ changed_by_user_id: PARTNER, changed_by_job: null }],
				table,
			);
	}));

test("copied rows share the last author's job and sponsor across every copied value", () =>
	rolledBack(async () => {
		const agents = [
			"claude",
			"codex",
			"grok",
			"hermes-pilot",
			"joe-local",
			"dell-local",
		];
		await db.query(
			agents
				.map(
					(slug, i) =>
						`insert into public.actor (id, slug, kind, display_name)
			values ('${id(100 + i)}', '${slug}', 'automation', 'Example runtime ${i}');`,
				)
				.join(""),
		);
		const cases = [
			...agents.map((_, i) => ({
				author: id(100 + i),
				cause: "human_stated",
				job: "agent",
				sponsor: PARTNER,
			})),
			{
				author: id(100),
				cause: "ingest_email",
				job: "agent",
				sponsor: PARTNER,
			},
			{
				author: AUTOMATION,
				cause: "ingest_email",
				job: "mail_capture",
				sponsor: PARTNER,
			},
			{
				author: AUTOMATION,
				cause: "automation_job",
				job: "old_system",
				sponsor: null,
			},
			{
				author: SYSTEM,
				cause: "ingest_email",
				job: "old_system",
				sponsor: null,
			},
			{ author: PARTNER, cause: "ingest_email", job: null, sponsor: null },
		];
		let sql = "";
		for (const [i, row] of cases.entries()) {
			sql += oldParty(200 + i, {
				updated_by: row.author,
				email: `example${i}@example.com`,
				phone: "2175550100",
				specialty: "Example specialty",
				org_id: id(11),
				title: "Example title",
				contact_state: i % 2 ? "paused" : "do_not_contact",
				...(i % 2 ? { contact_state_until: "2027-01-04" } : {}),
				contact_state_reason: "Example request",
				contact_state_set_by: row.author,
			});
			sql += `insert into public.event (actor_id, verb, subject_type, subject_id, field, cause, occurred_at, sponsoring_human_slug)
				values ('${row.author}', 'example', 'party', '${id(200 + i)}', 'contact_state', '${row.cause}', now(), 'partner_one');`;
		}
		await copy(sql);
		for (const [i, row] of cases.entries()) {
			for (const [table, key] of [
				["party", "id"],
				["party_email", "party_id"],
				["party_phone", "party_id"],
				["party_specialty", "person_id"],
				["party_company", "person_id"],
				["do_not_contact", "party_id"],
			]) {
				assert.deepEqual(
					await rows(`select changed_by_user_id, changed_by_job, changed_for_user_id
					from ${table} where ${key} = '${id(200 + i)}'`),
					[
						{
							changed_by_user_id: row.job === null ? PARTNER : null,
							changed_by_job: row.job,
							changed_for_user_id: row.sponsor,
						},
					],
					`${i} ${table}`,
				);
			}
		}
	}));

test("the latest mutation supplies the sponsor only for its author, record and field", () =>
	rolledBack(async () => {
		await db.query(`insert into public.actor (id, slug, kind, display_name)
			values ('${id(100)}', 'codex', 'automation', 'Example runtime');
			insert into public.event (actor_id, verb, subject_type, subject_id, field, cause, occurred_at, sponsoring_human_slug) values
			('${AUTOMATION}', 'example', 'party', '${id(10)}', 'contact_state', 'ingest_email', '2026-01-02', 'partner_one'),
			('${id(100)}', 'example', 'party', '${id(10)}', 'name', 'human_stated', '2026-01-01', null),
			('${AUTOMATION}', 'example', 'deal', '${id(10)}', null, 'ingest_email', now(), 'partner_one'),
			('${AUTOMATION}', 'example', 'party', '${id(11)}', null, 'ingest_email', now(), 'partner_one');`);
		const stamp = (author: string, field = "null") =>
			rows(
				`select * from copy_attribution('party', '${id(10)}', '${author}', ${field})`,
			);
		assert.deepEqual(await stamp(id(100)), [
			{
				changed_by_user_id: null,
				changed_by_job: "agent",
				changed_for_user_id: null,
			},
		]);
		assert.deepEqual(await stamp(AUTOMATION), [
			{
				changed_by_user_id: null,
				changed_by_job: "old_system",
				changed_for_user_id: null,
			},
		]);
		assert.deepEqual(await stamp(AUTOMATION, "'contact_state'"), [
			{
				changed_by_user_id: null,
				changed_by_job: "mail_capture",
				changed_for_user_id: PARTNER,
			},
		]);
		assert.deepEqual(
			await rows(`select * from copy_attribution('party', '${id(99)}', null)`),
			[
				{
					changed_by_user_id: null,
					changed_by_job: "old_system",
					changed_for_user_id: null,
				},
			],
		);
	}));
test("paused copies as do not contact with its reason and end date", async () => {
	assert.deepEqual(
		await rows(
			"select party_id, reason, until_date::text from do_not_contact where until_date is not null",
		),
		[{ party_id: id(16), reason: "Example pause", until_date: "2027-01-04" }],
	);
});

test("a pause without an end date is reported and never becomes a permanent stop", () =>
	rolledBack(async () => {
		const report = await copy(
			oldParty(950, {
				contact_state: "paused",
				contact_state_reason: "Example pause",
			}),
		);
		assert.deepEqual(
			(report ?? []).filter((row) => row[0] === id(950)),
			[[id(950), "contact_state", "paused", "paused without an end date"]],
		);
		assert.deepEqual(
			await rows(
				`select party_id from do_not_contact where party_id = '${id(950)}'`,
			),
			[],
		);
	}));
for (const [survivor, duplicate, winner] of [
	["2028-01-01", "2029-01-01", "duplicate"],
	["2029-01-01", "2028-01-01", "survivor"],
	["2028-01-01", null, "duplicate"],
	[null, "2028-01-01", "survivor"],
] as const) {
	test(`the copy keeps the strongest stop with its reason: ${survivor}, ${duplicate}`, () =>
		rolledBack(async () => {
			const report = await copy(
				oldParty(951, {
					contact_state: survivor ? "paused" : "do_not_contact",
					...(survivor ? { contact_state_until: survivor } : {}),
					contact_state_reason: "Example survivor",
				}) +
					oldParty(952, {
						merged_into: id(951),
						contact_state: duplicate ? "paused" : "do_not_contact",
						...(duplicate ? { contact_state_until: duplicate } : {}),
						contact_state_reason: "Example duplicate",
					}),
			);
			assert.deepEqual(
				(report ?? []).filter(
					(row) => row[0] === id(951) || row[0] === id(952),
				),
				[],
			);
			assert.deepEqual(
				await rows(
					`select reason, until_date::text from do_not_contact where party_id = '${id(951)}'`,
				),
				[
					{
						reason: `Example ${winner}`,
						until_date: winner === "survivor" ? survivor : duplicate,
					},
				],
			);
		}));
}

test("nurture marks move to existing lead roles through old ids, with the setter's stamp", () =>
	rolledBack(async () => {
		await db.query(`
			select set_config('engine.job', 'old_system', true);
			insert into role (slug, label) values ('lead', 'Lead');
			insert into stage values ('lead', 'new', 'New'), ('lead', 'nurture', 'Nurture');
			insert into how_found values ('referral', 'Referral');
			update party set how_found = 'referral' where id in ('${id(10)}', '${id(17)}', '${id(26)}');
			alter table party_role disable trigger stamp_change;
			insert into party_role (party_id, role, stage, owner_user_id, changed_by_job, changed_at) values
				('${id(10)}', 'lead', 'new', '${PARTNER}', 'old_system', '2020-01-01'),
				('${id(17)}', 'lead', 'new', null, 'old_system', '2020-01-01'),
				('${id(26)}', 'lead', 'new', null, 'old_system', '2020-01-01');
			set constraints all immediate;
			alter table party_role enable trigger stamp_change;
			update public.party set contact_state = 'nurture', contact_state_set_by = '${AUTOMATION}',
				contact_state_set_at = '2024-01-01T00:00:00Z' where id = '${id(10)}';
			update public.party set contact_state = 'nurture', contact_state_set_by = '${PARTNER}',
				contact_state_set_at = '2025-08-09T10:11:12Z' where id = '${id(12)}';
			set constraints all immediate;
		`);
		const first = await copy(
			oldParty(80, {
				merged_into: id(26),
				deleted_at: "2025-01-02T00:00:00Z",
				contact_state: "nurture",
				contact_state_set_at: "2024-06-01T00:00:00Z",
			}),
		);
		assert.ok(!first?.some((row) => row[0] === id(80)));
		assert.ok(
			!first?.some((row) => row[1] === "contact_state" && row[2] === "nurture"),
		);
		assert.deepEqual(
			await rows(
				"select party_id, stage, owner_user_id from party_role where role = 'lead' order by party_id",
			),
			[
				{ party_id: id(10), stage: "nurture", owner_user_id: PARTNER },
				{ party_id: id(17), stage: "nurture", owner_user_id: null },
				{ party_id: id(26), stage: "nurture", owner_user_id: null },
			],
		);
		assert.deepEqual(
			await rows(
				`select changed_by_user_id, changed_by_job, changed_at::text from party_role where party_id = '${id(10)}'`,
			),
			[
				{
					changed_by_user_id: PARTNER,
					changed_by_job: null,
					changed_at: "2025-08-09 10:11:12+00",
				},
			],
		);
		const history = await rows(
			"select * from change where table_name = 'party_role' order by id",
		);
		await db.query("discard temp");
		assert.deepEqual(await copy(), first);
		assert.deepEqual(
			await rows(
				"select * from change where table_name = 'party_role' order by id",
			),
			history,
		);
	}));

for (const stage of ["new", "opportunity", "archived"]) {
	test(`a nurture mark cannot overwrite a newer ${stage} stage`, () =>
		rolledBack(async () => {
			await db.query(`
				select set_config('engine.job', 'old_system', true);
				insert into role (slug, label) values ('lead', 'Lead');
				insert into stage values ('lead', '${stage}', 'Example stage'), ('lead', 'nurture', 'Nurture');
				insert into how_found values ('referral', 'Referral');
				update party set how_found = 'referral' where id = '${id(17)}';
				alter table party_role disable trigger lead_stage_needs_evidence;
				insert into party_role (party_id, role, stage) values ('${id(17)}', 'lead', '${stage}');
				set constraints all immediate;
				alter table party_role enable trigger lead_stage_needs_evidence;
			`);
			const before = await rows(
				`select * from party_role where party_id = '${id(17)}'`,
			);
			const result = await copy();
			assert.deepEqual(
				await rows(`select * from party_role where party_id = '${id(17)}'`),
				before,
			);
			assert.ok(
				result?.some(
					(row) =>
						row[0] === id(17) &&
						row[1] === "contact_state" &&
						row[3] ===
							"its lead stage is as recent or newer than the nurture mark",
				),
			);
		}));
}
