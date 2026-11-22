import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-call-suggestions.sql");
const { db, setup, cleanup } = copyTest();
// Each row reads as one line, with a made-up id shown by its number.
const line = (row: pg.QueryResultRow) =>
	Object.values(row)
		.map((v) =>
			v === null
				? "-"
				: String(v).replace(/^00000000-0000-4000-8000-0*(\d{2,})$/, "#$1"),
		)
		.join(" ");
const rows = async (sql: string) => (await db.query(sql)).rows.map(line);
const run = async (): Promise<string[]> => {
	await db.query("begin");
	try {
		const results = await db.query(copy);
		assert.ok(Array.isArray(results));
		await db.query("commit");
		return (results.at(-1)?.rows ?? []).map(line);
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
};

const resolution = (status: string, actor = 1, ref?: number) =>
	status === "pending"
		? "'pending', null, null, null"
		: `'${status}', '${id(actor)}', ${ref ? `'${id(ref)}'` : "null"}, '2024-01-10'`;
const capture = (
	n: number,
	kind: string,
	payload: object,
	status = "pending",
	ref?: number,
	session = 60,
) =>
	`('${id(n)}', '${id(session)}', 'key-${n}', 'batch', ${n}, '${kind}', '${JSON.stringify(payload)}', 'Example quote', 0.9, ${resolution(status, 1, ref)}, '2024-01-01 15:01')`;
const postCall = (
	n: number,
	status = "pending",
	ref?: number,
	assignee = "partner_one",
	actor = 1,
) =>
	`('${id(n)}', '${id(60)}', 'key-${n}', 'batch', ${n}, 'assigned_action', '${id(30)}', '${assignee}', 'Example action ${n}',
  '2024-02-01', 'Example quote', 0.9, ${resolution(status, actor, ref)}, '2024-01-01 15:01')`;

before(async () => {
	await setup();
	// biome-ignore format: one fixture row per line
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User'),
  ('${id(2)}', 'partner_two', 'human', 'Example Other'), ('${id(3)}', 'quill-joe-mac', 'automation', 'Example Recorder'),
  ('${id(4)}', 'quill-joe-studio', 'automation', 'Example Studio Recorder');
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User');
 insert into app_user (id, slug) values ('${id(1)}', 'joe');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(1)}', '${id(1)}');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) values ('${id(11)}', 'person', 'Example Party', '${id(1)}', '${id(1)}');
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(20)}', '${id(11)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('loi', 'Example LOI');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by)
  select v, '${id(20)}', 'Example Deal', 'lease', 'loi', 'partner_one', '${id(1)}', '${id(1)}' from unnest(array['${id(30)}', '${id(31)}', '${id(32)}']::uuid[]) v;
 insert into phase values ('loi', 'Example LOI'), ('negotiation', 'Example negotiation'), ('dead', 'Example dead');
 insert into deal (id, name, owner_user_id) values ('${id(30)}', 'Example Deal', '${id(1)}'), ('${id(32)}', 'Another Deal', '${id(1)}');
 insert into outside_id (source, value, deal_id) values ('old_system', '${id(30)}', '${id(30)}'), ('old_system', '${id(32)}', '${id(32)}');
 insert into activity (id, kind, happened_at) values ('${id(60)}', 'call', '2024-01-01 15:00'), ('${id(61)}', 'call', '2024-01-01 15:00');
 insert into activity_about (activity_id, deal_id) values ('${id(60)}', '${id(30)}'), ('${id(61)}', '${id(30)}');
 insert into party (id, kind, name) values ('${id(11)}', 'person', 'Example Party');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(11)}', '${id(11)}');
 insert into activity_about (activity_id, party_id) values ('${id(60)}', '${id(11)}');
 insert into public.capture_session (id, nonce, device_id, actor_id, mode, started_at, consent_announced_at, session_token_hash,
  expires_at, state, state_at, post_call) values
  ('${id(60)}', 'nonce-60', 'quill-joe-mac', '${id(3)}', 'meeting', '2024-01-01 15:00', '2024-01-01 15:00', 'token-60', '2024-02-01', 'done', '2024-01-01 16:00', true),
  ('${id(61)}', 'nonce-61', 'quill-joe-studio', '${id(4)}', 'meeting', '2024-01-01 15:00', '2024-01-01 15:00', 'token-61', '2024-02-01', 'done', '2024-01-01 16:00', true);
 insert into public.event (id, occurred_at, actor_id, verb, subject_type, subject_id, field, new_value, cause)
  values ('${id(50)}', '2023-12-01', '${id(1)}', 'patch-deal-field', 'deal', '${id(30)}', 'phase', '{"phase": "loi"}', 'human_stated');
 insert into public.capture_post_call_candidate (id, session_id, idempotency_key, batch_hash, item_index, kind, deal_id, assignee_slug,
  action_description, due_on, evidence_quote, confidence, status, resolved_by, resulting_ref, resolved_at, created_at) values
  ${[postCall(71), postCall(72, "confirmed", 90), postCall(73, "confirmed", 90), postCall(74, "pending", undefined, "partner_two"), postCall(75, "skipped", undefined, "partner_one", 3)].join(",\n  ")};
 insert into public.capture_post_call_action (id, candidate_id, deal_id, owner_id, description, accepted_by, accepted_at)
  values ('${id(90)}', '${id(72)}', '${id(30)}', '${id(1)}', 'Example action 72', '${id(1)}', '2024-01-10');
 insert into next_step (id, what, deal_id) values ('${id(90)}', 'Example action 72', '${id(30)}');
 insert into public.capture_candidate (id, session_id, idempotency_key, batch_hash, item_index, kind, payload, evidence_quote, confidence,
  status, resolved_by, resulting_ref, resolved_at, created_at) values
  ${[
		capture(80, "next_step", { deal: id(30), text: " Example step ", next_date: null }, "skipped"),
		capture(81, "next_step", { deal: id(30), text: "Example taken", next_date: "2024-02-01" }, "confirmed", 92),
		capture(82, "phase_move", { deal: id(30), field: "phase", value: "negotiation", base_event_id: id(50), started_on: "2024-01-02" }),
		capture(83, "phase_move", { deal: id(30), field: "phase", value: "negotiation" }),
		capture(84, "next_step", { deal: id(31), text: "Example elsewhere", next_date: null }),
		capture(85, "new_deal", { name: "Example new" }),
		capture(86, "meeting_record", { ref: id(30), summary: "Example" }),
		capture(87, "next_step", { deal: id(30), text: "Example twice", next_date: null }),
		capture(88, "next_step", { deal: id(30), text: "Example twice", next_date: null }),
		capture(95, "activity", { ref: id(20), kind: "note", summary: "Example client call" }),
		capture(97, "activity", { ref: id(30), kind: "note", summary: "Example deal call" }, "pending", undefined, 61),
		capture(98, "activity", { ref: id(30), kind: "note", summary: "Example other call", occurred_at: "2024-01-01T14:00:00Z" }),
		capture(99, "activity", { ref: id(30), kind: "note", summary: "Example skipped call" }, "skipped"),
		capture(96, "next_step", { deal: id(32), text: "Example unrelated step" }),
	].join(",\n  ")};
 update public.capture_candidate set resolution_note = 'Example note' where id = '${id(80)}';
 commit;`);
});
after(cleanup);

test("proposal_due_source rejects invalid provenance and accepts dated next steps", async () => {
	for (const [kind, date, source] of [
		["next_step", "2024-02-01", "unknown"],
		["next_step", null, "stated"],
		["next_step", null, "defaulted"],
		["log_call", null, "stated"],
		["log_call", null, "defaulted"],
		["log_call", "2024-02-01", "stated"],
		["log_call", "2024-02-01", "defaulted"],
	]) {
		await db.query(
			"begin; select set_config('engine.job', 'old_system', true)",
		);
		try {
			await assert.rejects(
				db.query(
					`insert into proposal (kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, due_on, due_source)
				 values ($1, $2, 'call', 'Example quote', 'old_system', $3, 'Example provenance', $4, $5)`,
					[kind, id(60), id(30), date, source],
				),
				{ code: "23514", constraint: "proposal_due_source" },
			);
		} finally {
			await db.query("rollback");
		}
	}
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		for (const [kind, date, source] of [
			["next_step", "2024-02-01", "stated"],
			["next_step", "2024-02-01", "defaulted"],
			["next_step", "2024-02-01", null],
			["next_step", null, null],
			["log_call", null, null],
		]) {
			const result = await db.query(
				`insert into proposal (kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, due_on, due_source)
			 values ($1, $2, 'call', 'Example quote', 'old_system', $3, $4, $5, $6) returning due_source`,
				[
					kind,
					id(60),
					id(30),
					`Example provenance ${kind} ${date} ${source}`,
					date,
					source,
				],
			);
			assert.equal(result.rows[0].due_source, source);
		}
	} finally {
		await db.query("rollback");
	}
});

test("copies each call suggestion with its decision, keeps the next step an accepted one made, and on a rerun adds what arrived and lists what changed", async (t) => {
	const report = await run();
	// biome-ignore format: one row per line
	assert.deepEqual(await rows(`select id, kind, activity_id, activity_kind, evidence, proposed_by_job, status, decided_by_user_id, decided_at::text,
  deal_id, what, owner_party_id, due_on::text, from_phase, to_phase, changed_by_user_id, changed_by_job, changed_at::text from proposal where kind <> 'log_call' order by id`), [
		"#71 next_step #60 call Example quote old_system pending - - #30 Example action 71 #01 2024-02-01 - - - old_system 2024-01-01 15:01:00+00",
		"#80 next_step #60 call Example quote old_system dismissed #01 2024-01-10 00:00:00+00 #30 Example step - - - - #01 - 2024-01-10 00:00:00+00",
		"#82 phase_move #60 call Example quote old_system pending - - #30 - - - loi negotiation - old_system 2024-01-01 15:01:00+00",
		"#90 next_step #60 call Example quote old_system accepted #01 2024-01-10 00:00:00+00 #30 Example action 72 #01 2024-02-01 - - #01 - 2024-01-10 00:00:00+00",
	]);
	assert.deepEqual(
		await rows(`select id, kind, status, activity_id, deal_id, party_id, what, evidence, changed_for_user_id
			from proposal where kind = 'log_call' order by id`),
		[
			"#97 log_call pending #61 #30 - Example deal call Example quote #01",
			"#98 log_call pending #60 #30 - Example other call Example quote -",
		],
	);
	assert.deepEqual(await rows("select id from activity order by id"), [
		"#60",
		"#61",
	]);
	assert.deepEqual(
		await rows(
			`select changed_for_user_id from change where table_name = 'proposal' and record->>'id' = '${id(97)}'`,
		),
		["#01"],
	);
	assert.deepEqual(await rows("select id from next_step"), ["#90"]);
	assert.deepEqual(
		await rows(
			`select id, changed_for_user_id from proposal where status = 'pending' and kind <> 'log_call' order by id`,
		),
		["#71 -", "#82 #01"],
	);
	// biome-ignore format: one row per line
	assert.deepEqual(await rows(`select record ->> 'id' as id, action, new_value ->> 'status' as status, changed_by_user_id, changed_by_job,
  changed_at::text from change where table_name = 'proposal' order by record ->> 'id', changed_at`), [
		"#71 insert pending - old_system 2024-01-01 15:01:00+00",
		"#80 insert pending - old_system 2024-01-01 15:01:00+00",
		"#80 update dismissed #01 - 2024-01-10 00:00:00+00",
		"#82 insert pending - old_system 2024-01-01 15:01:00+00",
		"#90 insert pending - old_system 2024-01-01 15:01:00+00",
		"#90 update accepted #01 - 2024-01-10 00:00:00+00",
		"#97 insert pending - old_system 2024-01-01 15:01:00+00",
		"#98 insert pending - old_system 2024-01-01 15:01:00+00",
	]);
	assert.deepEqual(report, [
		"#73 resulting_ref #90 next_step_shared",
		"#74 assignee_slug partner_two assignee_not_a_user",
		"#75 resolved_by #03 decision_needs_user",
		"#80 resolution_note Example note note_has_no_place",
		"#81 resulting_ref #92 next_step_not_copied",
		"#82 started_on 2024-01-02 start_date_has_no_place",
		"#83 base_event_id - phase_before_call_unknown",
		"#84 deal #31 deal_not_copied",
		"#85 kind new_deal kind_has_no_suggestion",
		"#87 proposal #87 existing_proposal_conflicts",
		"#88 proposal #88 existing_proposal_conflicts",
		"#95 ref #20 target_not_copied",
		"#96 deal #32 call_not_about_deal",
		"#98 occurred_at 2024-01-01T14:00:00Z uses_recorded_call_time",
		"#99 kind activity kind_has_no_suggestion",
	]);
	assert.deepEqual(
		await rows(
			"select tgname from pg_trigger where tgrelid in ('next.proposal'::regclass, 'next.change'::regclass) and tgenabled <> 'O'",
		),
		[],
	);

	const all =
		"select (select jsonb_agg(p order by id) from proposal p) as proposals, (select jsonb_agg(c order by id) from change c) as history";
	const before = (await db.query(all)).rows;
	assert.deepEqual(await run(), report);
	assert.deepEqual((await db.query(all)).rows, before);

	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.next_action (id, subject_type, subject_id, owner_id, description, created_by, item_title, source_ref)
  values ('${id(93)}', 'deal', '${id(30)}', '${id(1)}', 'Example taken', '${id(1)}', 'Example taken', 'capture_candidate:${id(81)}');
 insert into next_step (id, what, deal_id) values ('${id(93)}', 'Example taken', '${id(30)}');
 update public.capture_post_call_candidate set action_description = 'Example changed' where id = '${id(71)}';
 update public.capture_candidate set status = 'skipped', resolved_by = '${id(1)}', resolved_at = '2024-01-11' where id = '${id(82)}';
 update public.capture_post_call_candidate set created_at = '2024-01-02' where id = '${id(72)}';
 insert into public.event (id, occurred_at, actor_id, verb, subject_type, subject_id, field, new_value, cause)
  values ('${id(51)}', '2023-12-02', '${id(1)}', 'patch-deal-field', 'deal', '${id(30)}', 'phase', '{"phase": "unmapped"}', 'human_stated');
 insert into public.capture_candidate (id, session_id, idempotency_key, batch_hash, item_index, kind, payload, evidence_quote, confidence,
  status, resolved_by, resulting_ref, resolved_at, created_at) values
  ${capture(89, "phase_move", { deal: id(30), field: "phase", value: "loi", base_event_id: id(51) })};
 commit;`);
	const later = await run();
	assert.ok(!later.some((r) => r.startsWith("#81 ")));
	assert.ok(later.includes("#71 proposal #71 existing_proposal_conflicts"));
	assert.ok(later.includes("#82 proposal #82 existing_proposal_conflicts"));
	assert.ok(later.includes("#72 proposal #90 existing_proposal_conflicts"));
	assert.ok(later.includes("#89 phase unmapped phase_before_call_unknown"));
	// biome-ignore format: one row per line
	assert.deepEqual(await rows(`select id, status, what, due_on::text from proposal where id not in ('${id(80)}', '${id(90)}') and kind <> 'log_call' order by id`), [
		"#71 pending Example action 71 2024-02-01",
		"#82 pending - -",
		"#93 accepted Example taken 2024-02-01",
	]);
	assert.deepEqual(
		await rows(`select created_at::text from proposal where id = '${id(90)}'`),
		["2024-01-01 15:01:00+00"],
	);
	assert.deepEqual(await rows("select count(*) from next_step"), ["2"]);

	{
		await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.capture_post_call_candidate (id, session_id, idempotency_key, batch_hash, item_index, kind, deal_id, assignee_slug,
  action_description, due_on, evidence_quote, confidence, status, resolved_by, resulting_ref, resolved_at, created_at) values
  ${[postCall(101), postCall(102), postCall(103), postCall(104), postCall(106)].join(",\n  ")};
 update public.capture_post_call_candidate set due_defaulted = false where id in ('${id(101)}', '${id(103)}');
 update public.capture_post_call_candidate set due_defaulted = true where id = '${id(102)}';
 update public.capture_post_call_candidate set due_on = null, due_defaulted = false where id = '${id(106)}';
 insert into public.capture_candidate (id, session_id, idempotency_key, batch_hash, item_index, kind, payload, evidence_quote, confidence,
  status, resolved_by, resulting_ref, resolved_at, created_at) values
  ${capture(105, "next_step", { deal: id(30), text: "Example dated step", next_date: "2024-02-01" })};
 insert into proposal (id, created_at, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, owner_party_id, due_on)
  values ('${id(103)}', '2024-01-01 15:01', 'next_step', '${id(60)}', 'call', 'Example quote', 'old_system',
   '${id(30)}', 'Example action 103', '${id(1)}', '2024-02-01');
 commit;`);
		const legacy = `select to_jsonb(p), (select jsonb_agg(c order by id) from change c
		where table_name = 'proposal' and record->>'id' = '${id(103)}') from proposal p where id = '${id(103)}'`;
		const earlier = (await db.query(legacy)).rows;
		assert.deepEqual(await run(), later);
		assert.deepEqual((await db.query(legacy)).rows, earlier);
		assert.deepEqual(
			await rows(
				`select id, due_on::text, due_source from proposal where id >= '${id(101)}' order by id`,
			),
			[
				"#101 2024-02-01 stated",
				"#102 2024-02-01 defaulted",
				"#103 2024-02-01 -",
				"#104 2024-02-01 -",
				"#105 2024-02-01 -",
				"#106 - -",
			],
		);
		const before = (await db.query(all)).rows;
		assert.deepEqual(await run(), later);
		assert.deepEqual((await db.query(all)).rows, before);
		await t.test(
			"reports changed due-date provenance and preserves copied proposals",
			async () => {
				await db.query(`update public.capture_post_call_candidate set due_defaulted = not due_defaulted
				where id in ('${id(101)}', '${id(102)}')`);
				assert.deepEqual(await run(), [
					...later,
					"#101 proposal #101 existing_proposal_conflicts",
					"#102 proposal #102 existing_proposal_conflicts",
				]);
				assert.deepEqual((await db.query(all)).rows, before);
			},
		);
	}
});
