import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const recorder = { user: "joe" };
const assignee = { user: "dell" };
const recorderId = randomUUID();
const assigneeId = randomUUID();
const contact = randomUUID();
const contactName = "Example Call Contact";
const summary = "The survey was received.";
const evidence = "I have the survey in hand.";
const followUp = "Send the drawing";
const proposed = "Send the revised drawing";
const held = "Send the survey";
const recorderStep = randomUUID();
const recorderWording = "Confirm the revised survey price";

function callFixture() {
	return {
		call: randomUUID(),
		followUpDeal: randomUUID(),
		heldDeal: randomUUID(),
		step: randomUUID(),
		proposal: randomUUID(),
		heldStep: randomUUID(),
		review: randomUUID(),
	};
}

const privateCall = callFixture();
const copiedCall = callFixture();
const decisions = callFixture();
const endedReview = callFixture();

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into job values ('call_capture', 'Example call capture');
		insert into party (id, kind, name) values
			('${recorderId}', 'person', 'Example Recorder'), ('${assigneeId}', 'person', 'Example Assignee'),
			('${contact}', 'person', '${contactName}');
		insert into app_user (id, slug) values ('${recorderId}', '${recorder.user}'), ('${assigneeId}', '${assignee.user}');
		commit;`);
	for (const fixture of [privateCall, copiedCall, decisions, endedReview]) {
		const { call, followUpDeal, heldDeal, step, proposal, heldStep, review } =
			fixture;
		const callJob = fixture === copiedCall ? "old_system" : "call_capture";
		await db.query(`begin;
			select set_config('engine.job', 'old_system', true);
			insert into deal (id, name, owner_user_id) values
				('${followUpDeal}', 'Example Drawing ' || '${followUpDeal}', '${assigneeId}'),
				('${heldDeal}', 'Example Survey ' || '${heldDeal}', '${assigneeId}');
			select set_config('engine.user_id', '${fixture === copiedCall ? "" : recorderId}', true), set_config('engine.job', '${callJob}', true);
			insert into activity (id, kind, happened_at, from_party_id, summary) values
				('${call}', 'call', '2001-02-03T15:00Z', '${contact}', '${summary}');
			insert into activity_about (activity_id, deal_id) values
				('${call}', '${followUpDeal}'), ('${call}', '${heldDeal}');
			insert into activity_about (activity_id, party_id) values ('${call}', '${recorderId}');
			insert into next_step (id, deal_id, owner_party_id, what, due_on, call_activity_id, call_contact_party_id, call_evidence_quote)
				values ('${step}', '${followUpDeal}', '${assigneeId}', '${followUp}', '2001-02-01', '${call}', '${contact}', '${evidence}');
			insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, party_id, owner_party_id, what, evidence)
				values ('${proposal}', 'next_step', '${call}', 'call', '${callJob}',
					${fixture === decisions ? `null, '${recorderId}'` : `'${followUpDeal}', null`}, '${assigneeId}', '${proposed}', '${evidence}');
			select set_config('engine.user_id', '${assigneeId}', true), set_config('engine.job', 'old_system', true);
			insert into next_step (id, deal_id, owner_party_id, what, due_on)
				values ('${heldStep}', '${heldDeal}', '${assigneeId}', '${held}', '2001-02-01');
			insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, next_step_id, evidence)
				values ('${review}', 'next_step_done', '${call}', 'call', 'old_system', '${heldDeal}', '${heldStep}', '${evidence}');
			commit;`);
	}
	await db.query(`begin;
		select set_config('engine.user_id', '${recorderId}', true);
		insert into next_step (id, deal_id, owner_party_id, what, due_on, call_activity_id, call_evidence_quote)
			values ('${recorderStep}', '${privateCall.followUpDeal}', '${recorderId}', '${recorderWording}', '2001-02-01', '${privateCall.call}', '${evidence}');
		commit;`);
});
after(cleanup);

async function readHome(path: string, caller = assignee) {
	const response = await request(
		caller,
		path,
		{ method: "GET" },
		{ HOME_INBOX_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const body: unknown = await response.json();
	assert.ok(isArguments(body));
	return body;
}

function findRow(rows: unknown, key: string, id: string) {
	assert.ok(Array.isArray(rows));
	const row = rows.filter(isArguments).find((entry) => entry[key] === id);
	assert.ok(row, `Missing ${key} ${id}`);
	return row;
}

function assertPrivateSourceHidden(value: unknown, call = privateCall.call) {
	const json = JSON.stringify(value);
	for (const secret of [call, contactName, summary, evidence])
		assert.ok(
			!json.includes(secret),
			`Private call field reached the assignee: ${secret}`,
		);
}

test("Home proposal detail shows the assigned wording and hides private evidence", async () => {
	for (const [fixture, idKey, text] of [
		[privateCall, "proposal", proposed],
		[privateCall, "review", held],
		[copiedCall, "proposal", proposed],
		[copiedCall, "review", held],
	] as const) {
		const [status, detail] = await save(
			assignee,
			`proposals/${fixture[idKey]}`,
			{},
			"GET",
		);
		assert.equal(status, 200);
		assert.equal(detail.what, text);
		if (fixture === privateCall) {
			assertPrivateSourceHidden(detail);
			assert.partialDeepStrictEqual(detail, {
				evidence: "",
				source_activity: null,
			});
		} else {
			assert.partialDeepStrictEqual(detail, {
				evidence,
				source_activity: { id: fixture.call, summary },
			});
		}
	}
});

test("Home suggestion cards and member lists hide the assigned proposal's private source", async () => {
	const { items } = await readHome("home/inbox");
	const hidden = findRow(items, "proposal_id", privateCall.proposal);
	assert.equal(hidden.why, `${proposed}.`);
	assert.partialDeepStrictEqual(hidden, {
		suggestions: [{ id: privateCall.proposal }],
		source_activity: null,
	});
	assertPrivateSourceHidden(hidden);
	const shared = findRow(items, "proposal_id", copiedCall.proposal);
	assert.ok(typeof shared.why === "string" && shared.why.includes(evidence));
	assert.partialDeepStrictEqual(shared, {
		source_activity: { id: copiedCall.call },
	});
});

test("Home follow-ups keep the assigned step, its mark key, and a usable link", async () => {
	const { items } = await readHome("home/inbox");
	const hidden = findRow(items, "action_id", privateCall.step);
	assert.equal(hidden.title, followUp);
	assertPrivateSourceHidden(hidden);
	assert.partialDeepStrictEqual(hidden, {
		item_id: `capture_post_call_action:${privateCall.step}`,
		open_url: `/deals?deal=${privateCall.followUpDeal}&focus=next-step&step=${privateCall.step}`,
		primary_action: "Mark done",
		source_activity: null,
	});
	const shared = findRow(items, "action_id", copiedCall.step);
	assert.partialDeepStrictEqual(shared, {
		source_activity: {
			id: copiedCall.call,
			contact: contactName,
			summary,
			quote: evidence,
		},
	});
	const { reminders } = await readHome("home/today");
	assert.ok(isArguments(reminders));
	assert.partialDeepStrictEqual(
		findRow(reminders.late, "id", privateCall.step),
		{ open_url: hidden.open_url, home_item_id: hidden.item_id },
	);
});

test("Home completion cards keep the review and step wording without private evidence", async () => {
	const { items } = await readHome("home/inbox");
	const hidden = findRow(items, "source_id", privateCall.review);
	assert.equal(hidden.why, `${held}.`);
	assertPrivateSourceHidden(hidden);
	assert.partialDeepStrictEqual(hidden, {
		completion_review: { proposal_id: privateCall.review, can_resolve: true },
		source_activity: null,
	});
	const shared = findRow(items, "source_id", copiedCall.review);
	assert.partialDeepStrictEqual(shared, {
		source_activity: { id: copiedCall.call, summary, quote: evidence },
	});
});

test("held-step reviews hide the private evidence while keeping the assignee's step", async () => {
	const { proposals } = await readHome("home/held-steps");
	const hidden = findRow(proposals, "proposal_id", privateCall.review);
	assertPrivateSourceHidden(hidden);
	assert.partialDeepStrictEqual(hidden, { what: held, can_resolve: true });
	const shared = findRow(proposals, "proposal_id", copiedCall.review);
	assert.partialDeepStrictEqual(shared, {
		activity_id: copiedCall.call,
		summary,
		evidence,
	});
});

test("the assignee can accept the step proposal and decide the completion review", async () => {
	for (const id of [decisions.proposal, decisions.review]) {
		const [status, result] = await save(assignee, `proposals/${id}/decision`, {
			idempotency_key: randomUUID(),
			decision: "accept",
		});
		assert.equal(status, 200, JSON.stringify(result));
		assert.equal(result.status, "accepted");
	}
	const { items } = await readHome("home/inbox");
	const step = findRow(items, "action_id", decisions.proposal);
	assert.equal(step.title, proposed);
	assertPrivateSourceHidden(step, decisions.call);
});

test("Today hides a private call follow-up owned by the other partner", async () => {
	const { reminders } = await readHome("home/today");
	const payload = JSON.stringify(reminders);
	assert.ok(!payload.includes(recorderStep));
	assert.ok(!payload.includes(recorderWording));

	const own = await readHome("home/today", recorder);
	assert.ok(isArguments(own.reminders));
	assert.equal(
		findRow(own.reminders.late, "id", recorderStep).title,
		recorderWording,
	);
	assert.equal(
		findRow(own.reminders.late, "id", copiedCall.step).open_url,
		`/calls?session=${copiedCall.call}`,
	);
});

test("a pending private-call completion review is unavailable after its step ends", async () => {
	const path = `proposals/${endedReview.review}`;
	assert.equal((await save(assignee, path, {}, "GET"))[0], 200);
	const { items } = await readHome("home/inbox");
	const review = findRow(items, "source_id", endedReview.review);
	const [ended, result] = await save(
		assignee,
		`next-steps/${endedReview.heldStep}/end`,
		{
			idempotency_key: randomUUID(),
			resolution: "done",
			base_version: review.action_version,
		},
	);
	assert.equal(ended, 200, JSON.stringify(result));
	assert.equal((await save(assignee, path, {}, "GET"))[0], 404);
	const [status] = await save(assignee, `${path}/decision`, {
		idempotency_key: randomUUID(),
		decision: "dismiss",
	});
	assert.equal(status, 404);
});
