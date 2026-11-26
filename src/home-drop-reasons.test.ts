import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { replacedStepReason } from "./home-inbox-review.ts";
import { replacedDraftReason } from "./reply-drafts.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request } = doorTest();
const [alex, blair, deal, call] = [
	randomUUID(),
	randomUUID(),
	randomUUID(),
	randomUUID(),
];

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${alex}', 'person', 'Alex Example'), ('${blair}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${alex}', 'alex'), ('${blair}', 'blair');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Deal', '${alex}');
		insert into activity (id, kind, happened_at) values ('${call}', 'call', '2026-01-02T12:00:00Z');
		insert into activity_about (activity_id, deal_id) values ('${call}', '${deal}');
		commit;`);
});
after(cleanup);

function dismissSuggestion(user: string, reason: string) {
	const id = randomUUID();
	return db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into proposal (id, kind, activity_id, activity_kind, deal_id, what, evidence, proposed_by_job)
			values ('${id}', 'next_step', '${call}', 'call', '${deal}', 'Step ${id}', 'Said on the call', 'old_system');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${user}', true);
		update proposal set status = 'dismissed', decided_by_user_id = '${user}', decided_at = now(),
			dismiss_reason = '${reason}' where id = '${id}';
		commit;`);
}

function dropFollowUp(user: string, reason: string) {
	const [id, own] = [randomUUID(), randomUUID()];
	return db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal (id, name, owner_user_id) values ('${own}', 'Example Deal ${own}', '${user}');
		insert into activity_about (activity_id, deal_id) values ('${call}', '${own}');
		insert into next_step (id, owner_party_id, deal_id, what, call_activity_id, call_evidence_quote)
			values ('${id}', '${user}', '${own}', 'Follow up', '${call}', 'Said on the call');
		insert into home_mark (user_id, call_follow_up_id, disposition, drop_reason)
			values ('${user}', '${id}', 'dropped', '${reason}');
		commit;`);
}

function dismissDraft(reason: string) {
	const [email, draft] = [randomUUID(), randomUUID()];
	return db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into activity (id, kind, happened_at) values ('${email}', 'email', '2026-01-02T12:00:00Z');
		insert into email (activity_id, message_id, sender, subject, body)
			values ('${email}', '<${email}@example.test>', 'pat@example.test', 'Floor plan', 'Please send the plan.');
		insert into email_mailbox (activity_id, user_id) values ('${email}', '${alex}');
		insert into activity_about (activity_id, party_id) values ('${email}', '${alex}');
		insert into reply_draft (id, email_activity_id, owner_user_id, proposed_by_job, subject, body, evidence)
			values ('${draft}', '${email}', '${alex}', 'old_system', 'Re: Floor plan', 'Here it is.', 'Please send the plan.');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${alex}', true);
		update reply_draft set status = 'dismissed', decided_at = now(), dismiss_reason = '${reason}' where id = '${draft}';
		commit;`);
}

async function choices(category: string, user = "alex") {
	const response = await request(
		{ user },
		`home/drop-reasons?category=${category}`,
		{ method: "GET" },
	);
	assert.equal(response.status, 200, await response.clone().text());
	const body: { category: string; reasons: string[] } = await response.json();
	assert.equal(body.category, category);
	return body.reasons;
}

test("offers the starter reasons before anything is dropped", async () => {
	assert.deepEqual(await choices("next_step"), [
		"Already handled",
		"Not needed",
		"Duplicate",
		"Not ours to do",
	]);
	assert.deepEqual(await choices("tour_feedback"), [
		"Already handled",
		"Not relevant",
	]);
});

test("the partner's most-used reasons rise above the starters", async () => {
	await dismissSuggestion(alex, "Client said no");
	await dropFollowUp(alex, "  client SAID   no ");
	await dismissSuggestion(alex, "Client said no");
	await dropFollowUp(alex, "Waiting on the landlord");
	await dismissSuggestion(alex, "waiting on the landlord");
	await dismissSuggestion(alex, "Not needed");
	await dismissSuggestion(alex, "Typed once");
	await dismissSuggestion(alex, replacedStepReason);
	await dismissSuggestion(alex, replacedStepReason);
	await dismissSuggestion(blair, "Blair only");
	await dismissSuggestion(blair, "Blair only");

	assert.deepEqual(await choices("next_step"), [
		"Client said no",
		"waiting on the landlord",
		"Not needed",
		"Already handled",
		"Duplicate",
	]);
	assert.deepEqual(await choices("next_step", "blair"), [
		"Blair only",
		"Already handled",
		"Not needed",
		"Duplicate",
		"Not ours to do",
	]);
	assert.deepEqual(await choices("filing"), [
		"Not about a deal",
		"Not business",
		"Spam",
		"Already filed",
	]);
});

test("a dismissed reply draft teaches the reply draft choices", async () => {
	await dismissDraft("Sent from my phone");
	await dismissDraft("Sent from my phone");
	await dismissDraft(replacedDraftReason);
	await dismissDraft(replacedDraftReason);
	assert.deepEqual(await choices("reply_draft"), [
		"Sent from my phone",
		"Already replied",
		"No reply needed",
		"Replying myself",
	]);
});

test("refuses a missing or unknown category", async () => {
	for (const query of ["", "?category=email", "?category=lead&category=lead"]) {
		const response = await request(
			{ user: "alex" },
			`home/drop-reasons${query}`,
			{ method: "GET" },
		);
		assert.equal(response.status, 400, query);
	}
});
