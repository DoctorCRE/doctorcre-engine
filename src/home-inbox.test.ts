import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request } = doorTest();
const owner = randomUUID();
const other = randomUUID();
const client = randomUUID();
const contact = randomUUID();
const deal = randomUUID();
const call = randomUUID();
const ordinary = randomUUID();
const meeting = randomUUID();
const proposal = randomUUID();
const meetingDeal = randomUUID();
const followUp = randomUUID();
const held = randomUUID();
const completed = randomUUID();
const completedWithoutTime = randomUUID();
const completedEightDaysAgo = randomUUID();
const canceled = randomUUID();
const otherStep = randomUUID();
const settled = randomUUID();
const path = "home/inbox";
const reader = { HOME_INBOX_READ_SCHEMA: "next" };
const user = { user: "example-partner" };

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${owner}', 'person', 'Example Partner'), ('${other}', 'person', 'Other Partner'),
			('${client}', 'company', 'Example Dental'), ('${contact}', 'person', 'Dr. Example');
		insert into app_user (id, slug) values ('${owner}', '${user.user}'), ('${other}', 'other-partner');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Dental, Springfield', '${owner}');
		insert into deal (id, name, owner_user_id) values ('${meetingDeal}', 'Example Renewal', '${owner}');
		insert into activity (id, kind, happened_at, from_party_id, summary) values
			('${call}', 'call', '2026-11-17 22:30+00', '${contact}', 'Discussed the suite.'),
			('${meeting}', 'meeting', '2026-11-17 17:00+00', '${contact}', 'Discussed renewal.');
		insert into activity_about (activity_id, deal_id) values ('${call}', '${deal}');
		insert into next_step (id, deal_id, owner_party_id, what, item_title, source_ref, call_activity_id, call_evidence_quote)
			values ('${followUp}', '${deal}', '${owner}', 'Call Dr. Example about the second-floor suite', 'Call about suite',
				'call-example', '${call}', 'Please send the floor plan.');
		insert into next_step (id, party_id, owner_party_id, what, due_on, hold_until, resolution, done_at, resolution_reason) values
			('${ordinary}', '${client}', '${owner}', 'Send the lease', '2026-11-19', null, null, null, null),
			('${held}', '${contact}', '${owner}', 'Call about the suite', '2026-11-19', '2999-04-01', null, null, null),
			('${completed}', '${client}', '${owner}', 'Check the budget', null, null, 'done', now() - interval '1 hour', null),
			('${completedWithoutTime}', '${client}', '${owner}', 'Review the floor plan', null, null, 'done', null, null),
			('${completedEightDaysAgo}', '${client}', '${owner}', 'Confirm the suite number', null, null, 'done', now() - interval '8 days', null),
			('${canceled}', '${client}', '${owner}', 'Tour the suite', null, null, 'cancelled', null, 'Client paused'),
			('${otherStep}', '${client}', '${other}', 'Arrange a tour', null, null, null, null, null);
		insert into next_step (id, deal_id, owner_party_id, what)
			values ('${settled}', '${deal}', '${owner}', 'Check the lease term');
		insert into home_mark (user_id, next_step_id, disposition, snoozed_until) values
			('${owner}', '${ordinary}', 'snoozed', '2999-01-01T00:00Z'),
			('${owner}', '${held}', 'snoozed', '2000-01-01T00:00Z'),
			('${owner}', '${settled}', 'settled', null),
			('${other}', '${otherStep}', 'settled', null);
		insert into home_mark (user_id, call_follow_up_id, disposition) values
			('${other}', '${followUp}', 'settled');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, owner_party_id)
			values ('${proposal}', 'next_step', '${meeting}', 'meeting', 'Please check our dates.',
				'old_system', '${meetingDeal}', 'Check renewal dates', '${owner}');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${owner}', true);
		update proposal set status = 'accepted' where id = '${proposal}';
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function inbox(caller = user) {
	const response = await request(caller, path, { method: "GET" }, reader);
	assert.equal(response.status, 200);
	const result: unknown = await response.json();
	assert.ok(isArguments(result) && Array.isArray(result.items));
	assert.partialDeepStrictEqual(result, {
		ok: true,
		schema_version: "home-inbox.v5",
		truncated: false,
	});
	return new Map(
		result.items.filter(isArguments).map((item) => [item.source_id, item]),
	);
}

