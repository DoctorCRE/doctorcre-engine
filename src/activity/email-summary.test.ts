import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const partner = randomUUID();
const other = randomUUID();
const fresh = randomUUID();
const copied = randomUUID();
const unavailable = randomUUID();
const refused = randomUUID();
const oldSource = randomUUID();
const oldHash = `sha256:${"a".repeat(64)}`;
const copiedResult = {
	activity_id: copied,
	source_activity_id: oldSource,
	source_hash: oldHash,
	generator_version: "example.v1",
	status: "available",
	text: "The sender asks for the floor plan.",
	provenance: { model: "example-old-model" },
	recorded_at: "2026-01-02T00:00:00.123456+00:00",
};

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${partner}', 'person', 'Example Partner'), ('${other}', 'person', 'Other Partner');
		insert into app_user (id, slug) values ('${partner}', 'joe'), ('${other}', 'dell');
		insert into activity (id, kind, happened_at) values
			${[fresh, copied, unavailable, refused].map((id) => `('${id}', 'email', '2026-01-01')`).join(",")};
		insert into email (activity_id, message_id, sender, subject, body)
			select id, id || '@example.test', 'sender@example.test', 'Floor plan', 'Can you send the floor plan today?'
			from activity;
		insert into activity_about (activity_id, party_id) select id, '${partner}' from activity;
		insert into email_mailbox (activity_id, user_id) select id, '${partner}' from activity;
		insert into email_summary (activity_id, source_activity_id, source_hash, generator_version, status, text, provenance, recorded_at)
			select activity_id, source_activity_id, source_hash, generator_version, status, text, provenance, recorded_at
			from jsonb_populate_record(null::email_summary, '${JSON.stringify(copiedResult)}');
		commit;`);
});
after(cleanup);

const summary = (activity_id: string) => ({
	activity_id,
	source_hash: `sha256:${"b".repeat(64)}`,
	generator_version: "example.v2",
	status: "available",
	text: "The sender asks for the floor plan today.",
	provenance: { model: "example-model" },
	recorded_at: "2026-01-03T12:00:00.654321+00:00",
});
const caller = { job: "mail_capture", for_user: "joe" };
const path = "email-summaries";
const record = (body: object) => save(caller, path, body);
const results = async (
	table: "email_summary" | "email_current_summary",
	id: string,
) =>
	(
		await db.query(
			`select to_jsonb(s) as result from ${table} s where activity_id = $1 order by recorded_at`,
			[id],
		)
	).rows.map(({ result }) => result);

test("mail capture saves one current result and concurrent retries return the original answer", async () => {
	const request = summary(fresh);
	const expected = { ...request, source_activity_id: fresh };
	assert.deepEqual(await Promise.all([record(request), record(request)]), [
		[200, expected],
		[200, expected],
	]);
	assert.deepEqual(
		await record({ ...request, recorded_at: "2026-01-04T00:00:00Z" }),
		[200, expected],
	);
	const [status, body] = await record({
		...request,
		text: "The sender asks to reschedule.",
	});
	assert.equal(status, 409);
	assert.equal(body.error, "email_summary_result_conflict");
	assert.deepEqual(await results("email_summary", fresh), [expected]);
	const { status: _status, ...current } = expected;
	assert.deepEqual(await results("email_current_summary", fresh), [current]);
});

test("an unavailable result keeps no text and leaves the copied text current until a newer available result", async () => {
	const { status: _status, ...copiedCurrent } = copiedResult;
	const request = {
		...summary(copied),
		status: "unavailable",
		text: null,
		provenance: { reason: "empty_message" },
		recorded_at: "2026-01-04T00:00:00+00:00",
	};
	const saved = { ...request, source_activity_id: copied };
	assert.deepEqual(await record(request), [200, saved]);
	assert.deepEqual(await results("email_summary", copied), [
		copiedResult,
		saved,
	]);
	assert.deepEqual(await results("email_current_summary", copied), [
		copiedCurrent,
	]);
	const newer = { ...summary(copied), generator_version: "example.v3" };
	const { status: _available, ...newCurrent } = newer;
	assert.equal((await record(newer))[0], 200);
	assert.deepEqual(await results("email_summary", copied), [
		copiedResult,
		{ ...newer, source_activity_id: copied },
		saved,
	]);
	assert.deepEqual(await results("email_current_summary", copied), [
		{ ...newCurrent, source_activity_id: copied },
	]);
});

test("an email with only an unavailable result has no current summary", async () => {
	const request = {
		...summary(unavailable),
		status: "unavailable",
		text: null,
	};
	assert.equal((await record(request))[0], 200);
	assert.deepEqual(await results("email_current_summary", unavailable), []);
});

test("summary saves refuse the wrong job, mailbox, source, hash, and oversized text", async () => {
	const request = summary(refused);
	for (const [answer, status, error, detail] of [
		[await save({ user: "joe" }, path, request), 404, "not_found", undefined],
		[
			await save({ ...caller, job: "agent" }, path, request),
			403,
			"unknown_job",
			undefined,
		],
		[
			await save({ job: "mail_capture" }, path, request),
			403,
			"unknown_job",
			undefined,
		],
		[
			await save({ ...caller, for_user: "dell" }, path, request),
			404,
			"not_found",
			undefined,
		],
		[
			await record({ ...request, activity_id: randomUUID() }),
			404,
			"not_found",
			undefined,
		],
		[
			await record({ ...request, source_hash: "sha256:made-up" }),
			400,
			"invalid_field_value",
			["source_hash"],
		],
		[
			await record({ ...request, text: "x".repeat(301) }),
			422,
			"database_refused_the_statement",
			"email_summary_check",
		],
	] as const) {
		assert.equal(answer[0], status);
		assert.equal(answer[1].error, error);
		assert.deepEqual(answer[1].fields ?? answer[1].rule, detail);
	}
	assert.deepEqual(await results("email_summary", refused), []);
});
