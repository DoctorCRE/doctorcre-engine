import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-buildings.sql");
const { db, setup, cleanup } = copyTest();
const rows = async (text: string) => (await db.query(text)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	const result = await db.query(copy);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const reasons = (report: pg.QueryResultRow[], n: number) =>
	report.filter((r) => r.old_id === id(n)).map((r) => r.reason);
const owner = (n: number, building: number, party: number, rest: string) =>
	`('${id(n)}', '${id(building)}', '${id(party)}', ${rest}, '2025-01-02', '${id(1)}')`;
const owners = () =>
	rows(
		"select id, property_id, party_id, kind, started_on::text, ended_on::text, source from building_ownership order by id",
	);
let report: pg.QueryResultRow[];
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User'), ('${id(2)}', 'company', 'Example Owner'), ('${id(3)}', 'company', 'Example Manager');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(1)}', '${id(1)}'),
 ('old_system', '${id(6)}', '${id(2)}'), ('old_system', '${id(7)}', '${id(3)}'), ('old_system', '${id(8)}', '${id(2)}');
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) select v, 'org', 'Example Party ' || v, '${id(1)}', '${id(1)}'
 from unnest(array['${id(6)}'::uuid, '${id(7)}'::uuid, '${id(8)}'::uuid, '${id(9)}'::uuid]) v;
 insert into public.building (id, address, city, state, zip, name, created_at, created_by, updated_by, updated_at) values
 ('${id(90)}', '100 Example Way', 'Example City', 'TX', '75000', 'Example Tower', '2024-01-01', '${id(1)}', '${id(1)}', '2024-02-01'),
 ('${id(91)}', '200 Example Way', '', '', '', null, '2024-01-01', '${id(1)}', '${id(1)}', '2024-02-01'),
 ('${id(92)}', '300 Example Way', '', '', '', null, '2024-01-01', '${id(1)}', '${id(1)}', '2024-02-01'),
 ('${id(93)}', '400 Example Way', '', '', '', null, '2024-01-01', '${id(1)}', '${id(1)}', '2024-02-01');
 update public.building set class = ' ', sub_type = 'medical_dental', year_built = 1998, stories = 3,
 status = 'existing', status_source = 'Example county record' where id = '${id(90)}';
 update public.building set merged_into = '${id(90)}' where id = '${id(91)}';
 update public.building set merged_into = id where id = '${id(92)}';
 insert into public.space (id, building_id, suite, floor, area_amount, area_basis, condition, created_at, created_by, updated_by) values
 ('${id(100)}', '${id(90)}', ' Suite 100 ', 2, 1500, 'rentable', 'Second generation', '2024-03-01', '${id(1)}', '${id(1)}'),
 ('${id(101)}', '${id(91)}', ' ', null, null, null, ' ', '2024-03-01', '${id(1)}', '${id(1)}'),
 ('${id(102)}', '${id(90)}', 'B1', null, null, null, null, '2024-03-01', '${id(1)}', '${id(1)}'),
 ('${id(103)}', '${id(91)}', 'B1', null, null, null, null, '2024-03-01', '${id(1)}', '${id(1)}'),
 ('${id(104)}', '${id(92)}', 'C1', null, null, null, null, '2024-03-01', '${id(1)}', '${id(1)}');
 insert into public.building_ownership (id, building_id, party_id, kind, from_on, to_on, source, created_at, created_by) values
 ${[
		owner(200, 90, 6, "'owner', '2020-01-01', '2024-12-31', 'stated'"),
		owner(
			201,
			90,
			7,
			"'property_manager', null, null, 'Example county record'",
		),
		owner(202, 91, 8, "'landlord_rep', null, null, 'stated'"),
		owner(203, 90, 7, "'listing_agent', null, null, 'stated'"),
		owner(204, 90, 7, "'listing_agent', null, null, 'stated'"),
		owner(205, 90, 9, "'owner', null, null, 'stated'"),
		owner(206, 90, 7, "'landlord_rep', '2024-01-01', '2023-01-01', 'stated'"),
		owner(207, 92, 6, "'owner', null, null, 'stated'"),
		owner(208, 90, 6, "'property_manager', null, null, ' '"),
		owner(209, 90, 7, "'owner', '2020-01-01', null, 'stated'"),
 ].join(", ")};
 commit;`);
	await db.query("begin");
	report = await run();
	await db.query("commit");
});
after(cleanup);

test("a building with suites or owners becomes a property at its surviving address, and one with neither does not", async () => {
	assert.deepEqual(
		await rows("select id, address, created_at::text from property"),
		[
			{
				id: id(90),
				address: "100 Example Way, Example City, TX, 75000",
				created_at: "2024-01-01 00:00:00+00",
			},
		],
	);
});

test("a property keeps its building's name, class, type, year built and stories, a blank one stays unknown, and only its construction status is listed", async () => {
	assert.deepEqual(
		await rows(
			"select name, building_class, building_type, year_built, stories from property",
		),
		[
			{
				name: "Example Tower",
				building_class: null,
				building_type: "medical_dental",
				year_built: 1998,
				stories: 3,
			},
		],
	);
	assert.deepEqual(
		report.filter((r) => r.old_id === id(90)).map((r) => [r.reason, r.value]),
		[
			[
				"unmapped_building_fields",
				'{"status": "existing", "status_source": "Example county record"}',
			],
		],
	);
});

test("each space becomes a suite in its surviving building, keeping what is known and nothing more", async () => {
	// biome-ignore format: one row per suite
	assert.deepEqual((await rows("select id, property_id, label, floor, area_sf, area_basis, condition, created_at::text, changed_by_user_id from suite order by id")).map(Object.values), [
 [id(100), id(90), "Suite 100", 2, "1500.0", "rentable", "Second generation", "2024-03-01 00:00:00+00", id(1)],
 [id(101), id(90), null, null, null, null, null, "2024-03-01 00:00:00+00", id(1)],
 ]);
	assert.deepEqual(reasons(report, 102), ["duplicate_suite_label"]);
	assert.deepEqual(reasons(report, 103), ["duplicate_suite_label"]);
	assert.deepEqual(reasons(report, 104), ["building_merge_unresolved"]);
});

test("owners copy through the party map with their kind, dates and source, and joint owners stay side by side", async () => {
	// biome-ignore format: one row per link
	assert.deepEqual((await owners()).map(Object.values), [
 [id(200), id(90), id(2), "owner", "2020-01-01", "2024-12-31", "stated"],
 [id(201), id(90), id(3), "property_manager", null, null, "Example county record"],
 [id(202), id(90), id(2), "landlord_rep", null, null, "stated"],
 [id(209), id(90), id(3), "owner", "2020-01-01", null, "stated"],
 ]);
	assert.deepEqual(
		await rows(
			`select created_at::text, changed_at::text, changed_by_user_id from building_ownership where id = '${id(202)}'`,
		),
		[
			{
				created_at: "2025-01-02 00:00:00+00",
				changed_at: "2025-01-02 00:00:00+00",
				changed_by_user_id: id(1),
			},
		],
	);
});

test("owners that cannot map are listed with a reason, never guessed", async () => {
	assert.deepEqual(reasons(report, 203), ["duplicate_ownership"]);
	assert.deepEqual(reasons(report, 204), ["duplicate_ownership"]);
	assert.deepEqual(reasons(report, 205), ["party_not_copied"]);
	assert.deepEqual(reasons(report, 206), ["dates_out_of_order"]);
	assert.deepEqual(reasons(report, 207), ["building_merge_unresolved"]);
	assert.deepEqual(reasons(report, 208), ["blank_source"]);
});

test("a repeat changes nothing", async () => {
	const snapshot = async () => [
		await rows("select * from property order by id"),
		await rows("select * from suite order by id"),
		await rows("select * from building_ownership order by id"),
		await rows("select * from change order by 1"),
	];
	const before = await snapshot();
	await db.query("begin");
	const again = await run();
	await db.query("commit");
	assert.deepEqual(await snapshot(), before);
	assert.deepEqual(reasons(again, 203), ["duplicate_ownership"]);
	assert.deepEqual(reasons(again, 102), ["duplicate_suite_label"]);
});

test("a later run adds what was corrected and leaves copied rows as users left them", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`update public.space set suite = 'B2' where id = '${id(103)}';
 update public.building_ownership set to_on = null where id = '${id(206)}';
 update public.building_ownership set to_on = '2026-01-01' where id = '${id(200)}';
 update building_ownership set ended_on = '2025-06-30' where id = '${id(200)}';`);
		const again = await run();
		assert.deepEqual(reasons(again, 102), []);
		assert.deepEqual(
			await rows(
				`select id, label from suite where id in ('${id(102)}', '${id(103)}') order by id`,
			),
			[
				{ id: id(102), label: "B1" },
				{ id: id(103), label: "B2" },
			],
		);
		assert.deepEqual(
			(await owners())
				.filter((o) => [id(200), id(206)].includes(o.id))
				.map((o) => [o.id, o.ended_on]),
			[
				[id(200), "2025-06-30"],
				[id(206), null],
			],
		);
	} finally {
		await db.query("rollback");
	}
});

test("an id or link the new database already holds for something else waits", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into property (id, address) values ('${id(94)}', '500 Example Way');
 insert into suite (id, property_id, label) values ('${id(105)}', '${id(94)}', 'D1');
 insert into building_ownership (property_id, party_id, kind, source) values ('${id(90)}', '${id(2)}', 'listing_agent', 'Example entry');
 insert into building_ownership (id, property_id, party_id, kind, source) values ('${id(211)}', '${id(94)}', '${id(2)}', 'owner', 'Example entry');
 insert into public.space (id, building_id, suite, created_by, updated_by) values ('${id(105)}', '${id(90)}', 'D1', '${id(1)}', '${id(1)}');
 insert into public.building_ownership (id, building_id, party_id, kind, source, created_by) values
 ('${id(210)}', '${id(90)}', '${id(6)}', 'listing_agent', 'stated', '${id(1)}'),
 ('${id(211)}', '${id(90)}', '${id(6)}', 'owner', 'stated', '${id(1)}');`);
		const again = await run();
		assert.deepEqual(reasons(again, 105), ["suite_id_taken"]);
		assert.deepEqual(reasons(again, 210), ["duplicate_ownership"]);
		assert.deepEqual(reasons(again, 211), ["ownership_id_taken"]);
		assert.deepEqual(
			await rows(
				`select property_id from building_ownership where id = '${id(211)}'`,
			),
			[{ property_id: id(94) }],
		);
	} finally {
		await db.query("rollback");
	}
});
