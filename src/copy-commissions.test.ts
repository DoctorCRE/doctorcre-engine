import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-commissions.sql");
const { db, setup, cleanup } = copyTest();
const rows = async (text: string) => (await db.query(text)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	const result = await db.query(copy);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const lines = (report: pg.QueryResultRow[], n: number) =>
	report
		.filter((r) => r.old_id === id(n))
		.map((r) => [r.field, r.value, r.reason]);
const payment = (
	n: number,
	deal: number,
	status: string,
	amount: string,
	dates = "null, null, null",
	created = "2025-01-01",
	updated = "2025-02-01",
	author: number | null = null,
) =>
	`('${id(n)}', '${id(deal)}', '${status}', ${amount}, ${dates}, '${created}', '${updated}', '${id(1)}', ${author === null ? "null" : `'${id(author)}'`})`;
let report: pg.QueryResultRow[];
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User'), ('${id(2)}', 'person', 'Example Other'), ('${id(6)}', 'company', 'Example Client');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}'), ('${id(2)}', 'user-${id(2)}');
 insert into how_found values ('referral', 'Example referral');
 update party set how_found = 'referral';
 insert into role (slug, label) values ('client', 'Client');
 insert into party_role (party_id, role) values ('${id(6)}', 'client');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(1)}', '${id(1)}'), ('old_system', '${id(2)}', '${id(2)}'), ('old_system', '${id(6)}', '${id(6)}');
 insert into commission_tier (user_id, from_deal, partner_user_id, closing_share) values ('${id(1)}', 1, '${id(2)}', 0.6);
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User'), ('${id(2)}', 'partner_two', 'human', 'Example Other');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) values ('${id(6)}', 'org', 'Example Client', '${id(1)}', '${id(1)}');
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(3)}', '${id(6)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Lease', 1);
 insert into public.deal_phase (slug, label) values ('negotiation', 'Negotiation');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by)
 select v, '${id(3)}', 'Example deal ' || v, 'lease', 'negotiation', 'partner_one', '${id(1)}', '${id(1)}'
 from unnest(array[${Array.from({ length: 13 }, (_, i) => `'${id(10 + i)}'::uuid`).join(",")}]) v;
 update public.deal set owner = 'partner_two' where id = '${id(16)}';
 update public.deal set owner = null where id = '${id(21)}';
 update public.deal set sf_commission_placeholder = 9876 where id = '${id(22)}';
 insert into public.commission (id, deal_id, status, gross_amount, invoiced_on, due_on, received_on, created_at, updated_at, created_by, updated_by) values
 ${[
		payment(100, 10, "expected", "100", "null, null, null", "2024-12-01"),
		payment(101, 10, "expected", "200"),
		payment(102, 10, "invoiced", "120", "'2025-01-01', '2025-02-01', null"),
		payment(
			103,
			10,
			"received",
			"80",
			"'2025-01-01', '2025-02-01', '2025-01-15'",
			"2025-01-01",
			"2025-03-01",
			2,
		),
		payment(110, 11, "expected", "75"),
		payment(120, 12, "received", "20"),
		payment(121, 12, "expected", "30"),
		payment(130, 13, "invoiced", "0", "'2025-01-01', null, null"),
		payment(140, 14, "invoiced", "30", "'2025-02-01', '2025-01-01', null"),
		payment(150, 15, "expected", "999999999999.99"),
		payment(151, 15, "expected", "1"),
		payment(160, 16, "invoiced", "40", "'2025-01-01', null, null"),
		payment(170, 17, "expected", "50", "'2025-01-01', null, null"),
		payment(180, 18, "invoiced", "60", "'2025-01-01', null, null"),
		payment(190, 19, "invoiced", "10", "'2025-01-01', null, '2025-01-20'"),
		payment(191, 19, "invoiced", "10"),
		payment(200, 20, "expected", "90"),
		payment(210, 21, "expected", "25"),
 ].join(",")};
 commit;`);
	await db.query("begin");
	await db.query(await readSchema("copy-deals.sql"));
	await db.query("commit");
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into deal (id, name, owner_user_id) values ('${id(99)}', 'Example mapped deal', '${id(1)}');
 update outside_id set deal_id = '${id(99)}' where source = 'old_system' and value = '${id(20)}'; commit;`);
	await db.query("begin");
	report = await run();
	await db.query("commit");
});
after(cleanup);

