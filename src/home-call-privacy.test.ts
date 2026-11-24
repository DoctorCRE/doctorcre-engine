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

// Both partners see every call, so the assignee reads the other partner's call and its text.

test("Home proposal detail shows the assigned wording and the call's evidence", async () => {
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
		assert.partialDeepStrictEqual(detail, {
			evidence,
			source_activity: { id: fixture.call, summary },
		});
	}
});

test("Home suggestion cards show the other partner's call as their source", async () => {
	const { items } = await readHome("home/inbox");
	for (const fixture of [privateCall, copiedCall]) {
		const card = findRow(items, "proposal_id", fixture.proposal);
		assert.ok(typeof card.why === "string" && card.why.includes(evidence));
		assert.partialDeepStrictEqual(card, {
			suggestions: [{ id: fixture.proposal }],
			source_activity: { id: fixture.call },
		});
	}
});

test("Home follow-ups keep the assigned step, its mark key, a usable link and the call", async () => {
	const { items } = await readHome("home/inbox");
	const own = findRow(items, "action_id", privateCall.step);
	assert.equal(own.title, followUp);
	assert.partialDeepStrictEqual(own, {
		item_id: `capture_post_call_action:${privateCall.step}`,
		// The call is visible to both partners, so the follow-up opens it.
		open_url: `/calls?session=${privateCall.call}`,
		primary_action: "Mark done",
	});
	for (const fixture of [privateCall, copiedCall])
		assert.partialDeepStrictEqual(findRow(items, "action_id", fixture.step), {
			source_activity: {
				id: fixture.call,
				contact: contactName,
				summary,
				quote: evidence,
			},
		});
	const { reminders } = await readHome("home/today");
	assert.ok(isArguments(reminders));
	assert.partialDeepStrictEqual(
		findRow(reminders.late, "id", privateCall.step),
		{ open_url: own.open_url, home_item_id: own.item_id },
	);
});

test("Home completion cards keep the review and step wording with the call's evidence", async () => {
	const { items } = await readHome("home/inbox");
	const card = findRow(items, "source_id", privateCall.review);
	assert.partialDeepStrictEqual(card, {
		completion_review: { proposal_id: privateCall.review, can_resolve: true },
	});
	for (const fixture of [privateCall, copiedCall])
		assert.partialDeepStrictEqual(findRow(items, "source_id", fixture.review), {
			source_activity: { id: fixture.call, summary, quote: evidence },
		});
});

test("held-step reviews show the call's evidence with the assignee's step", async () => {
	const { proposals } = await readHome("home/held-steps");
	const review = findRow(proposals, "proposal_id", privateCall.review);
	assert.partialDeepStrictEqual(review, { what: held, can_resolve: true });
	for (const fixture of [privateCall, copiedCall])
		assert.partialDeepStrictEqual(
			findRow(proposals, "proposal_id", fixture.review),
			{ activity_id: fixture.call, summary, evidence },
		);
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
	assert.partialDeepStrictEqual(step, {
		source_activity: { id: decisions.call },
	});
});

test("Today shows the recorder's own call follow-up", async () => {
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
