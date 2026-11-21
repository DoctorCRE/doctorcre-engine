import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const [owner, other, active, another, parked, closed, due, overdue] =
	Array.from({ length: 8 }, () => randomUUID());
const path = "deals/checklist-reminders";
const job = { job: "nightly_checklist" };
const run = (key = randomUUID()) =>
	save(job, path, { run_date: "2000-01-02", idempotency_key: key });

before(async () => {
	await setup();
	await db
		.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${owner}', 'person', 'Example Owner'), ('${other}', 'person', 'Other Owner');
		insert into app_user (id, slug) values ('${owner}', 'joe'), ('${other}', 'dell');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${owner}', true);
		insert into user_preference (user_id, time_zone, quiet_from, quiet_until)
		select '${other}', 'Pacific/Honolulu', (local_now - interval '8 hours')::time,
			(local_now + interval '2 hours')::time
		from (select now() at time zone 'Pacific/Honolulu' as local_now) clock;
		insert into deal (id, name, owner_user_id, parking_reason) values
			('${active}', 'Active Deal', '${owner}', null),
			('${another}', 'Another Deal', '${other}', null),
			('${parked}', 'Parked Deal', '${owner}', 'client_paused'),
			('${closed}', 'Closed Deal', '${owner}', null);
		insert into phase (slug, label) values ('closed', 'Closed');
		insert into deal_phase_change (deal_id, happened_at, phase)
			values ('${closed}', '2000-01-01T12:00:00Z', 'closed');
		insert into critical_date (id, deal_id, kind, due_on, source)
			values ('${due}', '${active}', 'loi_expiry', '2000-01-02', 'Example offer');
		update critical_date set status = 'open' where id = '${due}';
		insert into next_step (id, deal_id, what, item_title, source_ref, due_on, resolution) values
			('${overdue}', '${another}', 'Example checklist', 'Read the plan', 'example:plan', '2000-01-01', null),
			(gen_random_uuid(), '${active}', 'Example checklist', 'Future item', 'example:future', '2000-01-03', null),
			(gen_random_uuid(), '${active}', 'Example checklist', 'Finished item', 'example:done', '2000-01-02', 'done'),
			(gen_random_uuid(), '${active}', 'Example checklist', 'Unsourced item', chr(9), '2000-01-02', null),
			(gen_random_uuid(), '${parked}', 'Example checklist', 'Parked item', 'example:parked', '2000-01-02', null),
			(gen_random_uuid(), '${closed}', 'Example checklist', 'Closed item', 'example:closed', '2000-01-02', null);
		commit;`)
		.catch(async (error: unknown) => {
			await db.query("rollback");
			throw error;
		});
});
after(cleanup);

test("due and overdue items queue for the deal owners once, even with concurrent runs", async () => {
	const keys = [randomUUID(), randomUUID()];
	const replies = await Promise.all(keys.map(run));
	for (const [status] of replies) assert.equal(status, 200);
	assert.deepEqual(
		replies
			.map(([, body]) => body)
			.sort((a, b) => Number(b.queued) - Number(a.queued)),
		[
			{ queued: 2, already_queued: 0 },
			{ queued: 0, already_queued: 2 },
		],
	);
	const { rows } = await db.query(`select user_id, deal_id, checklist_item_ref,
		due_on::text, what, changed_by_job from home_update order by due_on`);
	const what =
		"A deal checklist item is due. Open the deal checklist for details.";
	assert.deepEqual(rows, [
		{
			user_id: other,
			deal_id: another,
			checklist_item_ref: `deal-item:${overdue}`,
			due_on: "2000-01-01",
			what,
			changed_by_job: job.job,
		},
		{
			user_id: owner,
			deal_id: active,
			checklist_item_ref: `critical-date:${due}`,
			due_on: "2000-01-02",
			what,
			changed_by_job: job.job,
		},
	]);
	assert.deepEqual(await run(), [200, { queued: 0, already_queued: 2 }]);
	const key = keys[replies.findIndex(([, body]) => body.queued === 2)];
	assert.ok(key);
	assert.deepEqual(await run(key), [
		200,
		{ replayed: true, queued: 2, already_queued: 0 },
	]);

	const later = { run_date: "2000-01-03", idempotency_key: key };
	const [conflict, refusal] = await save(job, path, later);
	assert.equal(conflict, 409);
	assert.equal(refusal.error, "key_reuse");
	assert.deepEqual(
		await save(job, path, { ...later, idempotency_key: randomUUID() }),
		[200, { queued: 1, already_queued: 2 }],
	);

	const {
		rows: [hold],
	} = await db.query<{ id: string; at_morning_open: boolean }>(
		`select h.id, h.held_until > h.created_at
			and (h.held_until at time zone p.time_zone)::time = p.quiet_until as at_morning_open
		from home_update h join user_preference p using (user_id) where h.user_id = $1`,
		[other],
	);
	assert.ok(hold?.at_morning_open);
	const partner = { user: "dell" };
	assert.deepEqual(await save(partner, "updates", {}, "GET"), [
		200,
		{ unread_count: 0, updates: [] },
	]);
	const [hidden] = await save(partner, "updates/read", {
		idempotency_key: randomUUID(),
		update_ids: [hold.id],
	});
	assert.equal(hidden, 404);
	await db.query("select set_config('engine.user_id', $1, false)", [other]);
	await db.query(
		"update home_update set held_until = created_at where id = $1",
		[hold.id],
	);
	const [status, visible] = await save(partner, "updates", {}, "GET");
	assert.equal(status, 200);
	assert.partialDeepStrictEqual(visible, {
		unread_count: 1,
		updates: [
			{ source_id: hold.id, checklist_item_ref: `deal-item:${overdue}` },
		],
	});
});

test("the nightly reminder door refuses a different registered job", async () => {
	const [status, body] = await save({ job: "lead_stage" }, path, {
		run_date: "2000-01-02",
		idempotency_key: randomUUID(),
	});
	assert.equal(status, 403);
	assert.equal(body.error, "unknown_job");
});

test("the nightly reminder door refuses a malformed calendar date", async () => {
	const [status, body] = await save(job, path, {
		run_date: "2000-02-30",
		idempotency_key: randomUUID(),
	});
	assert.equal(status, 400);
	assert.equal(body.error, "invalid_field_value");
});
