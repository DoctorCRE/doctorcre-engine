import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type TestContext, test } from "node:test";
import { URL } from "node:url";
import { sql } from "kysely";
import { nextTransaction } from "../next-connection.ts";
import { isArguments } from "../save-door.ts";
import { copyTest } from "../test-copy.ts";
import { doorTest } from "../test-door.ts";
import { sweepDealAttentionAlerts } from "./attention-alerts.ts";

const JOB = { job: "attention_alerts" };
const PATH = "deals/attention-alerts";
const JOE = { user: "joe" };
const DELL = { user: "dell" };

const centralToday = () =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Chicago",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());

const addDays = (day: string, count: number) => {
	const [year, month, date] = day.split("-").map(Number);
	return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) + count))
		.toISOString()
		.slice(0, 10);
};

async function setupFixture(t: TestContext) {
	const door = doorTest();
	await door.setup();
	t.after(door.cleanup);
	const [joeId, dellId, otherId] = [randomUUID(), randomUUID(), randomUUID()];
	const runSql = async (text: string) => {
		try {
			await door.db.query(text);
		} catch (error) {
			await door.db.query("rollback").catch(() => {});
			throw error;
		}
	};
	await runSql(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into phase (slug, label) values ('closed', 'Closed'), ('dead', 'Dead');
		insert into party (id, kind, name) values
			('${joeId}', 'person', 'Joe Example'),
			('${dellId}', 'person', 'Dell Example'),
			('${otherId}', 'person', 'Other User');
		insert into app_user (id, slug) values
			('${joeId}', 'joe'), ('${dellId}', 'dell'), ('${otherId}', 'other');
		commit;`);
	const sweep = (key = randomUUID()) =>
		door.save(JOB, PATH, { idempotency_key: key });
	return {
		...door,
		runSql,
		joeId,
		dellId,
		otherId,
		sweep,
		today: centralToday(),
	};
}

test("new attention reasons alert once on Updates, stay off Home, and re-alert after clearing or owner change", async (t) => {
	const { db, runSql, request, save, joeId, dellId, otherId, sweep, today } =
		await setupFixture(t);
	const [openDeal, parkedDeal, closedDeal, otherOwnerDeal, stepId, dateId] =
		Array.from({ length: 6 }, () => randomUUID());
	await runSql(`begin;
		select set_config('engine.user_id', '${joeId}', true);
		insert into deal (id, name, owner_user_id, parking_reason) values
			('${openDeal}', 'Example Dental', '${joeId}', null),
			('${parkedDeal}', 'Example Parked', '${joeId}', 'client_paused'),
			('${closedDeal}', 'Example Closed', '${joeId}', null),
			('${otherOwnerDeal}', 'Example Nonpartner', '${otherId}', null);
		insert into deal_phase_change (deal_id, happened_at, phase) values
			('${closedDeal}', now(), 'closed');
		insert into next_step (id, deal_id, owner_party_id, what, due_on) values
			('${stepId}', '${openDeal}', '${joeId}', 'Send survey', '${addDays(today, -1)}'),
			(gen_random_uuid(), '${parkedDeal}', '${joeId}', 'Send survey', '${addDays(today, -2)}'),
			(gen_random_uuid(), '${closedDeal}', '${joeId}', 'Send survey', '${addDays(today, -2)}'),
			(gen_random_uuid(), '${otherOwnerDeal}', '${otherId}', 'Send survey', '${addDays(today, -2)}');
		commit;`);

	const keys = [randomUUID(), randomUUID()];
	const concurrent = await Promise.all(keys.map(sweep));
	for (const [status] of concurrent) assert.equal(status, 200);
	assert.deepEqual(
		concurrent
			.map(([, body]) => body)
			.sort((a, b) => Number(b.alerted) - Number(a.alerted)),
		[
			{ alerted: 1, unchanged: 0, cleared: 0 },
			{ alerted: 0, unchanged: 1, cleared: 0 },
		],
	);
	const winnerKey = keys[concurrent.findIndex(([, b]) => b.alerted === 1)];
	assert.ok(winnerKey);
	assert.deepEqual(await sweep(winnerKey), [
		200,
		{ replayed: true, alerted: 1, unchanged: 0, cleared: 0 },
	]);

	const [uStatus, joeUpdates] = await save(JOE, "updates", {}, "GET");
	assert.equal(uStatus, 200);
	assert.equal(joeUpdates.unread_count, 1);
	assert.ok(Array.isArray(joeUpdates.updates));
	assert.partialDeepStrictEqual(joeUpdates.updates[0], {
		title: "A next step is late.",
		context_label: "Example Dental",
		open_url: `/deals?deal=${openDeal}`,
		unseen: true,
	});
	const [, dellUpdates] = await save(DELL, "updates", {}, "GET");
	assert.deepEqual(dellUpdates, { unread_count: 0, updates: [] });
	const homeRes = await request(
		JOE,
		"home/inbox?view=dashboard",
		{ method: "GET" },
		{ HOME_INBOX_READ_SCHEMA: "next" },
	);
	const homeBody: unknown = await homeRes.json();
	assert.ok(
		isArguments(homeBody) &&
			isArguments(homeBody.reminders) &&
			Array.isArray(homeBody.reminders.items),
	);
	assert.equal(
		homeBody.reminders.items.some(
			(item) => isArguments(item) && item.source_type === "notification",
		),
		false,
	);

	const firstUpdateId = String(
		isArguments(joeUpdates.updates[0]) ? joeUpdates.updates[0].source_id : "",
	);
	assert.equal(
		(
			await save(JOE, "updates/read", {
				idempotency_key: randomUUID(),
				update_ids: [firstUpdateId],
			})
		)[0],
		200,
	);
	await runSql(`begin; select set_config('engine.user_id', '${dellId}', true);
		insert into next_step (deal_id, owner_party_id, what, due_on)
			values ('${openDeal}', '${dellId}', 'Earlier late step', '${addDays(today, -4)}');
		commit;`);
	assert.deepEqual(await sweep(), [
		200,
		{ alerted: 0, unchanged: 1, cleared: 0 },
	]);

	await runSql(`begin; select set_config('engine.user_id', '${joeId}', true);
		update next_step set due_on = '${addDays(today, 10)}' where deal_id = '${openDeal}';
		insert into critical_date (id, deal_id, kind, due_on, source)
			values ('${dateId}', '${openDeal}', 'loi_expiry', '${addDays(today, 3)}', 'Example offer');
		commit;`);
	assert.deepEqual(await sweep(), [
		200,
		{ alerted: 1, unchanged: 0, cleared: 0 },
	]);

	await runSql(`begin; select set_config('engine.user_id', '${joeId}', true);
		update deal set owner_user_id = '${dellId}' where id = '${openDeal}';
		commit;`);
	assert.deepEqual(await sweep(), [
		200,
		{ alerted: 1, unchanged: 0, cleared: 0 },
	]);
	assert.deepEqual(await sweep(), [
		200,
		{ alerted: 0, unchanged: 1, cleared: 0 },
	]);
	const [, dellAfter] = await save(DELL, "updates", {}, "GET");
	assert.equal(dellAfter.unread_count, 1);

	await runSql(`begin; select set_config('engine.user_id', '${dellId}', true);
		update critical_date set status = 'dropped', resolution_reason = 'Done' where id = '${dateId}';
		commit;`);
	assert.deepEqual(await sweep(), [
		200,
		{ alerted: 0, unchanged: 0, cleared: 1 },
	]);
	assert.equal(
		(await db.query("select from deal_attention_alert")).rowCount,
		0,
	);
	await runSql(`begin; select set_config('engine.user_id', '${dellId}', true);
		update next_step set due_on = '${addDays(today, -1)}' where id = '${stepId}';
		commit;`);
	assert.deepEqual(await sweep(), [
		200,
		{ alerted: 1, unchanged: 0, cleared: 0 },
	]);
	await runSql(`begin; select set_config('engine.user_id', '${dellId}', true);
		update deal set parking_reason = 'client_paused' where id = '${openDeal}';
		commit;`);
	assert.deepEqual(await sweep(), [
		200,
		{ alerted: 0, unchanged: 0, cleared: 1 },
	]);
});

test("quiet hours hold attention alerts until quiet_until across midnight and DST", async (t) => {
	const { db, runSql, save, joeId, sweep, today } = await setupFixture(t);
	const dealId = randomUUID();
	await runSql(`begin;
		select set_config('engine.user_id', '${joeId}', true);
		insert into deal (id, name, owner_user_id) values ('${dealId}', 'Example Quiet', '${joeId}');
		insert into next_step (deal_id, owner_party_id, what, due_on)
			values ('${dealId}', '${joeId}', 'Late step', '${addDays(today, -1)}');
		commit;`);

	await runSql(`begin; select set_config('engine.user_id', '${joeId}', true);
		insert into user_preference (user_id, time_zone, quiet_from, quiet_until)
		select '${joeId}', 'Pacific/Honolulu', (local_now - interval '2 hours')::time,
			(local_now + interval '2 hours')::time
		from (select now() at time zone 'Pacific/Honolulu' as local_now) clock;
		commit;`);
	assert.deepEqual(await sweep(), [
		200,
		{ alerted: 1, unchanged: 0, cleared: 0 },
	]);
	assert.deepEqual(await save(JOE, "updates", {}, "GET"), [
		200,
		{ unread_count: 0, updates: [] },
	]);

	t.mock.timers.enable({ apis: ["Date"], now: 0 });
	for (const [nowIso, quietFrom, quietUntil, expectedHold] of [
		["2026-03-08T05:30:00Z", "22:00", "07:00", "2026-03-08T12:00:00Z"],
		["2026-03-07T06:30:00Z", "22:00", "07:00", "2026-03-07T13:00:00Z"],
		["2026-03-08T12:00:00Z", "22:00", "07:00", null],
		["2026-03-07T18:30:00Z", "12:00", "14:00", "2026-03-07T20:00:00Z"],
		["2026-03-07T20:00:00Z", "12:00", "14:00", null],
	] as const) {
		await runSql(`begin;
			select set_config('engine.user_id', '${joeId}', true);
			update user_preference set time_zone = 'America/Chicago',
				quiet_from = '${quietFrom}', quiet_until = '${quietUntil}'
			where user_id = '${joeId}';
			delete from deal_attention_alert where deal_id = '${dealId}';
			commit;`);
		t.mock.timers.setTime(Date.parse(nowIso));
		assert.deepEqual(await sweep(), [
			200,
			{ alerted: 1, unchanged: 0, cleared: 0 },
		]);
		const {
			rows: [row],
		} = await db.query<{ held_until: Date | null }>(
			`select u.held_until from deal_attention_alert a
				join home_update u on u.id = a.home_update_id where a.deal_id = $1`,
			[dealId],
		);
		assert.deepEqual(row, {
			held_until: expectedHold ? new Date(expectedHold) : null,
		});
	}
});

test("a rolled-back sweep leaves nothing and the door refuses wrong jobs or bad bodies", async (t) => {
	const { db, runSql, save, connectionString, joeId, sweep, today } =
		await setupFixture(t);
	const dealId = randomUUID();
	await runSql(`begin;
		select set_config('engine.user_id', '${joeId}', true);
		insert into deal (id, name, owner_user_id) values ('${dealId}', 'Example Crash', '${joeId}');
		insert into next_step (deal_id, owner_party_id, what, due_on)
			values ('${dealId}', '${joeId}', 'Late step', '${addDays(today, -1)}');
		commit;`);

	await assert.rejects(
		nextTransaction(connectionString, "save", async (tx) => {
			await sql`select set_config('engine.job', 'attention_alerts', true)`.execute(
				tx,
			);
			const result = await sweepDealAttentionAlerts(tx);
			assert.deepEqual(result, { alerted: 1, unchanged: 0, cleared: 0 });
			throw new Error("simulated crash");
		}),
		{ message: "simulated crash" },
	);
	assert.equal((await db.query("select from home_update")).rowCount, 0);
	assert.equal(
		(await db.query("select from deal_attention_alert")).rowCount,
		0,
	);
	assert.deepEqual(await sweep(), [
		200,
		{ alerted: 1, unchanged: 0, cleared: 0 },
	]);

	const [wrongJobStatus, wrongJob] = await save(
		{ job: "nightly_checklist" },
		PATH,
		{ idempotency_key: randomUUID() },
	);
	assert.equal(wrongJobStatus, 403);
	assert.equal(wrongJob.error, "unknown_job");
	assert.equal(
		(await save(JOB, PATH, { idempotency_key: "not-a-uuid" }))[0],
		400,
	);
});

for (const migrated of [false, true]) {
	test(
		migrated
			? "the attention alerts migration gives an existing schema the same table, job and grants"
			: "the database enforces attention alert constraints and grants",
		async (t) => {
			const copy = copyTest();
			await copy.setup();
			t.after(copy.cleanup);
			const rules = copy.db;
			if (migrated) {
				const migration = await readFile(
					new URL(
						"../../schema/add-deal-attention-alerts.sql",
						import.meta.url,
					),
					"utf8",
				);
				await rules.query("drop table deal_attention_alert");
				await rules.query("delete from job where slug = 'attention_alerts'");
				await rules.query(migration);
				await rules.query(migration);
			}
			const [joeId, dellId, dealId, updateId] = Array.from({ length: 4 }, () =>
				randomUUID(),
			);
			await rules.query(`begin; set local engine.job = 'old_system';
				insert into party (id, kind, name) values
					('${joeId}', 'person', 'Joe Example'), ('${dellId}', 'person', 'Dell Example');
				insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell');
				insert into deal (id, name, owner_user_id) values ('${dealId}', 'Example Rule Deal', '${joeId}');
				insert into home_update (id, user_id, deal_id, what)
					values ('${updateId}', '${joeId}', '${dealId}', 'A next step is late.');
				commit;`);
			await rules.query("set role engine; set engine.job = 'attention_alerts'");
			await assert.rejects(
				rules.query(
					`insert into deal_attention_alert (deal_id, reason, since, owner_user_id, home_update_id)
					values ('${dealId}', '   ', '2026-01-01', '${joeId}', '${updateId}')`,
				),
				{ code: "23514", constraint: "deal_attention_alert_reason_check" },
			);
			await assert.rejects(
				rules.query(
					`insert into deal_attention_alert (deal_id, reason, since, owner_user_id, home_update_id)
					values ('${dealId}', 'A next step is late.', '2026-01-01', '${dellId}', '${updateId}')`,
				),
				{
					code: "23503",
					constraint: "deal_attention_alert_home_update_id_owner_user_id_fkey",
				},
			);
			await rules.query(
				`insert into deal_attention_alert (deal_id, reason, since, owner_user_id, home_update_id)
				values ('${dealId}', 'A next step is late.', '2026-01-01', '${joeId}', '${updateId}')`,
			);
			await assert.rejects(
				rules.query(
					`update deal_attention_alert set deal_id = '${randomUUID()}' where deal_id = '${dealId}'`,
				),
				{ code: "42501" },
			);
			await rules.query(
				`update deal_attention_alert set reason = 'Nothing has happened for 14 days.' where deal_id = '${dealId}'`,
			);
			await rules.query(
				`delete from deal_attention_alert where deal_id = '${dealId}'`,
			);
			assert.equal(
				(await rules.query("select from deal_attention_alert")).rowCount,
				0,
			);
		},
	);
}
