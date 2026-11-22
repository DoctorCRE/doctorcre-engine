import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const owner = randomUUID();
const other = randomUUID();
const alex = { user: "joe" };
const blair = { user: "dell" };

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${owner}', 'person', 'Alex Example'), ('${other}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${owner}', '${alex.user}'), ('${other}', '${blair.user}');
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
	assert.equal(Object.hasOwn(result, "auto_settle_enabled"), false);
	const items = result.items.filter(isArguments);
	for (const item of items) {
		assert.equal(Object.hasOwn(item, "auto_settled"), false);
		assert.equal(Object.hasOwn(item, "explicit_unsettle"), false);
	}
	return items.filter((item) => item.deal_id === dealId);
}

async function checkCompletionReview(callFollowUp: boolean) {
	const deal = randomUUID();
	const dealName = callFollowUp ? "Example Renewal" : "Example Dental";
	const step = randomUUID();
	const note = randomUUID();
	const call = randomUUID();
	const item_id = `${callFollowUp ? "capture_post_call_action" : "next_action"}:${step}`;
	await db.query(`begin;
		select set_config('engine.user_id', '${owner}', true);
		insert into deal (id, name, owner_user_id) values ('${deal}', '${dealName}', '${owner}');
		insert into activity (id, kind, happened_at, summary) values
			('${note}', 'note', '2001-02-03T15:00Z', 'The client asked for the survey.'),
			('${call}', 'call', '2001-02-04T15:00Z', 'The client received the survey.');
		insert into activity_about (activity_id, deal_id) values ('${note}', '${deal}'), ('${call}', '${deal}');
		insert into next_step (id, deal_id, what, due_on, call_activity_id, call_evidence_quote)
		values ('${step}', '${deal}', 'Send the survey', '2001-02-01',
			${callFollowUp ? `'${call}', 'Send the survey.'` : "null, null"});
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
		item_id,
		title: `Check whether the step for ${dealName} is done`,
		why: "I received the survey. Send the survey.",
		primary_action: "Review completion",
		context_label: dealName,
		due_on: "2001-02-01",
		open_url: `/deals?deal=${deal}&focus=next-step&step=${step}`,
		action_id: null,
		source_activity: {
			kind: "call",
			id: call,
			quote: "I received the survey.",
		},
		completion_review: { next_step_id: step, can_resolve: true },
	});
	const today = await request(
		alex,
		"home/today",
		{ method: "GET" },
		{
			HOME_INBOX_READ_SCHEMA: "next",
		},
	);
	assert.equal(today.status, 200);
	const { reminders } = (await today.json()) as {
		reminders: { late: { home_item_id: string; title: string }[] };
	};
	assert.equal(
		reminders.late.find((item) => item.home_item_id === item_id)?.title,
		card?.title,
	);

	assert.deepEqual(await cards(blair, deal), []);
	const detailPath = `proposals/${card?.source_id}`;
	const [opened, detail] = await save(alex, detailPath, {}, "GET");
	assert.equal(opened, 200);
	assert.partialDeepStrictEqual(detail, {
		kind: "next_step_done",
		next_step_id: step,
		what: "Send the survey",
		evidence: "I received the survey.",
		source_activity: { id: call, kind: "call" },
	});
	assert.equal((await save(blair, detailPath, {}, "GET"))[0], 404);
	const [snoozed, mark] = await save(alex, "home/marks", {
		idempotency_key: randomUUID(),
		item_id: card?.item_id,
		base_version: card?.base_version,
		action: "snooze",
		until: "2999-01-01T00:00Z",
	});
	assert.equal(snoozed, 200);
	assert.partialDeepStrictEqual(await cards(alex, deal), [
		{
			item_id,
			section: "snoozed",
			base_version: mark.base_version,
			snoozed_until: "2999-01-01T00:00:00.000Z",
		},
	]);
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		update home_mark set snoozed_until = '2001-01-01' where item_id = '${step}';
		commit;`);
	assert.deepEqual(
		(await cards(alex, deal))[0]?.completion_review,
		card?.completion_review,
	);
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		delete from home_mark where item_id = '${step}';
		commit;`);
	const [status] = await save(alex, `proposals/${card?.source_id}/decision`, {
		idempotency_key: randomUUID(),
		decision: "dismiss",
	});
	assert.equal(status, 200);
	const [dismissed, ...remaining] = await cards(alex, deal);
	assert.deepEqual(remaining, []);
	assert.partialDeepStrictEqual(dismissed, { item_id, action_id: step });
	assert.equal(dismissed?.completion_review, undefined);
	if (callFollowUp) {
		assert.partialDeepStrictEqual(dismissed, {
			title: "Send the survey",
			why: "Call on Feb 4, 2001. Due Feb 1, 2001.",
			open_url: `/calls?session=${call}`,
		});
	}
}

test("a completion review can be snoozed and dismissed", () =>
	checkCompletionReview(false));
test("a call follow-up completion review can be snoozed and dismissed", () =>
	checkCompletionReview(true));

test("the flat Home list and dashboard show the same days late", async () => {
	const deal = randomUUID();
	const onTimeDeal = randomUUID();
	const vendor = randomUUID();
	const note = randomUUID();
	const reviewed = randomUUID();
	const onTime = randomUUID();
	const followUp = randomUUID();
	await db.query(`begin;
		select set_config('engine.user_id', '${owner}', true);
		insert into role (slug, label) values ('vendor', 'Vendor');
		insert into party (id, kind, name) values ('${vendor}', 'company', 'Example Surveyors');
		insert into party_role (party_id, role) values ('${vendor}', 'vendor');
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'Example Survey Review', '${owner}'),
			('${onTimeDeal}', 'Example Site Plan', '${owner}');
		insert into activity (id, kind, happened_at, summary)
			values ('${note}', 'note', now() - interval '1 day', 'The client received the survey.');
		insert into activity_about (activity_id, deal_id) values ('${note}', '${deal}');
		with day as (select (now() at time zone 'America/Chicago')::date as today)
		insert into next_step (id, deal_id, party_id, owner_party_id, what, due_on)
		select v.id::uuid, v.deal_id::uuid, v.party_id::uuid, '${owner}', v.what, day.today + v.days
		from day cross join (values
			('${reviewed}', '${deal}', null, 'Send the survey', -3),
			('${followUp}', null, '${vendor}', 'Call the surveyor', -3),
			('${onTime}', '${onTimeDeal}', null, 'Review the site plan', 0)
		) v(id, deal_id, party_id, what, days);
		commit;`);
	const [status] = await save(
		{ job: "agent", for_user: alex.user },
		"proposals",
		{
			idempotency_key: randomUUID(),
			kind: "next_step_done",
			next_step_id: reviewed,
			activity_id: note,
			deal_id: deal,
			evidence: "The client received the survey.",
		},
	);
	assert.equal(status, 201);
	for (const view of ["?view=dashboard", ""]) {
		const response = await request(
			alex,
			`home/inbox${view}`,
			{ method: "GET" },
			{ HOME_INBOX_READ_SCHEMA: "next" },
		);
		assert.equal(response.status, 200);
		const result: unknown = await response.json();
		assert.ok(isArguments(result));
		const group = view ? result.reminders : result;
		assert.ok(isArguments(group) && Array.isArray(group.items));
		const items = group.items.filter(isArguments);
		const card = (id: string) =>
			items.find((item) => item.item_id === `next_action:${id}`);
		assert.partialDeepStrictEqual(card(followUp), { days_late: 3 });
		assert.partialDeepStrictEqual(card(reviewed), {
			days_late: 3,
			completion_review: { next_step_id: reviewed },
		});
		assert.partialDeepStrictEqual(card(onTime), { days_late: null });
	}
});

test("updates respect recipient, read time, snoozes and mark revisions", async () => {
	const deal = randomUUID();
	const update = randomUUID();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Survey', '${other}');
		insert into home_update (id, user_id, deal_id, what, checklist_item_ref, due_on, read_at) values
			('${update}', '${owner}', '${deal}', 'Review the survey', 'survey/item', '2001-02-01', null),
			(gen_random_uuid(), '${owner}', '${deal}', 'Read already', null, null, now());
		commit;`);
	const [card, ...duplicates] = await cards(alex, deal);
	assert.deepEqual(duplicates, []);
	assert.partialDeepStrictEqual(card, {
		item_id: `notification:${update}`,
		kind_label: "Update",
		title: "Review the checklist item for Example Survey",
		why: "Review the survey. Due Feb 1, 2001.",
		primary_action: "Open checklist item",
		context_label: "Example Survey",
		open_url: `/deals?deal=${deal}`,
		checklist_item_ref: "survey/item",
		due_on: "2001-02-01",
	});
	assert.equal(card?.base_version, `${card?.source_version}:0:inbox`);
	assert.deepEqual(await cards(blair, deal), []);
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		insert into home_mark (user_id, home_update_id, disposition, snoozed_until) values
			('${owner}', '${update}', 'snoozed', '2999-01-01T00:00Z');
		commit;`);
	const [snoozed] = await cards(alex, deal);
	assert.partialDeepStrictEqual(snoozed, {
		item_id: `notification:${update}`,
		section: "snoozed",
		disposition: "snoozed",
		snoozed_until: "2999-01-01T00:00:00.000Z",
	});
	assert.match(
		String(snoozed?.base_version),
		new RegExp(`^${card?.source_version}:[1-9][0-9]*:snoozed$`),
	);
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		update home_mark set snoozed_until = '2001-01-01' where home_update_id = '${update}';
		commit;`);
	assert.partialDeepStrictEqual((await cards(alex, deal))[0], {
		item_id: `notification:${update}`,
		section: "inbox",
		snoozed_until: null,
	});
	await db.query(`begin; select set_config('engine.user_id', '${owner}', true);
		update home_update set what = 'Review the revised survey' where id = '${update}';
		update home_mark set waiting_on_party_id = '${other}', waiting_reason = 'For review' where home_update_id = '${update}';
		commit;`);
	const [revised] = await cards(alex, deal);
	assert.partialDeepStrictEqual(revised, {
		title: "Review the checklist item for Example Survey",
		why: "Review the revised survey. Due Feb 1, 2001.",
		section: "inbox",
	});
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

