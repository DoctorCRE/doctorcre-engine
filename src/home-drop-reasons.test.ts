import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { replacedStepReason } from "./home-inbox-review.ts";
import { replacedNextStepReason } from "./next-steps.ts";
import { replacedDraftReason } from "./reply-drafts.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
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
	const cases = [
		["", "missing_required"],
		["?category=email", "value_not_in_declared_vocabulary"],
		["?category=lead&category=lead", "value_not_in_declared_vocabulary"],
	] as const;
	for (const [query, expected] of cases) {
		const response = await request(
			{ user: "alex" },
			`home/drop-reasons${query}`,
			{ method: "GET" },
		);
		assert.equal(response.status, 400, query);
		const body: { error: string } = await response.json();
		assert.equal(body.error, expected, query);
	}
});

test("partner-dropped Reminders next steps teach next_step while system cancellations do not", async () => {
	const dropReminderStep = async (reason: string) => {
		const own = randomUUID();
		await db.query(`begin; select set_config('engine.job', 'old_system', true);
			insert into deal (id, name, owner_user_id) values ('${own}', 'Reminder Deal ${own}', '${alex}');
			commit;`);
		const [createdStatus, created] = await save(
			{ user: "alex" },
			"next-steps",
			{
				idempotency_key: randomUUID(),
				deal_id: own,
				what: "Call the landlord",
			},
		);
		assert.equal(createdStatus, 201, JSON.stringify(created));
		const [endedStatus, ended] = await save(
			{ user: "alex" },
			`next-steps/${String(created.next_step_id)}/end`,
			{
				idempotency_key: randomUUID(),
				resolution: "cancelled",
				reason,
				base_version: created.change_id,
			},
		);
		assert.equal(endedStatus, 200, JSON.stringify(ended));
	};

	const replaceStep = async () => {
		const own = randomUUID();
		await db.query(`begin; select set_config('engine.job', 'old_system', true);
			insert into deal (id, name, owner_user_id) values ('${own}', 'Replace Deal ${own}', '${alex}');
			commit;`);
		const [firstStatus, first] = await save({ user: "alex" }, "next-steps", {
			idempotency_key: randomUUID(),
			deal_id: own,
			what: "First step",
		});
		assert.equal(firstStatus, 201, JSON.stringify(first));
		const [secondStatus, second] = await save({ user: "alex" }, "next-steps", {
			idempotency_key: randomUUID(),
			deal_id: own,
			what: "Second step",
			replaces: "current",
			seen_current_step: {
				next_step_id: first.next_step_id,
				change_id: first.change_id,
			},
		});
		assert.equal(secondStatus, 201, JSON.stringify(second));
	};

	const insertSystemCancelled = (reason: string) => {
		const [own, stepId] = [randomUUID(), randomUUID()];
		return db.query(`begin;
			select set_config('engine.job', 'old_system', true);
			insert into deal (id, name, owner_user_id) values ('${own}', 'Copied Deal ${own}', '${alex}');
			select set_config('engine.job', '', true), set_config('engine.user_id', '${alex}', true);
			insert into next_step (id, owner_party_id, deal_id, what, resolution, resolved_at, resolution_reason)
				values ('${stepId}', '${alex}', '${own}', 'Copied step', 'cancelled', now(), '${reason}');
			commit;`);
	};

	await dropReminderStep("Client went dark");
	await dropReminderStep("Client went dark");
	await dropReminderStep("Client went dark");
	await dropReminderStep("Client went dark");
	for (let i = 0; i < 5; i++) {
		await replaceStep();
		await insertSystemCancelled("replaced at the move");
		await insertSystemCancelled("not recorded before this system");
	}

	const reasons = await choices("next_step");
	assert.equal(reasons[0], "Client went dark");
	assert.ok(!reasons.includes(replacedNextStepReason));
	assert.ok(!reasons.includes("replaced at the move"));
	assert.ok(!reasons.includes("not recorded before this system"));
});

