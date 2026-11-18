import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const owner = randomUUID();
const other = randomUUID();
const alex = { user: "alex" };
const blair = { user: "blair" };

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${owner}', 'person', 'Alex Example'), ('${other}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${owner}', 'alex'), ('${other}', 'blair');
		commit;`);
});
after(cleanup);

async function cards(caller: typeof alex, dealId: string) {
	const response = await request(
		caller,
		"home/inbox",
		{ method: "GET" },
		{
			HOME_INBOX_READ_SCHEMA: "next",
		},
	);
	assert.equal(response.status, 200);
	const result: unknown = await response.json();
	assert.ok(isArguments(result) && Array.isArray(result.items));
	return result.items
		.filter(isArguments)
		.filter((item) => item.deal_id === dealId);
}

test("one completion review replaces its ordinary step until a partner decides", async () => {
	const deal = randomUUID();
	const step = randomUUID();
	const note = randomUUID();
	const call = randomUUID();
	await db.query(`begin;
		select set_config('engine.user_id', '${owner}', true);
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Dental', '${owner}');
		insert into next_step (id, deal_id, what, due_on) values ('${step}', '${deal}', 'Send the survey', '2001-02-01');
		insert into activity (id, kind, happened_at, summary) values
			('${note}', 'note', '2001-02-03T15:00Z', 'The client asked for the survey.'),
			('${call}', 'call', '2001-02-04T15:00Z', 'The client received the survey.');
		insert into activity_about (activity_id, deal_id) values ('${note}', '${deal}'), ('${call}', '${deal}');
		commit;`);
	for (const activity_id of [note, call]) {
		const [status] = await save(
			{ job: "agent", for_user: alex.user },
			"proposals",
			{
				idempotency_key: randomUUID(),
				kind: "next_step_done",
				next_step_id: step,
				activity_id,
				deal_id: deal,
				evidence: "I received the survey.",
			},
		);
		assert.equal(status, 201);
	}
	const [card, ...duplicates] = await cards(alex, deal);
	assert.deepEqual(duplicates, []);
	assert.partialDeepStrictEqual(card, {
		title: "Did this happen? Send the survey",
		context_label: "Example Dental",
		due_on: "2001-02-01",
		open_url: `/deals?deal=${deal}&focus=next-step`,
		action_id: null,
		source_activity: {
			kind: "call",
			id: call,
			quote: "I received the survey.",
		},
		completion_review: { next_step_id: step, can_resolve: true },
	});
	assert.deepEqual(await cards(blair, deal), []);
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		insert into home_mark (user_id, next_step_id, disposition, snoozed_until) values
			('${owner}', '${step}', 'snoozed', '2999-01-01');
		commit;`);
	assert.deepEqual(await cards(alex, deal), []);
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		update home_mark set snoozed_until = '2001-01-01' where next_step_id = '${step}';
		commit;`);
	assert.equal((await cards(alex, deal))[0]?.item_id, card?.item_id);
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		update home_mark set disposition = 'settled', snoozed_until = null where next_step_id = '${step}';
		commit;`);
	assert.deepEqual(await cards(alex, deal), []);
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		delete from home_mark where next_step_id = '${step}';
		commit;`);
	const [status] = await save(alex, `proposals/${card?.source_id}/decision`, {
		idempotency_key: randomUUID(),
		decision: "dismiss",
	});
	assert.equal(status, 200);
	assert.deepEqual(
		(await cards(alex, deal)).map((item) => item.item_id),
		[`next_action:${step}`],
	);
});

test("updates respect recipient, read time, snoozes and the latest disposition change", async () => {
	const deal = randomUUID();
	const update = randomUUID();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Dental', '${other}');
		insert into home_update (id, user_id, deal_id, what, checklist_item_ref, due_on, read_at) values
			('${update}', '${owner}', '${deal}', 'Review the survey', 'survey/item', '2001-02-01', null),
			(gen_random_uuid(), '${owner}', '${deal}', 'Read already', null, null, now());
		commit;`);
	const [card, ...duplicates] = await cards(alex, deal);
	assert.deepEqual(duplicates, []);
	assert.partialDeepStrictEqual(card, {
		item_id: `notification:${update}`,
		kind_label: "Update",
		title: "Review the survey",
		context_label: "Example Dental",
		open_url: `/deals?deal=${deal}`,
		checklist_item_ref: "survey/item",
		due_on: "2001-02-01",
	});
	assert.equal(card?.base_version, `${card?.source_version}:0:inbox`);
	assert.deepEqual(await cards(blair, deal), []);
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		insert into home_mark (user_id, home_update_id, disposition, snoozed_until) values
			('${owner}', '${update}', 'snoozed', '2999-01-01');
		commit;`);
	assert.deepEqual(await cards(alex, deal), []);
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		update home_mark set snoozed_until = '2001-01-01' where home_update_id = '${update}';
		commit;`);
	assert.equal((await cards(alex, deal))[0]?.item_id, card?.item_id);
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		update home_mark set disposition = 'settled', snoozed_until = null where home_update_id = '${update}';
		commit;`);
	assert.deepEqual(await cards(alex, deal), []);
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		update home_update set what = 'Review the revised survey' where id = '${update}';
		update home_mark set waiting_on_party_id = '${other}', waiting_reason = 'For review' where home_update_id = '${update}';
		commit;`);
	const [revised] = await cards(alex, deal);
	assert.equal(revised?.title, "Review the revised survey");
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		delete from home_mark where home_update_id = '${update}';
		commit;`);
	const [cleared] = await cards(alex, deal);
	assert.match(
		String(cleared?.base_version),
		new RegExp(`^${revised?.source_version}:[1-9][0-9]*:inbox$`),
	);
	assert.notEqual(cleared?.base_version, revised?.base_version);
});
