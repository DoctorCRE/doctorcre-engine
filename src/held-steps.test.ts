import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { readNextDealDetail } from "./deals/next-detail.ts";
import { nextTransaction } from "./next-connection.ts";
import { type Caller, doorTest } from "./test-door.ts";

const { db, readerUrl, setup, cleanup, save } = doorTest();
const alex = { user: "alex" };
const blair = { user: "blair" };
const job = { job: "call_capture", for_user: "alex" };
const ownerId = randomUUID();
const teammateId = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into job values ('call_capture', 'Example call capture');
		insert into party (id, kind, name) values ('${ownerId}', 'person', 'Alex Example'), ('${teammateId}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${ownerId}', 'alex'), ('${teammateId}', 'blair');
		commit;`);
});
after(cleanup);

async function fixture(kind: "note" | "call", current = true) {
	const deal_id = randomUUID();
	const activity_id = randomUUID();
	const next_step_id = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal (id, name, owner_user_id) values ('${deal_id}', 'Example Deal', '${ownerId}');
		insert into activity (id, kind, happened_at) values ('${activity_id}', '${kind}', '2001-02-03T15:00:00Z');
		insert into activity_about (activity_id, deal_id) values ('${activity_id}', '${deal_id}');
		insert into next_step (id, deal_id, owner_party_id, what, due_on, created_at) values
			('${next_step_id}', '${deal_id}', '${ownerId}', 'Send the survey', '2001-02-01', '${current ? "2001-01-03" : "2001-01-01"}'),
			(gen_random_uuid(), '${deal_id}', '${teammateId}', 'Call the lender', '2001-02-02', '2001-01-02');
		commit;`);
	return { deal_id, activity_id, next_step_id };
}

const hold = (fields: object, caller: Caller = job) =>
	save(caller, "proposals", {
		idempotency_key: randomUUID(),
		kind: "next_step_done",
		evidence: "The survey was sent.",
		...fields,
	});
const decide = (
	id: unknown,
	decision: "accept" | "dismiss",
	caller: Caller = alex,
	idempotency_key = randomUUID(),
) => save(caller, `proposals/${id}/decision`, { idempotency_key, decision });

async function dealDate(id: string) {
	const deal = await nextTransaction(readerUrl, "read", (tx) =>
		readNextDealDetail(tx, id),
	);
	assert.ok("next_date" in deal);
	return deal.next_date;
}

test("a hold cites the activity and exact step, and the same pair is stored once", async () => {
	const source = await fixture("note");
	const [status, proposal] = await hold(source);
	assert.equal(status, 201);
	assert.deepEqual(await hold(source), [200, { ...proposal, existing: true }]);
	const { rows } = await db.query(
		`select p.activity_id, p.deal_id, p.next_step_id, p.status, s.status as step_status
		 from proposal p join next_step s on s.id = p.next_step_id where p.id = $1`,
		[proposal.proposal_id],
	);
	assert.deepEqual(rows, [
		{ ...source, status: "pending", step_status: "open" },
	]);
	const unrelated = await fixture("note");
	assert.equal(
		(await hold({ ...source, activity_id: unrelated.activity_id }))[0],
		422,
	);
	assert.equal(
		(await hold({ ...source, next_step_id: unrelated.next_step_id }))[0],
		422,
	);
});

test("a job cannot hold another partner's step or a step due the day of the update", async () => {
	const source = await fixture("note");
	assert.equal(
		(await hold(source, { ...job, for_user: "blair" }))[1].rule,
		"proposal_step_overdue",
	);
	const [created, step] = await save(alex, "next-steps", {
		idempotency_key: randomUUID(),
		deal_id: source.deal_id,
		replaces: "current",
		what: "Discuss the survey",
		due_on: "2001-02-03",
	});
	assert.equal(created, 201);
	assert.equal(
		(await hold({ ...source, next_step_id: step.next_step_id }))[1].rule,
		"proposal_step_overdue",
	);
});