test("expected rows add to the estimate and other rows add to gross as separate dated payments", async () => {
	assert.deepEqual(
		await rows(
			`select expected, gross, closing_share, created_at::text, changed_at::text, changed_by_user_id from commission where deal_id = '${id(10)}'`,
		),
		[
			{
				expected: "300.00",
				gross: "200.00",
				closing_share: null,
				created_at: "2024-12-01 00:00:00+00",
				changed_at: "2025-03-01 00:00:00+00",
				changed_by_user_id: id(2),
			},
		],
	);
	// biome-ignore format: one row per payment
	assert.deepEqual((await rows(`select id, amount, invoiced_on::text, due_on::text, received_on::text, created_at::text, changed_at::text, changed_by_user_id from commission_payment where deal_id = '${id(10)}' order by id`)).map(Object.values), [
 [id(102),'120.00','2025-01-01','2025-02-01',null,'2025-01-01 00:00:00+00','2025-02-01 00:00:00+00',id(1)],
 [id(103),'80.00','2025-01-01','2025-02-01','2025-01-15','2025-01-01 00:00:00+00','2025-03-01 00:00:00+00',id(2)],
 ]);
	assert.deepEqual(
		await rows(
			"select m.deal_id from commission m join commission_payment p using (deal_id) group by m.deal_id, m.gross having sum(p.amount) <> m.gross",
		),
		[],
	);
});

test("absent totals and unknown due dates stay null; deals resolve through the deal copy", async () => {
	assert.deepEqual(
		(
			await rows(
				`select deal_id, expected, gross from commission where deal_id in ('${id(11)}', '${id(18)}', '${id(99)}') order by deal_id`,
			)
		).map(Object.values),
		[
			[id(11), "75.00", null],
			[id(18), null, "60.00"],
			[id(99), "90.00", null],
		],
	);
	assert.deepEqual(
		await rows(
			`select invoiced_on::text, due_on, received_on from commission_payment where id = '${id(180)}'`,
		),
		[{ invoiced_on: "2025-01-01", due_on: null, received_on: null }],
	);
	assert.deepEqual(
		await rows(`select * from commission where deal_id = '${id(22)}'`),
		[],
	);
	assert.deepEqual(await rows("select * from commission_share"), []);
	assert.equal((await rows("select * from commission_tier")).length, 1);
	assert.deepEqual(lines(report, 170), [
		["invoiced_on", "2025-01-01", "expected_date_has_no_destination"],
	]);
});

test("unmappable rows are listed with the field and value to correct, and their whole deal waits without aborting good deals", async () => {
	// biome-ignore format: one report line per row
	for (const [n, line] of [
		[120, ["received_on", null, "received_without_date"]],
		[121, ["deal_id", id(12), "another_row_on_deal_waits"]],
		[130, ["gross_amount", "0.00", "nonpositive_amount"]],
		[140, ["due_on", "2025-02-01 2025-01-01", "dates_out_of_order"]],
		[150, ["expected_total", "1000000000000.99", "amount_out_of_range"]],
		[151, ["expected_total", "1000000000000.99", "amount_out_of_range"]],
		[160, ["owner_user_id", id(2), "ladder_not_entered"]],
		[210, ["deal_id", id(21), "deal_not_copied"]],
		[190, ["received_on", "2025-01-20", "status_disagrees_with_dates"]],
		[191, ["invoiced_on", null, "status_disagrees_with_dates"]],
	] as const)
		assert.deepEqual(lines(report, n), [line], `${n}`);
	assert.deepEqual(
		await rows(
			`select * from commission where deal_id in (${[12, 13, 14, 15, 16, 19, 21].map((n) => `'${id(n)}'`).join(",")})`,
		),
		[],
	);
});

test("reruns change no rows or history and leave attribution triggers enabled", async () => {
	const snapshot = async () => {
		const all = [];
		for (const t of [
			"commission",
			"commission_payment",
			"commission_tier",
			"commission_share",
			"change",
		])
			all.push(await rows(`select * from ${t} order by 1`));
		return all;
	};
	const before = await snapshot();
	await db.query("begin");
	const again = await run();
	await db.query("commit");
	assert.deepEqual(await snapshot(), before);
	assert.deepEqual(again, report);
	assert.equal(
		(
			await rows(
				"select count(*)::int as n from pg_trigger where tgrelid in ('commission'::regclass,'commission_payment'::regclass) and tgname = 'stamp_change' and tgenabled = 'O'",
			)
		)[0]?.n,
		2,
	);
});

test("a receipt missing its invoice date waits for correction, then copies", async () => {
	await db.query("begin");
	try {
		await db.query(
			`update public.commission set received_on = '2025-03-01' where id = '${id(120)}'`,
		);
		assert.deepEqual(lines(await run(), 120), [
			["invoiced_on", null, "receipt_without_invoice_date"],
		]);
		assert.deepEqual(
			await rows(`select id from commission_payment where id = '${id(120)}'`),
			[],
		);
	} finally {
		await db.query("rollback");
	}
	await db.query("begin");
	try {
		await db.query(
			`update public.commission set invoiced_on = '2025-02-01', received_on = '2025-03-01' where id = '${id(120)}'`,
		);
		await run();
		assert.deepEqual(
			await rows(
				`select expected, gross from commission where deal_id = '${id(12)}'`,
			),
			[{ expected: "30.00", gross: "20.00" }],
		);
		assert.equal((await rows("select * from commission_tier")).length, 1);
	} finally {
		await db.query("rollback");
	}
});

