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
		insert into deal (id, name, owner_user_id) values ('${deal_id}', 'Example Deal ' || '${deal_id}', '${ownerId}');
		insert into activity (id, kind, happened_at, summary) values
			('${activity_id}', '${kind}', '2001-02-03T15:00:00Z', 'The client received the survey.');
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

const home = (caller: Caller) => save(caller, "home/held-steps", {}, "GET");
const end = (id: string) =>
	save(job, `next-steps/${id}/end`, {
		idempotency_key: randomUUID(),
		resolution: "done",
	});
const undo = (
	id: string,
	change_id: unknown,
	caller: Caller = alex,
	key = randomUUID(),
) =>
	save(caller, `next-steps/${id}/undo-automatic-resolution`, {
		idempotency_key: key,
		change_id,
	});

async function stepChange(id: string) {
	const { rows } = await db.query(
		"select max(id) as id from change where table_name = 'next_step' and record = jsonb_build_object('id', $1::uuid)",
		[id],
	);
	return Number(rows[0].id);
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

const assistantNote = (args: object) =>
	save({ job: "agent", for_user: "alex" }, "activities/deal-note", args);

async function dealWithoutStep() {
	const id = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal (id, name, owner_user_id) values ('${id}', 'Example Deal ' || '${id}', '${ownerId}'); commit;`);
	return id;
}

test("a deal note with a plan requires an agent with a sponsoring partner", async () => {
	const deal_id = await dealWithoutStep();
	for (const caller of [
		{ job: "mail_capture", for_user: "alex" },
		{ job: "agent" },
	]) {
		const [status, answer] = await save(caller, "activities/deal-note", {
			idempotency_key: randomUUID(),
			deal_id,
			text: "Example update with a plan.",
			plan: { what: "Send the survey", due_on: "2034-10-15" },
		});
		assert.deepEqual([status, answer.error], [403, "AUTHORIZATION_REFUSED"]);
	}
	assert.equal(
		(await db.query("select from activity_about where deal_id = $1", [deal_id]))
			.rowCount,
		0,
	);
	assert.equal(
		(await db.query("select from next_step where deal_id = $1", [deal_id]))
			.rowCount,
		0,
	);
});

test("a deal note without a current step asks for a next step and creates no review", async () => {
	const deal_id = await dealWithoutStep();
	const [status, answer] = await assistantNote({
		idempotency_key: randomUUID(),
		deal_id,
		text: "The survey was sent.",
	});
	assert.deepEqual(
		[status, answer.proposal_id, answer.next_step_required],
		[201, null, true],
	);
	assert.equal(
		(await db.query("select from proposal where deal_id = $1", [deal_id]))
			.rowCount,
		0,
	);
});

test("a deal note for an unknown deal returns 404", async () => {
	const [status, answer] = await assistantNote({
		idempotency_key: randomUUID(),
		deal_id: randomUUID(),
		text: "The survey was sent.",
	});
	assert.deepEqual([status, answer.error], [404, "not_found"]);
});

test("a deal note saves once and sends the owner's overdue step to Home for review", async () => {
	const { deal_id, next_step_id } = await fixture("note");
	const args = {
		idempotency_key: randomUUID(),
		deal_id,
		text: "  The survey was sent.  ",
	};
	const [status, answer] = await assistantNote(args);
	assert.equal(status, 201);
	assert.equal(answer.next_step_required, false);
	assert.deepEqual(await assistantNote(args), [
		201,
		{ ...answer, replayed: true },
	]);
	const [, inbox] = await home(alex);
	assert.ok(Array.isArray(inbox.proposals));
	const entries = inbox.proposals.filter((item) => item.deal_id === deal_id);
	assert.equal(entries.length, 1);
	const [entry] = entries;
	assert.deepEqual(
		[
			entry.activity_id,
			entry.activity_kind,
			entry.summary,
			entry.next_step_id,
			entry.proposal_id,
		],
		[
			answer.activity_id,
			"note",
			args.text.trim(),
			next_step_id,
			answer.proposal_id,
		],
	);
	assert.equal(await dealDate(deal_id), "2001-02-01");
	const [accepted] = await decide(answer.proposal_id, "accept");
	assert.equal(accepted, 200);
	assert.equal(await dealDate(deal_id), "2001-02-02");
});

test("a deal note with a plan replaces the owner's step and keeps the partner's", async () => {
	const { deal_id, next_step_id } = await fixture("note");
	const args = {
		idempotency_key: randomUUID(),
		deal_id,
		text: "Example update with a new plan.",
		plan: { what: "Send the example amendment", due_on: "2034-10-15" },
	};
	const [status, answer] = await assistantNote(args);
	assert.equal(status, 201);
	assert.equal(answer.next_step_required, false);
	assert.deepEqual(await assistantNote(args), [
		201,
		{ ...answer, replayed: true },
	]);
	assert.equal(await dealDate(deal_id), args.plan.due_on);
	const { rows } = await db.query(
		"select id, status, owner_party_id from next_step where deal_id = $1",
		[deal_id],
	);
	assert.equal(rows.length, 3);
	assert.equal(
		rows.find((row) => row.id === next_step_id)?.status,
		"cancelled",
	);
	assert.equal(
		rows.find((row) => row.owner_party_id === teammateId)?.status,
		"open",
	);
	assert.equal(
		rows.find((row) => row.id === answer.next_step_id)?.owner_party_id,
		ownerId,
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
		seen_current_step: {
			next_step_id: source.next_step_id,
			change_id: await stepChange(source.next_step_id),
		},
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
				base_version: step.change_id,
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
	const [edited] = await save(
		alex,
		`next-steps/${source.next_step_id}/changes`,
		{
			idempotency_key: randomUUID(),
			seen_change_id: await stepChange(source.next_step_id),
			what: "Send the updated survey",
		},
	);
	assert.equal(edited, 200);
	const [read, { proposals }] = await home(alex);
	assert.equal(read, 200);
	assert.ok(Array.isArray(proposals));
	assert.equal(
		proposals.find((item) => item.proposal_id === p.proposal_id)?.can_resolve,
		false,
	);
	const [status, refusal] = await decide(p.proposal_id, "accept");
	assert.deepEqual([status, refusal.rule], [422, "proposal_step_changed"]);
	assert.equal((await hold(source))[1].status, "pending");
	assert.equal(await dealDate(source.deal_id), "2001-02-01");
});

test("Home shows the partner's pending holds with the linked update or call", async () => {
	const call = await fixture("call");
	const note = await fixture("note");
	const [stored, p] = await hold(call);
	const [noteStored, n] = await hold(note);
	assert.equal(stored, 201);
	assert.equal(noteStored, 201);
	const [status, { proposals }] = await home(alex);
	assert.equal(status, 200);
	assert.ok(Array.isArray(proposals));
	assert.deepEqual(
		proposals.find((item) => item.proposal_id === p.proposal_id),
		{
			...call,
			proposal_id: p.proposal_id,
			deal_name: `Example Deal ${call.deal_id}`,
			what: "Send the survey",
			due_on: "2001-02-01",
			evidence: "The survey was sent.",
			activity_kind: "call",
			happened_at: "2001-02-03 15:00:00+00",
			summary: "The client received the survey.",
			can_resolve: true,
		},
	);
	assert.ok(
		proposals.some(
			(item) =>
				item.proposal_id === n.proposal_id && item.activity_kind === "note",
		),
	);
	assert.deepEqual(await home(blair), [
		200,
		{ proposals: [], automatic_resolutions: [] },
	]);
	assert.equal((await home(job))[0], 404);
	assert.equal((await decide(p.proposal_id, "dismiss"))[0], 200);
	assert.equal((await end(note.next_step_id))[0], 200);
	const pending = (await home(alex))[1].proposals;
	assert.ok(Array.isArray(pending));
	assert.ok(
		pending.every(
			(item) => ![p.proposal_id, n.proposal_id].includes(item.proposal_id),
		),
	);
});

test("only the owner can undo an automatic completion and the new save carries their stamp", async () => {
	const { deal_id, next_step_id } = await fixture("note");
	assert.equal((await end(next_step_id))[0], 200);
	assert.equal(await dealDate(deal_id), "2001-02-02");
	const change_id = await stepChange(next_step_id);
	const [, { automatic_resolutions }] = await home(alex);
	assert.ok(Array.isArray(automatic_resolutions));
	const listed = automatic_resolutions.find(
		(item) => item.next_step_id === next_step_id,
	);
	assert.equal(listed?.change_id, change_id);
	assert.equal(listed?.changed_by_job, job.job);
	assert.equal((await undo(next_step_id, change_id, blair))[0], 409);
	assert.equal((await undo(next_step_id, change_id, job))[0], 404);
	const key = randomUUID();
	const answer = { next_step_id, status: "open" };
	assert.deepEqual(await undo(next_step_id, change_id, alex, key), [
		200,
		answer,
	]);
	assert.deepEqual(await undo(next_step_id, change_id, alex, key), [
		200,
		{ ...answer, replayed: true },
	]);
	assert.equal((await undo(next_step_id, change_id))[0], 409);
	assert.equal(await dealDate(deal_id), "2001-02-01");
	const { rows } = await db.query(
		"select changed_by_user_id, new_value from change where id = $1",
		[await stepChange(next_step_id)],
	);
	assert.deepEqual(rows, [
		{
			changed_by_user_id: ownerId,
			new_value: { resolution: null, done_at: null, status: "open" },
		},
	]);
});

test("Home hides an automatic completion once its change is over seven days old", async () => {
	const { next_step_id } = await fixture("note");
	assert.equal((await end(next_step_id))[0], 200);
	const change_id = await stepChange(next_step_id);
	await db.query(
		"update change set changed_at = now() - interval '8 days' where id = $1",
		[change_id],
	);
	const [status, { automatic_resolutions }] = await home(alex);
	assert.equal(status, 200);
	assert.ok(Array.isArray(automatic_resolutions));
	assert.ok(
		automatic_resolutions.every((item) => item.change_id !== change_id),
	);
});

test("Home hides Undo when the owner has another open step on the deal", async () => {
	const { deal_id, next_step_id } = await fixture("note");
	assert.equal((await end(next_step_id))[0], 200);
	const [created, newer] = await save(alex, "next-steps", {
		idempotency_key: randomUUID(),
		deal_id,
		what: "Review the lease",
	});
	assert.equal(created, 201);
	const [status, { automatic_resolutions }] = await home(alex);
	assert.equal(status, 200);
	assert.ok(Array.isArray(automatic_resolutions));
	assert.ok(
		automatic_resolutions.every((item) => item.next_step_id !== next_step_id),
	);
	const [refused, answer] = await undo(
		next_step_id,
		await stepChange(next_step_id),
	);
	assert.equal(refused, 409);
	assert.equal(answer.error, "open_step_exists");
	assert.equal(answer.next_step_id, newer.next_step_id);
});

test("a partner's resolution has no undo", async () => {
	const source = await fixture("note");
	const [stored, p] = await hold(source);
	assert.equal(stored, 201);
	assert.equal((await decide(p.proposal_id, "accept"))[0], 200);
	assert.equal(
		(await undo(source.next_step_id, await stepChange(source.next_step_id)))[0],
		409,
	);
	const [, { automatic_resolutions }] = await home(alex);
	assert.ok(Array.isArray(automatic_resolutions));
	assert.ok(
		automatic_resolutions.every(
			(item) => item.next_step_id !== source.next_step_id,
		),
	);
});

test("undo checks for intervening edits even when the wording changes back", async () => {
	const { next_step_id } = await fixture("note");
	assert.equal((await end(next_step_id))[0], 200);
	const change_id = await stepChange(next_step_id);
	for (const what of ["Send the revised survey", "Send the survey"]) {
		assert.equal(
			(
				await save(alex, `next-steps/${next_step_id}/changes`, {
					idempotency_key: randomUUID(),
					seen_change_id: await stepChange(next_step_id),
					what,
				})
			)[0],
			200,
		);
	}
	const [status, refusal] = await undo(next_step_id, change_id);
	assert.deepEqual(
		[status, refusal.error],
		[409, "automatic_resolution_changed"],
	);
});
