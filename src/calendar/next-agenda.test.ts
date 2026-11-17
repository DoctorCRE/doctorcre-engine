import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { type Caller, doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const alex = "00000000-0000-4000-8000-000000000001";
const blair = "00000000-0000-4000-8000-000000000002";
const key = "0123456789abcdef";
const job = { job: "mail_capture", for_user: "alex" };
const agenda = (observed_at = "2026-01-05T15:00:00Z") => ({
	schema: "carr-calendar-agenda.v1",
	source: "outlook_hxstore",
	lifecycle: "unverified",
	window_start: "2026-01-01T00:00:00Z",
	window_end: "2026-01-15T00:00:00Z",
	time_zone: "America/Chicago",
	observed_at,
	items: [{ title: "Example meeting" }],
	follow_up_reviews: [{ key }],
	warnings: [],
});
const put = (body: object, caller: Caller = job) =>
	save(caller, "calendar/agenda", body, "PUT");
const get = (caller: Caller = job) =>
	save(caller, "calendar/agenda", {}, "GET");
const dismiss = (
	review = key,
	idempotency_key = randomUUID(),
	caller: Caller = { user: "alex" },
) => save(caller, `calendar/reviews/${review}/dismissal`, { idempotency_key });
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${alex}', 'person', 'Alex Example'), ('${blair}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${alex}', 'alex'), ('${blair}', 'blair'); commit;`);
});
after(cleanup);
beforeEach(async () => {
	await db.query(`set session_replication_role = replica;
		delete from save_receipt; delete from change; delete from calendar_agenda;
		delete from calendar_review_dismissal; delete from activity;
		set session_replication_role = origin`);
});

test("agenda replaces at the same or newer observation and refuses an older observation", async () => {
	assert.deepEqual(await get(), [200, null]);
	assert.equal((await put(agenda()))[0], 200);
	assert.equal(
		(await put({ ...agenda(), warnings: [{ code: "example" }] }))[0],
		200,
	);
	assert.equal((await put(agenda("2026-01-06T15:00:00Z")))[0], 200);
	const [status, body] = await put(agenda());
	assert.equal(status, 409);
	assert.equal(body.error, "agenda_superseded");
	const [, stored] = await get();
	assert.deepEqual(stored, {
		...agenda("2026-01-06T15:00:00Z"),
		dismissed: [],
		confirmed: [],
	});
	assert.deepEqual(await get({ user: "alex" }), await get());
	assert.deepEqual(await get({ job: "agent", for_user: "blair" }), [200, null]);
	const stamp = await db.query(
		"select changed_by_job, changed_for_user_id from calendar_agenda",
	);
	assert.deepEqual(stamp.rows, [
		{ changed_by_job: "mail_capture", changed_for_user_id: alex },
	]);
});

test("dismissals converge, replay, survive replacement and belong to their partner", async () => {
	await put(agenda("2026-01-07T15:00:00Z"));
	const token = randomUUID();
	const first = await dismiss(key, token);
	assert.equal(first[0], 200);
	assert.deepEqual(await dismiss(), first);
	assert.deepEqual(await dismiss(key, token), [
		200,
		{ ...first[1], replayed: true },
	]);
	assert.equal((await dismiss("fedcba9876543210"))[0], 404);
	assert.equal((await dismiss(key, randomUUID(), { user: "blair" }))[0], 404);
	assert.equal(
		(await dismiss("fedcba9876543210", token))[1].error,
		"key_reuse",
	);
	await put({ ...agenda("2026-01-08T15:00:00Z"), follow_up_reviews: [] });
	assert.deepEqual(await dismiss(), first);
	assert.deepEqual((await get())[1].dismissed, []);
	assert.equal((await dismiss(key, randomUUID(), job))[0], 404);
});

test("agenda size counts JSON characters, including the exact limit", async () => {
	const item = { title: "" };
	const snapshot = {
		...agenda("2026-01-09T15:00:00Z"),
		items: [item],
	};
	item.title = "é".repeat(262144 - JSON.stringify(snapshot).length);
	assert.equal(JSON.stringify(snapshot).length, 262144);
	assert.equal((await put(snapshot))[0], 200);
	item.title += "x";
	assert.equal((await put(snapshot))[1].error, "agenda_too_large");
});

test("agenda refuses wrong authors, malformed input and unprovisioned callers", async () => {
	assert.equal((await put(agenda(), { user: "alex" }))[0], 404);
	assert.equal(
		(await put(agenda(), { job: "agent", for_user: "alex" }))[0],
		403,
	);
	assert.equal((await put(agenda(), { job: "mail_capture" }))[0], 403);
	assert.equal((await get({ job: "unknown", for_user: "alex" }))[0], 403);
	assert.equal((await get({ user: "nobody" }))[0], 422);
	assert.equal((await put({ ...agenda(), observed_at: "yesterday" }))[0], 400);
	assert.equal(
		(await put({ ...agenda(), follow_up_reviews: [{ key: "bad" }] }))[0],
		400,
	);
	assert.equal((await put({}))[0], 400);
});

test("one meeting per partner and review key is enforced and reported as confirmed", async () => {
	await put(agenda());
	await db.query(`begin; select set_config('engine.user_id', '${alex}', true);
		insert into activity (kind, happened_at, calendar_review_user_id, calendar_review_key)
		values ('meeting', now(), '${alex}', '${key}'); commit;`);
	const insert = async (kind: string, user: string, review: string | null) => {
		await db.query(
			`begin; select set_config('engine.user_id', '${alex}', true)`,
		);
		await db.query(
			`insert into activity (kind, happened_at, calendar_review_user_id, calendar_review_key)
			values ($1, now(), $2, $3)`,
			[kind, user, review],
		);
		await db.query("commit");
	};
	for (const args of [
		["meeting", alex, key],
		["note", blair, key],
		["meeting", blair, "bad"],
		["meeting", blair, null],
	] as const) {
		await assert.rejects(insert(args[0], args[1], args[2]));
		await db.query("rollback");
	}
	await insert("meeting", blair, key);
	assert.deepEqual((await get())[1].confirmed, [key]);
	await put(agenda(), { job: "mail_capture", for_user: "blair" });
	assert.deepEqual((await get({ user: "blair" }))[1].confirmed, [key]);
	assert.equal((await dismiss())[0], 200);
	const other = "fedcba9876543210";
	await insert("meeting", blair, other);
	await put({ ...agenda(), follow_up_reviews: [{ key: other }] });
	for (const caller of [job, { user: "alex" }]) {
		const [, stored] = await get(caller);
		assert.deepEqual(stored.confirmed, []);
		assert.deepEqual(stored.dismissed, []);
	}
	await put(agenda());
	const [, restored] = await get();
	assert.deepEqual(restored.dismissed, [key]);
	assert.deepEqual(restored.confirmed, [key]);
});
