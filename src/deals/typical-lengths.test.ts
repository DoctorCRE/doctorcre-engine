import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";
import { copyTest, readSchema } from "../test-copy.ts";
import { type Caller, doorTest } from "../test-door.ts";

// biome-ignore format: one row per lease to-do reads as a table.
const EXPECTED_LEASE = [
	["before_research", "pending", 7], ["representation", "research", 7], ["requirements", "research", 7],
	["market_survey", "site_selection", 7], ["tour_notes", "site_selection", 12],
	["loi_submission", "negotiation", 14], ["loi_grid", "negotiation", 21], ["business_terms", "negotiation", 20],
	["contract_draft", "legal", 10], ["attorney_comments", "legal", 21], ["legal_review", "legal", 10], ["ti_scope", "legal", 14],
	["executed_lease", "closing", 14], ["commencement_letter", "closing", 10], ["executed_comp", "closing", 7],
	["expiration_recorded", "closing", 6], ["check_in_90_day", "closing", 90],
	["invoice_recorded", "closed", 3], ["commission_received", "closed", 30],
] as const;

const alex = randomUUID();
const blair = randomUUID();
const alexCaller: Caller = { user: "alex" };
const blairCaller: Caller = { user: "blair" };

type Item = {
	phase: string | null;
	todo: string;
	label: string;
	days: number;
	changed_by: string | null;
	changed_at: string;
	base_version: number;
	measured_days: number | null;
	measured_count: number;
};
type ListBody = { deal_kind: string; items: Item[] };

// Each test gets its own database, so none depends on rows another left behind.
async function freshDoor(t: TestContext) {
	const { db, setup, cleanup, save, request } = doorTest();
	await setup();
	t.after(cleanup);
	await db.query(`begin; set local engine.job = 'old_system';
		insert into deal_kind (slug, label) values ('lease', 'Lease'), ('purchase', 'Purchase');
		insert into phase (slug, label) values ('pending', 'Prospective Client'), ('research', 'Research'),
			('closing', 'Closing'), ('closed', 'Closed');
		insert into party (id, kind, name) values ('${alex}', 'person', 'Alex Example'), ('${blair}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${alex}', 'alex'), ('${blair}', 'blair');
		insert into commission_tier (user_id, from_deal, partner_user_id, closing_share) values ('${alex}', 1, '${blair}', 0.5);
		commit;`);
	await db.query(await readSchema("seed-typical-lengths.sql"));
	const readLengths = async (query = "") => {
		const res = await request(alexCaller, `typical-lengths${query}`, {
			method: "GET",
		});
		return [res.status, (await res.json()) as ListBody] as const;
	};
	const post = (caller: Caller, body: object) =>
		save(caller, "typical-lengths", body);
	return { db, readLengths, post };
}

test("the read returns seeded lease lengths in workflow order and handles other kinds", async (t) => {
	const { readLengths } = await freshDoor(t);
	const [status, body] = await readLengths();
	assert.equal(status, 200);
	assert.equal(body.deal_kind, "lease");
	assert.deepEqual(
		body.items.map((i) => [i.todo, i.phase, i.days]),
		EXPECTED_LEASE,
	);
	assert.ok(
		body.items.every(
			(i) =>
				i.changed_by === null &&
				i.measured_days === null &&
				i.measured_count === 0 &&
				i.base_version > 0,
		),
	);
	assert.deepEqual(await readLengths("?deal_kind=purchase"), [
		200,
		{ deal_kind: "purchase", items: [] },
	]);
	for (const bad of [
		"?deal_kind=unknown",
		"?deal_kind=",
		"?deal_kind=lease&deal_kind=purchase",
		"?extra=1",
	])
		assert.equal((await readLengths(bad))[0], 400);
});

