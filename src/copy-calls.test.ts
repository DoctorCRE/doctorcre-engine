import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [activityCopy, copy] = await Promise.all([
	readSchema("copy-activity.sql"),
	readSchema("copy-calls.sql"),
]);
const { db, setup, cleanup } = copyTest();
const rows = async (sql: string) => (await db.query(sql)).rows;
const runCopy = async (sql: string): Promise<pg.QueryResultRow[]> => {
	await db.query("begin");
	try {
		const results = await db.query(sql);
		assert.ok(Array.isArray(results));
		await db.query("commit");
		return results.at(-1)?.rows ?? [];
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
};
const run = async () => {
	await runCopy(activityCopy);
	return runCopy(copy);
};
const reasons = (report: pg.QueryResultRow[]) =>
	report.map((r) => `${r.old_id.slice(-2)} ${r.field} ${r.value} ${r.reason}`);
const hash = (c: string) => c.repeat(64);

const session = (n: number, actor: number, postCall: boolean, state: string) =>
	`('${id(n)}', 'nonce-${n}', 'example-device', '${id(actor)}', 'meeting', '2024-01-0${n - 59} 15:00', '2024-01-0${n - 59} 15:00',
  'token-${n}', '2024-02-01', '${state}', '2024-01-0${n - 59} 16:00', '2024-01-0${n - 59} 15:01', ${postCall})`;
const candidate = (
	n: number,
	session: number,
	kind: string,
	payload: object,
	resolved?: number | "skipped",
) =>
	`('${id(n)}', '${id(session)}', 'key-${n}', 'batch', ${n}, '${kind}', '${JSON.stringify(payload)}', 'Example quote', 0.9, ${
		resolved === undefined
			? "'pending', null, null, null"
			: resolved === "skipped"
				? `'skipped', '${id(1)}', null, '2024-01-10'`
				: `'confirmed', '${id(1)}', '${id(resolved)}', '2024-01-10'`
	})`;

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User'),
  ('${id(2)}', 'example-device', 'automation', 'Example Recorder');
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User'), ('${id(11)}', 'person', 'Example Party');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) values ('${id(11)}', 'person', 'Example Party', '${id(1)}', '${id(1)}');
 insert into public.lead_stage (slug, label) values ('new', 'Example new');
 insert into public.lead (id, party_id, stage, created_by, updated_by) values ('${id(21)}', '${id(11)}', 'new', '${id(1)}', '${id(1)}');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(11)}', '${id(11)}');
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(20)}', '${id(11)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('loi', 'Example LOI');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by)
  select v, '${id(20)}', 'Example Deal', 'lease', 'loi', 'partner_one', '${id(1)}', '${id(1)}' from unnest(array['${id(30)}', '${id(31)}']::uuid[]) v;
 insert into deal (id, name, owner_user_id) values ('${id(30)}', 'Example Deal', '${id(1)}');
 insert into outside_id (source, value, deal_id) values ('old_system', '${id(30)}', '${id(30)}');
 insert into public.activity_kind (slug, label, is_contact) values ('meeting', 'meeting', true);
 insert into public.activity (id, kind, occurred_at, recorded_at, updated_at, actor_id, summary, deal_id) values
  ('${id(40)}', 'meeting', '2024-01-03', '2024-01-03', '2024-01-03', '${id(1)}', 'Example meeting', '${id(30)}'),
  ('${id(41)}', 'meeting', '2024-01-06', '2024-01-06', '2024-01-06', '${id(1)}', 'Example later meeting', '${id(31)}');
 insert into public.capture_session (id, nonce, device_id, actor_id, mode, started_at, consent_announced_at, session_token_hash,
  expires_at, state, state_at, created_at, post_call) values
  ${[
		session(60, 1, true, "done"),
		session(61, 2, true, "failed"),
		session(62, 2, false, "done"),
		session(63, 2, false, "done"),
		session(64, 2, false, "done"),
		session(65, 2, false, "done"),
	].join(",\n  ")};
 insert into public.phone_call_session (id, owner_id, sha256, byte_count, duration_seconds, mime_type, started_at, consent_announced_at, projection, studio_status)
  values ('${id(60)}', '${id(1)}', '${hash("a")}', 1000, 60, 'audio/mp4', '2024-01-01 15:00', '2024-01-01 15:00',
  '{"summary": " Example summary ", "decisions": ["Example decision", " "], "open_questions": ["Example question"]}',
  '{"state": "held_review", "reason": "open_review_questions", "open_questions": 1}');
 insert into public.capture_post_call_report (session_id, idempotency_key, report_sha256, candidate_count) values
  ('${id(60)}', 'report-60', '${hash("b")}', 1), ('${id(61)}', 'report-61', '${hash("c")}', 1);
 insert into public.capture_post_call_candidate (session_id, idempotency_key, batch_hash, item_index, kind, deal_id, assignee_slug,
  action_description, evidence_quote, confidence) values ('${id(60)}', 'key-70', 'batch', 0, 'assigned_action', '${id(30)}', 'partner_one', 'Example action', 'Example quote', 0.9);
 insert into public.capture_candidate (id, session_id, idempotency_key, batch_hash, item_index, kind, payload, evidence_quote, confidence,
  status, resolved_by, resulting_ref, resolved_at) values
  ${[
		candidate(71, 60, "activity", { ref: id(21), kind: "note" }),
		candidate(72, 61, "next_step", { deal: id(31) }),
		candidate(
			73,
			62,
			"meeting_record",
			{ ref: id(30), summary: "Example logged" },
			40,
		),
		candidate(77, 62, "activity", { ref: id(21) }),
		candidate(83, 62, "meeting_record", { ref: id(30), summary: "Example" }),
		candidate(84, 65, "meeting_record", { ref: id(30), detail: "Example" }, 48),
		candidate(74, 63, "phase_move", { deal: "Example Deal" }),
		candidate(75, 63, "phase_move", { deal: id(30) }),
		candidate(
			76,
			63,
			"meeting_record",
			{ ref: id(30), summary: "Example record", detail: "Example detail" },
			49,
		),
		candidate(78, 64, "meeting_record", { ref: id(30), summary: "Example" }),
		candidate(79, 64, "meeting_record", { ref: id(30), detail: "Example" }),
		candidate(
			80,
			64,
			"meeting_record",
			{ ref: id(30), summary: "Example" },
			"skipped",
		),
		candidate(81, 65, "meeting_record", { ref: id(31) }, 41),
		candidate(82, 65, "phase_move", { deal: id(30) }),
	].join(",\n  ")};
 commit;`);
});
after(cleanup);

test("copies each call and meeting capture with its report, once, about the records its suggestions name", async () => {
	const report = await run();
	assert.deepEqual(
		(
			await rows(
				"select id, kind, happened_at::text, summary, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at::text from activity order by id",
			)
		).map(Object.values),
		[
			[
				id(40),
				"meeting",
				"2024-01-03 00:00:00+00",
				"Example meeting",
				id(1),
				null,
				null,
				"2024-01-03 00:00:00+00",
			],
			[
				id(60),
				"call",
				"2024-01-01 15:00:00+00",
				"Example summary\n\nDecisions:\n- Example decision\n\nOpen questions:\n- Example question",
				id(1),
				null,
				null,
				"2024-01-01 16:00:00+00",
			],
			[
				id(63),
				"meeting",
				"2024-01-04 15:00:00+00",
				"Example record\n\nExample detail",
				null,
				"old_system",
				null,
				"2024-01-04 16:00:00+00",
			],
			[
				id(64),
				"meeting",
				"2024-01-05 15:00:00+00",
				null,
				null,
				"old_system",
				null,
				"2024-01-05 16:00:00+00",
			],
		],
	);
	assert.deepEqual(
		(
			await rows(
				"select activity_id, deal_id, party_id, created_at::text from activity_about order by activity_id, deal_id, party_id",
			)
		).map(Object.values),
		[
			[id(40), id(30), null, "2024-01-03 00:00:00+00"],
			[id(40), null, id(11), "2024-01-03 15:01:00+00"],
			[id(60), id(30), null, "2024-01-01 15:01:00+00"],
			[id(60), null, id(11), "2024-01-01 15:01:00+00"],
			[id(63), id(30), null, "2024-01-04 15:01:00+00"],
			[id(64), id(30), null, "2024-01-05 15:01:00+00"],
		],
	);
	assert.deepEqual(reasons(report), [
		`60 recording ${hash("a")} recording_not_copied`,
		"60 review_state held_review review_state_has_no_place",
		`61 activity ${id(61)} about_nothing_copied`,
		`61 deal ${id(31)} deal_not_copied`,
		`61 report_sha256 ${hash("c")} report_text_not_stored`,
		"61 state failed capture_unfinished",
		`62 meeting_record ${id(83)} meeting_record_not_copied`,
		`63 deal Example Deal deal_not_copied`,
		`64 meeting_record ${id(78)} several_meeting_records`,
		`64 meeting_record ${id(79)} several_meeting_records`,
		`64 meeting_record ${id(80)} meeting_record_skipped`,
		`65 activity ${id(41)} source_activity_not_copied`,
		`65 meeting_record ${id(84)} meeting_record_not_copied`,
		`65 ref ${id(31)} ref_not_copied`,
	]);
	assert.deepEqual(
		await rows(
			"select tgname from pg_trigger where tgrelid in ('next.activity'::regclass, 'next.activity_about'::regclass) and tgenabled <> 'O'",
		),
		[],
	);

	const history = await rows(
		"select jsonb_agg(c order by id) as all from change c",
	);
	assert.deepEqual(await run(), report);
	assert.deepEqual(
		await rows("select jsonb_agg(c order by id) as all from change c"),
		history,
	);
});

test("a call about a record copied later, and a logged meeting copied later, arrive on the next run", async () => {
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into deal (id, name, owner_user_id) values ('${id(31)}', 'Example Deal', '${id(1)}');
 insert into outside_id (source, value, deal_id) values ('old_system', '${id(31)}', '${id(31)}');
 commit;`);
	const report = await run();
	assert.ok(
		!reasons(report).some((r) => /about_nothing|source_activity/.test(r)),
	);
	assert.deepEqual(
		(
			await rows(
				`select deal_id from activity_about where activity_id = '${id(41)}' order by deal_id`,
			)
		).map((r) => r.deal_id),
		[id(30), id(31)],
	);
	assert.deepEqual(
		(
			await rows(
				`select a.kind, a.changed_by_job, b.deal_id from activity a join activity_about b on b.activity_id = a.id where a.id = '${id(61)}'`,
			)
		).map(Object.values),
		[["call", "old_system", id(31)]],
	);
});
