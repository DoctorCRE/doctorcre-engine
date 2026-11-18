import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const ALEX = id(1),
	BLAIR = id(2),
	AUTOMATIC = id(3),
	REVIEW = id(4),
	STEPS = id(5),
	CALL = id(6),
	EARLY = id(7),
	FUTURE = id(8),
	CROSSED = id(9);
const job = { job: "call_capture", for_user: "alex" };

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into job values ('call_capture', 'Example call capture');
		insert into party (id, kind, name) values ('${ALEX}', 'person', 'Alex Example'), ('${BLAIR}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${ALEX}', 'alex'), ('${BLAIR}', 'blair');
		insert into phase values ('research', 'Research'), ('legal', 'Legal');
		insert into deal (id, name, owner_user_id)
		select id, 'Example Deal', '${ALEX}'
		from unnest(array['${AUTOMATIC}', '${REVIEW}', '${STEPS}', '${EARLY}', '${FUTURE}', '${CROSSED}']::uuid[]) as fixture(id);
		insert into deal_phase_change (deal_id, phase, happened_at)
		select id, 'research', '2026-01-05T15:00:00Z' from deal;
		insert into activity (id, kind, happened_at) values ('${CALL}', 'call', '2026-01-07T15:00:00Z');
		insert into activity_about (activity_id, deal_id) select '${CALL}', id from deal;
		commit;`);
});
after(cleanup);

const read = (deal: string, caller = job) =>
	save(caller, `deals/${deal}`, {}, "GET");
const post = (path: string, args: object) =>
	save(job, path, { idempotency_key: randomUUID(), ...args });
const propose = (args: object) =>
	post("proposals", {
		activity_id: CALL,
		evidence: "We agreed on the next move.",
		...args,
	});
const decide = (id: unknown) =>
	save({ user: "alex" }, `proposals/${id}/decision`, {
		idempotency_key: randomUUID(),
		decision: "accept",
	});

test("a registered job reads a deal and uses the answer to save a phase move", async () => {
	const [status, deal] = await read(AUTOMATIC);
	const { rows } = await db.query(
		"select max(id) as id from change where table_name = 'deal' and record = jsonb_build_object('id', $1::uuid)",
		[AUTOMATIC],
	);
	assert.equal(status, 200);
	assert.ok(Number(rows[0].id) > 0);
	assert.deepEqual(deal, {
		deal_id: AUTOMATIC,
		phase: "research",
		change_id: Number(rows[0].id),
		next_step: null,
	});
	const [denied, refusal] = await read(AUTOMATIC, {
		...job,
		job: "unknown_example",
	});
	assert.deepEqual([denied, refusal.error], [403, "unknown_job"]);
	assert.equal((await read(randomUUID()))[0], 404);
	const [saved] = await post(`deals/${AUTOMATIC}/changes`, {
		seen_change_id: deal.change_id,
		phase: { from: deal.phase, to: "legal" },
	});
	assert.equal(saved, 200);
	assert.equal((await read(AUTOMATIC))[1].phase, "legal");
});

test("a call's stated phase and date survive acceptance without an email milestone quote", async () => {
	const args = { kind: "phase_move", deal_id: REVIEW, to: "legal" };
	const dated = { ...args, on: "2026-01-06" };
	const [stored, proposal] = await propose(dated);
	assert.equal(stored, 201);
	assert.equal((await propose(dated))[1].proposal_id, proposal.proposal_id);
	assert.equal(
		(await propose({ ...args, to: "research" }))[1].error,
		"phase_not_eligible",
	);
	const [withoutDate, stale] = await propose(args);
	assert.equal(withoutDate, 201);
	assert.equal((await decide(proposal.proposal_id))[0], 200);
	assert.equal((await decide(stale.proposal_id))[1].error, "version_conflict");
	const { rows } = await db.query(
		"select phase, (happened_at at time zone 'America/Chicago')::date::text as day from deal_phase_change where deal_id = $1 order by happened_at desc limit 1",
		[REVIEW],
	);
	assert.deepEqual(rows, [{ phase: "legal", day: "2026-01-06" }]);
});

test("a call cannot suggest a date before the current phase began", async () => {
	const [status, body] = await propose({
		kind: "phase_move",
		deal_id: STEPS,
		to: "legal",
		on: "2026-01-04",
	});
	assert.deepEqual([status, body.error], [422, "phase_not_eligible"]);
});

for (const [when, deal, date] of [
	["before the current phase began", EARLY, "date '2026-01-04'"],
	["after today", FUTURE, "(now() at time zone 'America/Chicago')::date + 2"],
]) {
	test(`acceptance refuses a stored phase date ${when}`, async () => {
		const proposal = randomUUID();
		await db.query(`begin; select set_config('engine.job', 'call_capture', true);
			insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job,
				deal_id, from_phase, to_phase, phase_stated, phase_on)
			values ('${proposal}', 'phase_move', '${CALL}', 'call', 'Example move', 'call_capture',
				'${deal}', 'research', 'legal', true, ${date});
			commit;`);
		const [status, body] = await decide(proposal);
		assert.deepEqual(
			[status, body.error, body.rule],
			[422, "database_refused_the_statement", "proposal_phase_date"],
		);
		const { rows } = await db.query(
			"select status from proposal where id = $1",
			[proposal],
		);
		assert.deepEqual(rows, [{ status: "pending" }]);
	});
}

test("call capture can assign a suggested next step by user slug", async () => {
	const args = {
		kind: "next_step",
		deal_id: REVIEW,
		what: "Send the example plan",
	};
	const [unknown, refusal] = await propose({
		...args,
		owner: "unknown_example",
	});
	assert.deepEqual([unknown, refusal.error], [400, "unknown_owner"]);
	assert.equal(
		(await propose({ ...args, owner: "blair", owner_party_id: ALEX }))[0],
		400,
	);
	const [stored, proposal] = await propose({ ...args, owner: "blair" });
	assert.equal(stored, 201);
	assert.equal((await decide(proposal.proposal_id))[0], 200);
	const { rows } = await db.query(
		"select owner_party_id from next_step where id = $1",
		[proposal.proposal_id],
	);
	assert.deepEqual(rows, [{ owner_party_id: BLAIR }]);
});

test("replacement cancels the saving owner's ordinary step and clears an omitted date", async () => {
	const args = { deal_id: STEPS, what: "Call the example office" };
	const create = (fields: object) => post("next-steps", { ...args, ...fields });
	const [unknown, refusal] = await create({ owner: "unknown_example" });
	assert.deepEqual([unknown, refusal.error], [400, "unknown_owner"]);
	assert.equal(
		(await create({ owner: "blair", owner_party_id: null }))[0],
		400,
	);
	const [assigned, other] = await create({ owner: "blair" });
	assert.equal(assigned, 201);
	const [checklist, item] = await create({
		item: { title: "Review example", bullets: [], source_ref: "example" },
	});
	assert.equal(checklist, 201);
	const [oldStatus, old] = await create({
		due_on: "2026-02-01",
		hold_until: "2026-02-01",
	});
	assert.equal(oldStatus, 201);
	assert.deepEqual((await read(STEPS))[1].next_step, {
		id: old.next_step_id,
		due_on: "2026-02-01",
	});

	const replace = {
		...args,
		what: "Send an example update",
		replaces: "current",
		idempotency_key: randomUUID(),
	};
	const [status, current] = await save(job, "next-steps", replace);
	assert.equal(status, 201);
	assert.deepEqual(await save(job, "next-steps", replace), [
		201,
		{ ...current, replayed: true },
	]);
	assert.deepEqual((await read(STEPS))[1].next_step, {
		id: current.next_step_id,
		due_on: null,
	});
	const { rows } = await db.query(
		"select id, owner_party_id, status, done_at from next_step where deal_id = $1",
		[STEPS],
	);
	const state = new Map(rows.map(({ id, ...step }) => [id, step]));
	assert.equal(state.size, 4);
	assert.deepEqual(state.get(old.next_step_id), {
		owner_party_id: ALEX,
		status: "cancelled",
		done_at: null,
	});
	assert.equal(state.get(current.next_step_id)?.status, "open");
	assert.equal(state.get(other.next_step_id)?.status, "open");
	assert.equal(state.get(other.next_step_id)?.owner_party_id, BLAIR);
	assert.equal(state.get(item.next_step_id)?.status, "open");
});

test("a waiting replacement cancels the step committed ahead of it", {
	timeout: 10000,
}, async (t) => {
	const held = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'call_capture', true);
		select id from deal where id = '${CROSSED}' for no key update;
		insert into next_step (id, deal_id, owner_party_id, what)
		values ('${held}', '${CROSSED}', '${ALEX}', 'First call task');`);
	let settled = false;
	const pending = post("next-steps", {
		deal_id: CROSSED,
		what: "Second call task",
		replaces: "current",
	}).finally(() => {
		settled = true;
	});
	try {
		let waiting = false;
		while (!settled && !waiting) {
			t.signal.throwIfAborted();
			waiting = (
				await db.query(`select exists (
				select from pg_locks where not granted
				and pg_backend_pid() = any(pg_blocking_pids(pid))
			) as waiting`)
			).rows[0].waiting;
		}
		await db.query("commit");
		const [status, current] = await pending;
		assert.equal(status, 201, JSON.stringify(current));
		assert.ok(waiting);
		const { rows } = await db.query(
			"select status from next_step where id = $1",
			[held],
		);
		assert.deepEqual(rows, [{ status: "cancelled" }]);
		assert.deepEqual((await read(CROSSED))[1].next_step, {
			id: current.next_step_id,
			due_on: null,
		});
	} finally {
		await db.query("rollback");
		await pending;
	}
});