test("partners edit a typical length with version checks, idempotency and validation", async (t) => {
	const { readLengths, post } = await freshDoor(t);
	const [, beforeEdit] = await readLengths();
	const target = beforeEdit.items.find((i) => i.todo === "loi_grid");
	assert.ok(target);
	const first = {
		idempotency_key: randomUUID(),
		deal_kind: "lease",
		todo: "loi_grid",
		days: 18,
		base_version: target.base_version,
	};
	const [status, saved] = await post(alexCaller, first);
	assert.equal(status, 200);
	assert.deepEqual([saved.days, saved.changed_by], [18, "alex"]);
	assert.ok(Number(saved.base_version) > target.base_version);
	assert.deepEqual(await post(alexCaller, first), [
		200,
		{ replayed: true, ...saved },
	]);
	assert.equal((await post(alexCaller, { ...first, days: 19 }))[0], 409);

	const [conflictStatus, conflict] = await post(blairCaller, {
		...first,
		idempotency_key: randomUUID(),
		days: 25,
	});
	assert.equal(conflictStatus, 409);
	assert.deepEqual(
		[conflict.error, conflict.current_version],
		["version_conflict", saved.base_version],
	);
	const updated = (await readLengths())[1].items.find(
		(i) => i.todo === "loi_grid",
	);
	assert.deepEqual([updated?.days, updated?.changed_by], [18, "alex"]);

	for (const patch of [
		{ days: 0 },
		{ days: -4 },
		{ days: 2.5 },
		{ todo: "unknown_step" },
		{ deal_kind: "unknown" },
	])
		assert.equal(
			(
				await post(alexCaller, {
					...first,
					idempotency_key: randomUUID(),
					...patch,
				})
			)[0],
			400,
		);
	assert.equal(
		(await post(alexCaller, { idempotency_key: randomUUID() }))[0],
		400,
	);
	assert.equal((await post({ job: "agent" }, first))[0], 404);
});

test("measured median appears only once five positive finished examples exist", async (t) => {
	const { db, readLengths } = await freshDoor(t);
	const add = async (pendingDays: number, commissionDays: number) => {
		const deal = randomUUID();
		await db.query(`begin; set local engine.user_id = '${alex}';
			insert into deal (id, name, kind, owner_user_id) values ('${deal}', 'Example ${deal.slice(0, 6)}', 'lease', '${alex}');
			insert into deal_phase_change (deal_id, happened_at, phase, reason) values
				('${deal}', '2026-01-01T16:00:00Z', 'pending', 'opened'),
				('${deal}', ('2026-01-01'::date + ${pendingDays})::timestamp at time zone 'America/Chicago', 'research', 'started');
			insert into commission (deal_id, gross) values ('${deal}', 10000);
			insert into commission_payment (deal_id, amount, invoiced_on, received_on)
				values ('${deal}', 10000, '2026-03-01', '2026-03-01'::date + ${commissionDays});
			commit;`);
	};
	const find = (items: Item[], todo: string) => {
		const item = items.find((i) => i.todo === todo);
		assert.ok(item);
		return item;
	};
	for (const [p, c] of [
		[4, 20],
		[6, 25],
		[8, 30],
		[10, 35],
		[0, 0],
	] as const)
		await add(p, c);
	const four = (await readLengths())[1].items;
	assert.deepEqual(
		[
			find(four, "before_research").measured_count,
			find(four, "before_research").measured_days,
		],
		[4, null],
	);
	assert.equal(find(four, "commission_received").measured_days, null);

	await add(12, 40);
	const five = (await readLengths())[1].items;
	const pending = find(five, "before_research");
	const comm = find(five, "commission_received");
	assert.deepEqual(
		[pending.days, pending.measured_count, pending.measured_days],
		[7, 5, 8],
	);
	assert.deepEqual([comm.measured_count, comm.measured_days], [5, 30]);
});