test("a checklist reminder uses the decision title when its item is a status label", async () => {
	const deal = randomUUID();
	const dealName = "Example Survey Checklist";
	const step = randomUUID();
	const update = randomUUID();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into deal (id, name, owner_user_id) values ('${deal}', '${dealName}', '${owner}');
		insert into next_step (id, deal_id, what, item_title, source_ref)
			values ('${step}', '${deal}', 'Review the survey', 'Follow-up set for Morgan', 'example-survey');
		insert into home_update (id, user_id, deal_id, what, checklist_item_ref, due_on)
			values ('${update}', '${owner}', '${deal}', 'Review the survey', 'deal-item:${step}', '2001-02-01');
		commit;`);
	const card = (await cards(alex, deal)).find(
		(item) => item.source_id === update,
	);
	assert.partialDeepStrictEqual(card, {
		title: `Review the checklist item for ${dealName}`,
		why: "Follow-up set for Morgan. Due Feb 1, 2001.",
	});
});

test("checklist reminders follow the item through completion, drop and reopen", async () => {
	const deal = randomUUID();
	const step = randomUUID();
	const reminder = randomUUID();
	const dropped = randomUUID();
	const noRef = randomUUID();
	const unmatched = randomUUID();
	await db.query(`begin;
		select set_config('engine.user_id', '${owner}', true);
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Dental Checklist', '${owner}');
		insert into next_step (id, deal_id, what, item_title, source_ref)
			values ('${step}', '${deal}', 'Review the site survey', 'Site survey', 'example-survey');
		insert into home_update (id, user_id, deal_id, what, checklist_item_ref, due_on, read_at) values
			('${reminder}', '${owner}', '${deal}', 'Review the site survey', 'deal-item:${step}', '2001-02-01', null),
			('${dropped}', '${owner}', '${deal}', 'Earlier reminder', 'deal-item:${step}', '2001-01-01', null),
			(gen_random_uuid(), '${owner}', '${deal}', 'Read already', 'deal-item:${step}', '2001-03-01', now()),
			('${noRef}', '${owner}', '${deal}', 'Deal update', null, null, null),
			('${unmatched}', '${owner}', '${deal}', 'Review the floor plan', 'deal-item:${randomUUID()}', '2001-02-01', null);
		insert into home_mark (user_id, home_update_id, disposition, drop_reason)
			values ('${owner}', '${dropped}', 'dropped', 'Duplicate reminder');
		commit;`);

	async function expectUpdates(ids: string[]) {
		const updates = (await cards(alex, deal)).filter(
			(card) => card.kind === "update",
		);
		assert.deepEqual(
			updates.map((card) => card.item_id).sort(),
			ids.map((id) => `notification:${id}`).sort(),
		);
	}

	const otherUpdates = [noRef, unmatched];
	const openUpdates = [reminder, ...otherUpdates];
	await expectUpdates(openUpdates);
	for (const end of [
		{ resolution: "done" },
		{ resolution: "cancelled", reason: "Survey no longer needed" },
	]) {
		const [ended, result] = await save(alex, `next-steps/${step}/end`, {
			idempotency_key: randomUUID(),
			...end,
		});
		assert.equal(ended, 200);
		await expectUpdates(otherUpdates);

		const [reopened] = await save(alex, `next-steps/${step}/reopen`, {
			idempotency_key: randomUUID(),
			base_version: result.change_id,
		});
		assert.equal(reopened, 200);
		await expectUpdates(openUpdates);
	}
});

test("tour comment and shortlist changes retain their saved property context", async () => {
	const deal = randomUUID();
	const property = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Dental Tour', '${owner}');
		insert into property (id, name, address) values ('${property}', 'Cedar Suite', '100 Example Way');
		insert into home_update (user_id, deal_id, kind, what, property_id, created_at) values
			('${owner}', '${deal}', 'tour_feedback', 'Needs a larger waiting area.\nGood parking.', '${property}', '2026-11-17T12:00Z'),
			('${owner}', '${deal}', 'tour_feedback', 'Example Dental added Cedar Suite to the shortlist', '${property}', '2026-11-18T12:00Z'),
			('${owner}', '${deal}', 'tour_feedback', 'Example Dental removed Cedar Suite from the shortlist', '${property}', '2026-11-19T12:00Z');
		commit;`);
	const examples = await cards(alex, deal);
	assert.partialDeepStrictEqual(examples, [
		{
			title: "Review tour feedback on Cedar Suite for Example Dental Tour",
			why: "Example Dental removed Cedar Suite from the shortlist. Recorded Nov 19, 2026.",
		},
		{
			title: "Review tour feedback on Cedar Suite for Example Dental Tour",
			why: "Example Dental added Cedar Suite to the shortlist. Recorded Nov 18, 2026.",
		},
		{
			title: "Review tour feedback on Cedar Suite for Example Dental Tour",
			why: "Needs a larger waiting area. Good parking. Recorded Nov 17, 2026.",
		},
	]);
	for (const card of examples) {
		assert.partialDeepStrictEqual(card, {
			property_id: property,
			open_url: `/deals?deal=${deal}&property=${property}`,
			primary_action: "Review feedback",
		});
	}
});