test("saved commissions, conflicting payment ids and changed old rows are reported without overwrites", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(`insert into commission (deal_id, gross) values ('${id(19)}', 100);
 insert into commission_payment (id, deal_id, amount) values ('${id(120)}', '${id(19)}', 10);
 update public.commission set invoiced_on = '2025-02-01', received_on = '2025-03-01' where id = '${id(120)}';
 update public.commission set gross_amount = 121 where id = '${id(102)}';
 update commission set expected = 76 where deal_id = '${id(11)}';`);
		await db.query("set constraints all immediate");
		const refused = await run();
		assert.deepEqual(lines(refused, 120), [
			["id", id(120), "payment_id_taken"],
		]);
		assert.deepEqual(lines(refused, 102), [
			["deal_id", id(10), "existing_commission_conflict"],
			["id", id(102), "payment_id_taken"],
		]);
		assert.deepEqual(lines(refused, 110), [
			["deal_id", id(11), "existing_commission_conflict"],
		]);
		assert.deepEqual(
			await rows(
				`select amount from commission_payment where id = '${id(102)}'`,
			),
			[{ amount: "120.00" }],
		);
		assert.deepEqual(
			await rows(`select expected from commission where deal_id = '${id(11)}'`),
			[{ expected: "76.00" }],
		);
	} finally {
		await db.query("rollback");
	}
});

test("a saved invoice date no invoice email explains is listed once today's row loses it", async () => {
	await db.query("begin");
	try {
		await db.query(
			`update public.commission set invoiced_on = null where id = '${id(103)}'`,
		);
		assert.deepEqual(lines(await run(), 103), [
			["deal_id", id(10), "existing_commission_conflict"],
			["id", id(103), "payment_id_taken"],
			["invoiced_on", null, "receipt_without_invoice_date"],
		]);
	} finally {
		await db.query("rollback");
	}
});

test("receipt order, gross overflow and unmapped authors and sponsors are listed with the field and value to correct", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		// Sponsors are partner slugs, so partner_two moves to an actor that has no user.
		await db.query(`update public.deal set owner = null where id = '${id(16)}';
 update public.actor set slug = 'example_former' where id = '${id(2)}';
 insert into public.actor (id, slug, kind, display_name) values ('${id(7)}', 'partner_two', 'human', 'Example Missing'), ('${id(8)}', 'codex', 'automation', 'Example agent');
 insert into public.event (actor_id, verb, subject_type, subject_id, cause, occurred_at, sponsoring_human_slug) values
 ('${id(8)}', 'example-edit', 'commission', '${id(180)}', 'human_stated', '2025-02-01', 'partner_two');
 update public.commission set updated_by = '${id(8)}' where id = '${id(180)}';
 insert into public.commission (id, deal_id, status, gross_amount, invoiced_on, due_on, received_on, created_at, updated_at, created_by, updated_by) values
 ${payment(192, 19, "received", "10", "'2025-02-01', null, '2025-01-01'")};
 update public.commission set updated_by = '${id(7)}' where id = '${id(160)}';
 update public.commission set gross_amount = 999999999999.99 where id in ('${id(102)}','${id(103)}');`);
		const refused = await run();
		assert.deepEqual(lines(refused, 192), [
			["received_on", "2025-02-01 2025-01-01", "dates_out_of_order"],
		]);
		assert.deepEqual(lines(refused, 102), [
			["deal_id", id(10), "existing_commission_conflict"],
			["gross_total", "1999999999999.98", "amount_out_of_range"],
			["id", id(102), "payment_id_taken"],
		]);
		assert.deepEqual(lines(refused, 160), [
			["author_id", id(7), "author_not_copied"],
			["owner_user_id", id(2), "ladder_not_entered"],
		]);
		assert.deepEqual(lines(refused, 180), [
			["sponsor_id", id(7), "author_not_copied"],
		]);
	} finally {
		await db.query("rollback");
	}
});

test("entering a ladder allows the waiting gross without inventing a split override", async () => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await db.query(
			`insert into commission_tier (user_id, from_deal, partner_user_id, closing_share) values ('${id(2)}', 1, '${id(1)}', 0.7)`,
		);
		await db.query("set constraints all immediate");
		await run();
		assert.deepEqual(
			await rows(
				`select gross, closing_share from commission where deal_id = '${id(16)}'`,
			),
			[{ gross: "40.00", closing_share: null }],
		);
	} finally {
		await db.query("rollback");
	}
});