test("switch off leaves the inbox on CARR and the read refuses a caller-supplied actor", async () => {
	assert.equal((await request(user, path, { method: "GET" })).status, 404);
	assert.equal(
		(
			await request(
				user,
				`${path}?actor=other-partner`,
				{ method: "GET" },
				reader,
			)
		).status,
		403,
	);
});

test("Home reads a partner's steps, holds, completion and marks", async () => {
	const items = await inbox();
	assert.deepEqual(
		{
			completionWithoutTime: items.has(completedWithoutTime),
			completionEightDaysAgo: items.has(completedEightDaysAgo),
		},
		{ completionWithoutTime: false, completionEightDaysAgo: false },
	);
	assert.deepEqual(
		new Set(items.keys()),
		new Set([ordinary, followUp, held, completed, settled, proposal]),
	);
	assert.partialDeepStrictEqual(items.get(ordinary), {
		item_id: `next_action:${ordinary}`,
		title: "Send the lease",
		context_label: "Example Dental",
		due_on: "2026-11-19",
		open_url: `/relationships?node=party:${client}`,
		section: "snoozed",
		snoozed_until: "2999-01-01T00:00:00.000Z",
		action_id: ordinary,
	});
	assert.partialDeepStrictEqual(items.get(held), {
		section: "held",
		hold_until: "2999-04-01T05:00:00.000Z",
		snoozed_until: null,
	});
	assert.partialDeepStrictEqual(items.get(completed), {
		source_state: "done",
		section: "settled",
		auto_settled: true,
	});
	assert.equal(typeof items.get(completed)?.completed_at, "string");
	assert.equal(items.get(settled)?.section, "settled");

	const otherItems = await inbox({ user: "other-partner" });
	assert.deepEqual([...otherItems.keys()], [otherStep]);
	assert.equal(otherItems.get(otherStep)?.section, "settled");

	const before = items.get(settled);
	await db.query(`begin;
		select set_config('engine.user_id', '${owner}', true);
		update next_step set what = 'Confirm the lease term' where id = '${settled}';
		commit;`);
	const after = (await inbox()).get(settled);
	assert.partialDeepStrictEqual(after, {
		title: "Confirm the lease term",
		section: "inbox",
	});
	assert.notEqual(after?.base_version, before?.base_version);
});

test("a call follow-up appears once with its call, deal and evidence", async () => {
	const item = (await inbox()).get(followUp);
	assert.ok(item);
	assert.equal(Object.hasOwn(item, "source_ref"), false);
	assert.partialDeepStrictEqual(item, {
		item_id: `capture_post_call_action:${followUp}`,
		title: "Call Dr. Example about the second-floor suite",
		kind_label: "Call follow-up",
		section: "inbox",
		open_url: `/calls?session=${call}`,
		deal_id: deal,
		action_id: followUp,
		merged_source_ids: [followUp],
		source_activity: {
			kind: "call",
			id: call,
			happened_at: "2026-11-17T22:30:00.000Z",
			contact: "Dr. Example",
			summary: "Discussed the suite.",
			quote: "Please send the floor plan.",
		},
	});
});

test("a step created by a suggestion keeps the meeting source", async () => {
	assert.partialDeepStrictEqual((await inbox()).get(proposal), {
		title: "Check renewal dates",
		open_url: `/deals?deal=${meetingDeal}&focus=next-step`,
		source_activity: { kind: "meeting", id: meeting },
	});
});