for (const [kind, current, expectedDate] of [
	["note", true, "2001-02-02"],
	["note", false, "2001-02-02"],
	["call", true, "2001-02-01"],
	["call", false, "2001-02-02"],
] as const) {
	test(`resolving a ${current ? "current" : "noncurrent"} step from a ${kind} leaves the right deal date`, async () => {
		const source = await fixture(kind, current);
		assert.equal(
			await dealDate(source.deal_id),
			current ? "2001-02-01" : "2001-02-02",
		);
		const [stored, p] = await hold(source);
		assert.equal(stored, 201);
		const key = randomUUID();
		const [accepted, answer] = await decide(p.proposal_id, "accept", alex, key);
		assert.equal(accepted, 200);
		assert.equal(answer.next_step_id, source.next_step_id);
		assert.deepEqual(await decide(p.proposal_id, "accept", alex, key), [
			200,
			{ ...answer, replayed: true },
		]);
		const { rows } = await db.query(
			`select s.status, s.changed_by_user_id, (s.done_at = p.decided_at) as same_save
			from next_step s join proposal p on p.next_step_id = s.id where p.id = $1`,
			[p.proposal_id],
		);
		assert.deepEqual(rows, [
			{ status: "done", changed_by_user_id: ownerId, same_save: true },
		]);
		assert.equal(await dealDate(source.deal_id), expectedDate);
		assert.equal((await hold(source))[1].status, "accepted");
	});
}

test("a new ordinary step takes over the date preserved by a call", async () => {
	const source = await fixture("call");
	const [stored, p] = await hold(source);
	assert.equal(stored, 201);
	assert.equal((await decide(p.proposal_id, "accept"))[0], 200);
	assert.equal(await dealDate(source.deal_id), "2001-02-01");
	const [created, step] = await save(alex, "next-steps", {
		idempotency_key: randomUUID(),
		deal_id: source.deal_id,
		what: "Review the lease",
		due_on: "2001-02-04",
	});
	assert.equal(created, 201);
	assert.equal(await dealDate(source.deal_id), "2001-02-04");
	assert.equal(
		(
			await save(alex, `next-steps/${step.next_step_id}/end`, {
				idempotency_key: randomUUID(),
				resolution: "done",
			})
		)[0],
		200,
	);
	assert.equal(await dealDate(source.deal_id), "2001-02-02");
});

test("only the step's partner can dismiss it and dismissal leaves the step open", async () => {
	const source = await fixture("note");
	const [stored, p] = await hold(source);
	assert.equal(stored, 201);
	assert.equal((await decide(p.proposal_id, "accept", job))[0], 403);
	assert.equal((await decide(p.proposal_id, "dismiss", job))[0], 403);
	for (const decision of ["accept", "dismiss"] as const) {
		const [status, refusal] = await decide(p.proposal_id, decision, blair);
		assert.deepEqual(
			[status, refusal.rule],
			[422, "proposal_step_owner_decides"],
		);
	}
	assert.equal((await decide(p.proposal_id, "dismiss"))[1].status, "dismissed");
	assert.equal((await decide(p.proposal_id, "accept"))[0], 409);
	assert.equal(await dealDate(source.deal_id), "2001-02-01");
});

test("resolving a step edited since the hold leaves both rows alone", async () => {
	const source = await fixture("call");
	const [stored, p] = await hold(source);
	assert.equal(stored, 201);
	const { rows } = await db.query(
		"select max(id) as id from change where table_name = 'next_step' and record = jsonb_build_object('id', $1::uuid)",
		[source.next_step_id],
	);
	const [edited] = await save(
		alex,
		`next-steps/${source.next_step_id}/changes`,
		{
			idempotency_key: randomUUID(),
			seen_change_id: Number(rows[0].id),
			what: "Send the updated survey",
		},
	);
	assert.equal(edited, 200);
	const [status, refusal] = await decide(p.proposal_id, "accept");
	assert.deepEqual([status, refusal.rule], [422, "proposal_step_changed"]);
	assert.equal((await hold(source))[1].status, "pending");
	assert.equal(await dealDate(source.deal_id), "2001-02-01");
});
