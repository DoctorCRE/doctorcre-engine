import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestContext, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";

const partner = { user: "joe" };
const job = { job: "nightly_checklist" };

async function reminderDeal(t: TestContext) {
	const { db, setup, cleanup, request, save } = doorTest();
	await setup();
	t.after(cleanup);
	const user = randomUUID();
	const deal = randomUUID();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${user}', 'person', 'Example Owner');
		insert into app_user (id, slug) values ('${user}', 'joe');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Deal', '${user}');
		commit;`);
	const queue = async (day: string) => {
		const added = await save(partner, `deals/${deal}/critical-dates`, {
			idempotency_key: randomUUID(),
			kind: "loi_expiry",
			due_on: day,
			source: "Example offer",
		});
		assert.equal(added[0], 201);
		const date = added[1].critical_date_id;
		assert.equal(typeof date, "string");
		const [status, result] = await save(job, "deals/checklist-reminders", {
			idempotency_key: randomUUID(),
			run_date: day,
		});
		assert.equal(status, 200);
		assert.equal(result.queued, 1);
		return date;
	};
	return { db, request, save, queue, user, deal };
}

test("Home and Updates show reminders only while the date and deal are open", async (t) => {
	const { db, request, save, queue, user, deal } = await reminderDeal(t);
	t.mock.timers.enable({
		apis: ["Date"],
		now: Date.parse("2026-03-07T15:00:00Z"),
	});
	const date = await queue("2000-01-01");
	const ref = `critical-date:${date}`;
	const expectReminders = async (refs: string[]) => {
		const response = await request(
			partner,
			"home/inbox?view=dashboard",
			{ method: "GET" },
			{
				HOME_INBOX_READ_SCHEMA: "next",
			},
		);
		assert.equal(response.status, 200);
		const body: unknown = await response.json();
		assert.ok(
			isArguments(body) &&
				isArguments(body.reminders) &&
				Array.isArray(body.reminders.items),
		);
		assert.deepEqual(reminderRefs(body.reminders.items), refs);
		const [status, updates] = await save(partner, "updates", {}, "GET");
		assert.equal(status, 200);
		assert.equal(updates.unread_count, refs.length);
		assert.ok(Array.isArray(updates.updates));
		assert.deepEqual(reminderRefs(updates.updates), refs);
	};
	await expectReminders([ref]);

	const [resolved] = await save(partner, `critical-dates/${date}/resolve`, {
		idempotency_key: randomUUID(),
		resolution: "done",
		reason: "Example deadline met",
	});
	assert.equal(resolved, 200);
	await expectReminders([]);

	const nextDate = await queue("2000-01-02");
	const nextRef = `critical-date:${nextDate}`;
	await expectReminders([nextRef]);
	await db.query("select set_config('engine.user_id', $1, false)", [user]);
	await db.query(
		"update deal set parking_reason = 'client_paused' where id = $1",
		[deal],
	);
	await expectReminders([]);
	await db.query("update deal set parking_reason = null where id = $1", [deal]);
	await db.query("insert into phase (slug, label) values ('closed', 'Closed')");
	await db.query(
		"insert into deal_phase_change (deal_id, happened_at, phase) values ($1, '2000-01-02', 'closed')",
		[deal],
	);
	await expectReminders([]);
	await db.query("delete from deal_phase_change where deal_id = $1", [deal]);
	await expectReminders([nextRef]);
	await db.query("delete from critical_date where id = $1", [nextDate]);
	await expectReminders([]);
	assert.equal((await db.query("select id from home_update")).rowCount, 2);
});

function reminderRefs(items: unknown[]) {
	return items.filter(isArguments).map((card) => card.checklist_item_ref);
}

test("the morning window follows Central calendar days across midnight and DST", async (t) => {
	const { db, queue, user } = await reminderDeal(t);
	t.mock.timers.enable({ apis: ["Date"], now: 0 });
	for (const [day, queuedAt, quietUntil, heldUntil] of [
		["2000-01-01", "2026-03-07T05:30:00Z", "07:00", "2026-03-07T13:00:00Z"],
		["2000-01-02", "2026-03-07T06:30:00Z", "07:00", "2026-03-07T13:00:00Z"],
		["2000-01-03", "2026-03-08T05:30:00Z", "07:00", "2026-03-08T12:00:00Z"],
		["2000-01-04", "2026-03-08T06:30:00Z", "23:00", null],
		["2000-01-05", "2026-03-08T08:15:00Z", "23:30", null],
		["2000-01-06", "2026-03-08T08:00:00Z", "02:30", "2026-03-08T08:30:00Z"],
	] as const) {
		await t.test(
			`${queuedAt} with quiet hours ending at ${quietUntil}`,
			async () => {
				await db.query("select set_config('engine.user_id', $1, false)", [
					user,
				]);
				await db.query(
					`insert into user_preference (user_id, time_zone, quiet_from, quiet_until)
				values ($1, 'America/Chicago', '22:00', $2)
				on conflict (user_id) do update set quiet_until = excluded.quiet_until`,
					[user, quietUntil],
				);
				t.mock.timers.setTime(Date.parse(queuedAt));
				const date = await queue(day);
				const { rows } = await db.query<{ held_until: Date | null }>(
					"select held_until from home_update where checklist_item_ref = $1",
					[`critical-date:${date}`],
				);
				assert.deepEqual(rows, [
					{ held_until: heldUntil && new Date(heldUntil) },
				]);
			},
		);
	}
});

test("a queued checklist reminder loses its private title when the step is reassigned", async (t) => {
	const { db, request, save, user, deal } = await reminderDeal(t);
	const [caller, call, step] = Array.from({ length: 3 }, () => randomUUID());
	const title = "Example private checklist";
	await db.query(`
		set local engine.job = 'old_system';
		insert into party (id, kind, name) values ('${caller}', 'person', 'Example Caller');
		insert into app_user (id, slug) values ('${caller}', 'dell');
		set local engine.job = ''; set local engine.user_id = '${caller}';
		insert into activity (id, kind, happened_at) values ('${call}', 'call', '2025-01-01');
		insert into activity_about (activity_id, deal_id) values ('${call}', '${deal}');
		insert into next_step (id, deal_id, owner_party_id, what, item_title, source_ref, due_on,
			call_activity_id, call_evidence_quote)
		values ('${step}', '${deal}', '${user}', 'Example wording', '${title}', 'example:plan',
			'2025-01-01', '${call}', 'Example quote');
		set local engine.job = 'nightly_checklist'; set local engine.user_id = '';
		insert into home_update (user_id, deal_id, checklist_item_ref, due_on, what)
		values ('${user}', '${deal}', 'deal-item:${step}', '2025-01-01', 'Example reminder');
	`);
	const updates = async () => {
		const [status, body] = await save(partner, "updates", {}, "GET");
		assert.equal(status, 200);
		return JSON.stringify(body);
	};
	assert.ok((await updates()).includes(title));
	await db.query(`
		set local engine.user_id = '${caller}';
		update next_step set owner_party_id = '${caller}' where id = '${step}';
	`);
	assert.ok(!(await updates()).includes(title));
	const home = await request(
		partner,
		"home/inbox?view=dashboard",
		{ method: "GET" },
		{
			HOME_INBOX_READ_SCHEMA: "next",
		},
	);
	assert.equal(home.status, 200);
	assert.ok(!(await home.text()).includes(title));
});