test("a snoozed Home update dropped later uses its drop time for recency and casing", async () => {
	const [snoozedUpdate, earlierUpdate, otherFirst, otherSecond] = [
		randomUUID(),
		randomUUID(),
		randomUUID(),
		randomUUID(),
	];
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into home_update (id, user_id, deal_id, kind, what) values
			('${snoozedUpdate}', '${alex}', '${deal}', 'update', 'Check LOI'),
			('${earlierUpdate}', '${alex}', '${deal}', 'update', 'Check survey'),
			('${otherFirst}', '${alex}', '${deal}', 'update', 'Check title'),
			('${otherSecond}', '${alex}', '${deal}', 'update', 'Check lease');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${alex}', true);
		insert into home_mark (user_id, home_update_id, created_at, disposition, snoozed_until)
			values ('${alex}', '${snoozedUpdate}', '2026-01-01T12:00:00Z', 'snoozed', '2027-01-01T12:00:00Z');
		alter table home_mark disable trigger stamp_change;
		insert into home_mark (user_id, home_update_id, created_at, disposition, drop_reason, changed_at, changed_by_user_id) values
			('${alex}', '${earlierUpdate}', '2026-01-05T12:00:00Z', 'dropped', 'client paused', '2026-01-05T12:00:00Z', '${alex}'),
			('${alex}', '${otherFirst}', '2026-01-06T12:00:00Z', 'dropped', 'Landlord backed out', '2026-01-06T12:00:00Z', '${alex}'),
			('${alex}', '${otherSecond}', '2026-01-07T12:00:00Z', 'dropped', 'Landlord backed out', '2026-01-07T12:00:00Z', '${alex}');
		alter table home_mark enable trigger stamp_change;
		commit;`);
	// Drop the day-1 snoozed mark now: created_at stays 2026-01-01, while changed_at becomes now().
	await db.query(`begin; select set_config('engine.user_id', '${alex}', true);
		update home_mark set disposition = 'dropped', snoozed_until = null, drop_reason = 'Client Paused'
		where user_id = '${alex}' and home_update_id = '${snoozedUpdate}';
		commit;`);

	assert.deepEqual(await choices("checklist_reminder"), [
		"Client Paused",
		"Landlord backed out",
		"Already done",
		"Not needed on this deal",
	]);
});

test("a grouped proposal drop across 3 siblings counts as one use", async () => {
	const conversation = `conv-${randomUUID()}`;
	const groupProposals = [randomUUID(), randomUUID(), randomUUID()];
	const makeFilingProposal = (proposalId: string, conv: string) => {
		const emailId = randomUUID();
		return db.query(`begin; select set_config('engine.job', 'old_system', true);
			insert into activity (id, kind, happened_at) values ('${emailId}', 'email', '2026-01-02T12:00:00Z');
			insert into email (activity_id, message_id, conversation_id, sender, subject, body)
				values ('${emailId}', '<${emailId}@example.test>', '${conv}', 'pat@example.test', 'Update', 'FYI');
			insert into email_mailbox (activity_id, user_id) values ('${emailId}', '${alex}');
			insert into activity_about (activity_id, party_id) values ('${emailId}', '${alex}');
			insert into proposal (id, kind, activity_id, activity_kind, deal_id, evidence, proposed_by_job)
				values ('${proposalId}', 'file_to_deal', '${emailId}', 'email', '${deal}', 'Mentions deal', 'old_system');
			commit;`);
	};
	for (const id of groupProposals) {
		await makeFilingProposal(id, conversation);
	}

	const [status, result] = await save(
		{ user: "alex" },
		`proposals/${groupProposals[0]}/decision`,
		{
			idempotency_key: randomUUID(),
			decision: "dismiss",
			reason: "Newsletter blast",
		},
	);
	assert.equal(status, 200, JSON.stringify(result));
	const { rows } = await db.query<{ dismissed: string }>(
		"select count(*) as dismissed from proposal where id = any($1::uuid[]) and status = 'dismissed'",
		[groupProposals],
	);
	assert.equal(rows[0]?.dismissed, "3");

	assert.ok(!(await choices("filing")).includes("Newsletter blast"));

	const secondProposal = randomUUID();
	await makeFilingProposal(secondProposal, `conv-${randomUUID()}`);
	const [secondStatus, secondResult] = await save(
		{ user: "alex" },
		`proposals/${secondProposal}/decision`,
		{
			idempotency_key: randomUUID(),
			decision: "dismiss",
			reason: "Newsletter blast",
		},
	);
	assert.equal(secondStatus, 200, JSON.stringify(secondResult));

	assert.equal((await choices("filing"))[0], "Newsletter blast");
});
