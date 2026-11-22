import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { readSchema } from "./test-copy.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request } = doorTest();
const owner = randomUUID();
const unrelatedDeal = randomUUID();
const staging = { ENGINE_ENVIRONMENT: "staging" };
const caller = { job: "sign-in-rehearsal", for_user: "alex" };
const partner = { user: "alex" };

before(async () => {
	await setup();
	await db.query(await readSchema("staging-sign-in-fixtures.sql"));
	await db.query(`begin; set local engine.job = 'old_system';
		insert into role (slug, label) values ('client', 'Client');
		insert into how_found (slug, label) values ('inbound', 'Inbound');
		insert into phase (slug, label) values ('research', 'Research');
		insert into party (id, kind, name) values ('${owner}', 'person', 'Alex Example');
		insert into app_user (id, slug) values ('${owner}', 'alex');
		insert into deal (id, name, owner_user_id) values ('${unrelatedDeal}', 'Unrelated example', '${owner}');
		insert into deal_phase_change (deal_id, happened_at, phase) values ('${unrelatedDeal}', now(), 'research');
		commit;`);
});
after(cleanup);

function fixture(
	action: "prepare" | "cleanup",
	run_id: string,
	bindings: object = staging,
	headers: Record<string, string> = {},
) {
	return request(
		caller,
		`sign-in-rehearsal/${action}`,
		{ method: "POST", body: JSON.stringify({ run_id }), headers },
		bindings,
	);
}

async function prepareFixture(run: string) {
	const response = await fixture("prepare", run);
	assert.equal(response.status, 201);
	const prepared: unknown = await response.json();
	assert.ok(isArguments(prepared));
	return prepared;
}

test("prepare exposes the synthetic client, deal, two ordered notes and tour", async () => {
	const run = randomUUID();
	const prepared = await prepareFixture(run);
	assert.equal(prepared.run_id, run);
	const { client_id, deal_id, deal_name, note_ids, notes, tour_id } = prepared;
	const stored = await db.query(
		`select p.kind, d.name
		from client c join party p on p.id = c.party_id
		join deal_party dp on dp.party_id = p.id and dp.role = 'client'
		join deal d on d.id = dp.deal_id where p.id = $1 and d.id = $2`,
		[client_id, deal_id],
	);
	assert.deepEqual(stored.rows, [{ kind: "company", name: deal_name }]);
	const updates = await db.query(
		`select a.id, a.summary from activity a join activity_about b on b.activity_id = a.id
		where b.deal_id = $1 and a.kind = 'note' order by a.happened_at`,
		[deal_id],
	);
	assert.equal(updates.rowCount, 2);
	assert.ok(Array.isArray(note_ids) && Array.isArray(notes));
	assert.deepEqual(
		updates.rows,
		note_ids.map((id, index) => ({ id, summary: notes[index] })),
	);
	const tour = await request(partner, `deals/${deal_id}/tours/${tour_id}`, {
		method: "GET",
	});
	assert.equal(tour.status, 200);
	const plan: unknown = await tour.json();
	assert.ok(isArguments(plan) && Array.isArray(plan.stops));
	assert.equal(plan.stops.length, 1);
	const [stop] = plan.stops;
	assert.ok(isArguments(stop));
	assert.equal(stop.property_id, prepared.property_id);
});

test("parallel prepares return the same fixture", async () => {
	const run = randomUUID();
	const [first, second] = await Promise.all([
		prepareFixture(run),
		prepareFixture(run),
	]);
	const original = first.replayed ? second : first;
	const replay = first.replayed ? first : second;
	assert.deepEqual(replay, { ...original, replayed: true });
});