test("invoice days run from the day Closed began, and executed lease is never measured", async (t) => {
	const { db, readLengths } = await freshDoor(t);
	const property = randomUUID();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into property (id, address) values ('${property}', '1 Example Way');
		insert into role (slug, label) values ('client', 'Client') on conflict do nothing;
		insert into how_found (slug, label) values ('inbound', 'Inbound');
		commit;`);
	// Each deal closes on 2026-02-01 (Central), is invoiced `days` later, and signed its lease three days after Closing began.
	const add = async (days: number) => {
		const [deal, lease, file, client] = [
			randomUUID(),
			randomUUID(),
			randomUUID(),
			randomUUID(),
		];
		await db.query(`begin; set local engine.user_id = '${alex}';
			insert into deal (id, name, kind, owner_user_id) values ('${deal}', 'Example ${deal.slice(0, 6)}', 'lease', '${alex}');
			insert into deal_phase_change (deal_id, happened_at, phase, reason) values
				('${deal}', '2026-01-01T16:00:00Z', 'pending', 'opened'),
				('${deal}', '2026-01-10T16:00:00Z', 'closing', 'signed'),
				('${deal}', '2026-02-01T16:00:00Z', 'closed', 'invoiced');
			insert into party (id, kind, name, how_found) values ('${client}', 'company', 'Example Client ${client.slice(0, 6)}', 'inbound');
			insert into party_role (party_id, role) values ('${client}', 'client');
			insert into deal_party (deal_id, party_id, role) values ('${deal}', '${client}', 'client');
			insert into deal_property (deal_id, property_id) values ('${deal}', '${property}');
			insert into document (id, name, r2_key) values ('${file}', 'Example lease', 'example/${file}');
			insert into lease (id, party_id, property_id, deal_id) values ('${lease}', '${client}', '${property}', '${deal}');
			insert into lease_version (lease_id, version, document_id, executed_on, expiration_on)
				values ('${lease}', 1, '${file}', '2026-01-13', '2031-01-31');
			commit;
			begin; set local engine.job = 'old_system';
			insert into imported_deal_invoiced (deal_id, invoiced_on) values ('${deal}', '2026-02-01'::date + ${days});
			commit;`);
	};
	for (const days of [1, 2, 3, 4]) await add(days);
	const find = (items: Item[], todo: string) => {
		const item = items.find((i) => i.todo === todo);
		assert.ok(item);
		return item;
	};
	const four = (await readLengths())[1].items;
	assert.deepEqual(
		[
			find(four, "invoice_recorded").measured_count,
			find(four, "invoice_recorded").measured_days,
		],
		[4, null],
	);

	await add(5);
	const five = (await readLengths())[1].items;
	const invoice = find(five, "invoice_recorded");
	assert.deepEqual(
		[invoice.days, invoice.measured_count, invoice.measured_days],
		[3, 5, 3],
	);
	const signed = find(five, "executed_lease");
	assert.deepEqual([signed.measured_count, signed.measured_days], [0, null]);
});

for (const migrated of [false, true]) {
	test(
		migrated
			? "the typical-lengths migration and seed are idempotent and keep edits"
			: "the database enforces one positive length per deal kind and to-do",
		async (t) => {
			const copy = copyTest();
			await copy.setup();
			t.after(copy.cleanup);
			const rules = copy.db;
			const seed = await readSchema("seed-typical-lengths.sql");
			if (migrated) {
				const migration = await readSchema("add-typical-lengths.sql");
				await rules.query("drop table typical_length");
				await rules.query(migration);
				await rules.query(migration);
			}
			await rules.query(seed);
			assert.equal(
				(await rules.query("select from typical_length")).rowCount,
				0,
			);
			await rules.query(`begin; set local engine.job = 'old_system';
				insert into deal_kind (slug, label) values ('lease', 'Lease');
				insert into party (id, kind, name) values ('${alex}', 'person', 'Alex Example');
				insert into app_user (id, slug) values ('${alex}', 'alex');
				commit;`);
			await rules.query(seed);
			await rules.query(seed);
			assert.equal(
				(await rules.query("select from typical_length")).rowCount,
				EXPECTED_LEASE.length,
			);

			await rules.query(`set role engine; set engine.user_id = '${alex}'`);
			await rules.query(
				"update typical_length set days = 16 where deal_kind = 'lease' and todo = 'loi_grid'",
			);
			const refused: [string, object][] = [
				[
					"insert into typical_length (deal_kind, todo, days) values ('lease', 'loi_grid', 10)",
					{ code: "23505", constraint: "typical_length_pkey" },
				],
				[
					"update typical_length set days = 0 where deal_kind = 'lease' and todo = 'loi_grid'",
					{ code: "23514", constraint: "typical_length_days_check" },
				],
				[
					"insert into typical_length (deal_kind, todo, days) values ('lease', 'extra_step', -1)",
					{ code: "23514", constraint: "typical_length_days_check" },
				],
				[
					"insert into typical_length (deal_kind, todo, days) values ('purchase', 'representation', 5)",
					{ code: "23503", constraint: "typical_length_deal_kind_fkey" },
				],
				[
					"insert into typical_length (deal_kind, todo, days) values ('lease', ' Bad', 5)",
					{ code: "23514", constraint: "typical_length_todo_check" },
				],
				[
					"update typical_length set todo = 'renamed' where deal_kind = 'lease' and todo = 'loi_grid'",
					{ code: "42501" },
				],
				["delete from typical_length", { code: "42501" }],
			];
			for (const [sqlText, expected] of refused)
				await assert.rejects(rules.query(sqlText), expected);

			await rules.query("reset role");
			await rules.query(seed);
			await rules.query("set role engine_reader");
			const {
				rows: [kept],
			} = await rules.query(
				"select days, changed_by_user_id from typical_length where deal_kind = 'lease' and todo = 'loi_grid'",
			);
			assert.deepEqual(kept, { days: 16, changed_by_user_id: alex });
		},
	);
}