test("Home shows the run's overdue step until cleanup", async () => {
	const run = randomUUID();
	const prepared = await prepareFixture(run);
	const reminders = async () => {
		const response = await request(
			partner,
			"home/inbox?view=dashboard",
			{
				method: "GET",
			},
			{ HOME_INBOX_READ_SCHEMA: "next" },
		);
		assert.equal(response.status, 200);
		const home: unknown = await response.json();
		assert.ok(isArguments(home) && isArguments(home.reminders));
		assert.ok(Array.isArray(home.reminders.items));
		return home.reminders.items;
	};
	assert.ok(
		(await reminders()).some(
			(item) =>
				isArguments(item) &&
				item.item_id === prepared.home_item_id &&
				item.deal_id === prepared.deal_id &&
				typeof item.days_late === "number" &&
				item.days_late > 0,
		),
	);
	const detail = await request(
		partner,
		`deals/${prepared.deal_id}`,
		{ method: "GET" },
		{ DEALS_READ_SCHEMA: "next" },
	);
	assert.equal(detail.status, 200);
	const deal: unknown = await detail.json();
	assert.ok(isArguments(deal) && Array.isArray(deal.next_actions));
	assert.ok(
		deal.next_actions.some(
			(step) =>
				isArguments(step) &&
				step.id === prepared.next_step_id &&
				step.status === "open",
		),
	);
	assert.equal((await fixture("cleanup", run)).status, 200);
	assert.ok(
		!(await reminders()).some(
			(item) => isArguments(item) && item.item_id === prepared.home_item_id,
		),
	);
});

test("cleanup permanently closes both prepared and unseen runs", async () => {
	for (const shouldPrepare of [true, false]) {
		const run = randomUUID();
		if (shouldPrepare) await prepareFixture(run);
		assert.equal((await fixture("cleanup", run)).status, 200);
		assert.equal((await fixture("prepare", run)).status, 409);
	}
});

test("a writer cannot copy another run's receipt and claim its records", async () => {
	const run = randomUUID();
	const prepared = await prepareFixture(run);
	const forgedRun = randomUUID();
	await db.query("set role engine");
	try {
		await assert.rejects(
			db.query(
				`insert into save_receipt (idempotency_key, created_at, verb, request_hash, answer)
			select $2::uuid, created_at, verb, request_hash,
				answer || jsonb_build_object('run_id', $2::uuid)
			from save_receipt where idempotency_key = $1`,
				[run, forgedRun],
			),
			{ code: "42501" },
		);
	} finally {
		await db.query("reset role");
	}
	await db.query(
		"begin; set local role engine; set local engine.job = 'sign-in-rehearsal'",
	);
	try {
		await db.query("select set_config('engine.user_id', $1, true)", [owner]);
		const copied = { ...prepared, run_id: forgedRun };
		const invalid = await db.query(
			"select sign_in_fixture($1, null, $2) as result",
			[forgedRun, copied],
		);
		assert.deepEqual(invalid.rows, [{ result: { conflict: true } }]);
		await assert.rejects(
			db.query("select sign_in_fixture($1, 'record', $2)", [forgedRun, copied]),
			{ code: "23514" },
		);
	} finally {
		await db.query("rollback");
	}
	assert.equal((await fixture("cleanup", forgedRun)).status, 200);
	assert.deepEqual(await prepareFixture(run), { ...prepared, replayed: true });
});

test("cleanup removes the run's rows and preserves other records", async () => {
	const run = randomUUID();
	const prepared = await prepareFixture(run);
	const cancelled = await request(
		partner,
		`deals/${prepared.deal_id}/tours/${prepared.tour_id}/cancel`,
		{
			method: "POST",
			body: JSON.stringify({ idempotency_key: randomUUID(), revision: 2 }),
		},
	);
	assert.equal(cancelled.status, 200);
	for (let attempt = 0; attempt < 2; attempt++) {
		const cleared = await fixture("cleanup", run);
		assert.equal(cleared.status, 200);
		assert.deepEqual(await cleared.json(), { run_id: run, remaining: 0 });
	}
	const rows = await db.query(
		`select id from deal where id in ($1, $2)
		union all select id from party where id = $3
		union all select id from tour_plan where id = $4
		union all select id from property where id = $5
		union all select id from activity where id = any($6::uuid[])`,
		[
			prepared.deal_id,
			unrelatedDeal,
			prepared.client_id,
			prepared.tour_id,
			prepared.property_id,
			prepared.note_ids,
		],
	);
	assert.deepEqual(rows.rows, [{ id: unrelatedDeal }]);
});

test("the fixture door requires staging and jobs Access", async () => {
	for (const action of ["prepare", "cleanup"] as const) {
		const run = randomUUID();
		for (const bindings of [{ ENGINE_ENVIRONMENT: "production" }, {}]) {
			const production = await fixture(action, run, bindings);
			assert.equal(production.status, 404);
			assert.deepEqual(await production.json(), { error: "not_found" });
		}
		const denied = await fixture(action, run, staging, {
			"Cf-Access-Jwt-Assertion": "",
		});
		assert.equal(denied.status, 401);
	}
});
