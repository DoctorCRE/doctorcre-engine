import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-meeting-suggestions.sql");
const { db, setup, cleanup } = copyTest();
// Each row reads as one line, with a made-up id shown by its number.
const line = (row: pg.QueryResultRow) =>
	Object.values(row)
		.map((v) =>
			v === null ? "-" : String(v).replace(/^0{8}-0{4}-4000-8000-0*/, "#"),
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

// Action n of a meeting: its head, decided at its current revision by the decider, and dispatched under key 200 + n.
const head = (n: number, state: string, decider = 1, meeting = 50) =>
	state === "proposed"
		? `('${id(meeting)}', ${n}, 'proposed', 1, null, null, null, null, null, null)`
		: `('${id(meeting)}', ${n}, '${state}', 1, 1, '${id(decider)}', '2024-01-10', ${state === "declined" ? "null, null, null" : `'${state === "delegated" ? "delegate" : "execute"}', '${id(state === "delegated" ? 2 : decider)}', '${id(200 + n)}'`})`;
const revision = (n: number, command: object | null, meeting = 50, at = n) =>
	`('${id(100 + n)}', '${id(meeting)}', ${n}, 1, 'Example summary ${n}', ${command ? `'${JSON.stringify(command)}'` : "null"},
  'tentative_discussion', 'participant', '${id(1)}', '2024-01-01 15:00'::timestamptz + interval '${at} minutes')`;
const request = (n: number, decision = "accept", actor = 1) =>
	`('${id(300 + n)}', '${JSON.stringify({ meeting_id: id(50), action_number: n, decision, base_revision: 1, disposition: null, assignee_slug: null, actor_id: id(actor) })}')`;
const step = (description: string, ref = id(30), owner?: string) => ({
	verb: "set-next-action",
	args: { ref, description, due_on: "2024-02-01", ...(owner && { owner }) },
});

before(async () => {
	await setup();
	// biome-ignore format: one fixture row per line
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User'),
  ('${id(2)}', 'partner_two', 'human', 'Example Other'), ('${id(3)}', 'claude', 'automation', 'Example Agent');
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User'), ('${id(14)}', 'person', 'Example Prospect');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) values ('${id(11)}', 'person', 'Example Party', '${id(1)}', '${id(1)}');
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(20)}', '${id(11)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('loi', 'Example LOI');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by)
  values ('${id(30)}', '${id(20)}', 'Example Deal', 'lease', 'loi', 'partner_one', '${id(1)}', '${id(1)}');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}');
 insert into deal (id, name, owner_user_id) values ('${id(30)}', 'Example Deal', '${id(1)}');
 insert into outside_id (source, value, party_id, deal_id) values ('old_system', '${id(1)}', '${id(1)}', null),
  ('old_system', '${id(21)}', '${id(14)}', null), ('old_system', '${id(30)}', null, '${id(30)}');
 insert into activity (id, kind, happened_at) values ('${id(60)}', 'meeting', '2024-01-01 15:00');
 insert into imported_change (id, table_name, record, field, source_event, old_value_absent, new_value_absent, changed_by_job, changed_at)
  values ('${id(50)}', 'activity', '{"id": "${id(60)}"}', 'summary', '{"id": "${id(50)}", "verb": "import-meeting-edit", "cause": "old_system_import",
  "actor_id": "${id(1)}", "source_table": "ops.meeting"}', true, false, 'old_system', '2024-01-01 15:00');
 insert into imported_change (id, table_name, record, field, source_event, old_value_absent, new_value_absent, changed_by_job, changed_at)
  values ('${id(115)}', 'activity', '{"id": "${id(60)}"}', 'summary', '{"id": "${id(115)}", "verb": "import-meeting-edit", "cause": "old_system_import",
  "actor_id": "${id(1)}", "source_table": "ops.meeting_note"}', false, false, 'old_system', '2024-01-01 16:00'),
  ('${id(123)}', 'proposal', '{"id": "${id(123)}"}', 'evidence', '{"id": "${id(123)}", "verb": "import-meeting-action-revision",
  "cause": "old_system_import", "actor_id": "${id(1)}"}', true, false, 'old_system', '2024-01-01 16:00');
 insert into next_step (id, what, deal_id) values ('${id(90)}', 'Example made', '${id(30)}');
 create table ops.meeting_action (meeting_id uuid, action_number integer, state text not null, current_revision integer not null,
  decided_revision integer, decided_by_actor uuid, decided_at timestamptz, disposition text, assignee_actor uuid, operation_key uuid,
  primary key (meeting_id, action_number));
 create table ops.meeting_action_revision (id uuid primary key, meeting_id uuid not null, action_number integer not null, revision integer not null,
  summary text not null, command jsonb, basis text not null, source text not null, proposed_by_actor uuid not null, created_at timestamptz not null);
 create table ops.meeting_action_decision_request (idempotency_key uuid primary key, request jsonb not null);
 insert into ops.meeting_action values ${[
		head(1, "proposed"), head(2, "delegated"), head(3, "accepted"), head(4, "declined"), head(5, "executed"),
		head(6, "proposed"), head(7, "proposed"), head(8, "proposed"), head(9, "proposed", 1, 51), head(10, "proposed"),
		head(11, "declined", 2), head(12, "proposed"), head(13, "proposed"), head(14, "proposed"), head(15, "proposed"), head(16, "proposed"), head(17, "proposed"), head(18, "proposed"), head(19, "proposed"),
		head(20, "proposed"), head(21, "proposed"), head(22, "accepted"), head(23, "proposed"), head(24, "proposed"),
	].join(", ")};
 insert into ops.meeting_action_revision values ${[
		revision(1, step("Example first")),
		revision(2, { verb: "set-next-step", args: { deal: id(30), text: "Example made", next_date: null, base_version: 1 } }),
		revision(3, step("Example dispatched")), revision(4, step("Example declined")), revision(5, step("Example instructed")),
		revision(6, null), revision(7, { verb: "update-deal", args: { ref: id(30) } }), revision(8, step("Example elsewhere", id(31))),
		revision(9, step("Example uncopied meeting"), 51), revision(10, step("Example prospect", id(21))),
		revision(11, step("Example other decider")), revision(12, step("Example other owner", id(30), "partner_two")),
		revision(13, { verb: "set-next-step", args: { deal: id(30), text: "\tExample step text\n", description: "Example ignored", due_on: "2024-05-01", base_version: 1 } }),
		revision(14, { verb: "set-next-action", args: { ref: id(30), text: "Example wrong argument" } }), revision(15, step("Example taken id")),
		revision(16, { verb: "set-next-step", args: { deal: id(30), text: 42, base_version: 1 } }),
		revision(17, { verb: "set-next-step", args: { deal: id(30), text: "Example numeric date", next_date: 20240201, base_version: 1 } }),
		revision(18, { verb: "set-next-action", args: { ref: id(30), description: "Example local date", due_on: "02/03/2024" } }),
		revision(19, { verb: "set-next-step", args: { deal: id(30), text: "Example unversioned" } }),
		revision(20, { verb: "set-next-action", args: { ref: id(30), description: "Example conditional", expected_action: null } }),
		revision(21, { verb: "set-next-step", args: { deal: id(30), text: "\u00a0\ufeff", base_version: 1 } }),
		revision(22, step("Example malformed receipt")), revision(23, step("Example held history")),
		revision(24, { verb: "set-next-step", args: { deal: id(30), text: "Example stale", base_version: 2 } }),
	].join(",\n  ")};
 insert into ops.meeting_action_revision values ('${id(130)}', '${id(50)}', 1, 2, 'Example summary revised', '${JSON.stringify(step("Example revised", id(30), "partner_one"))}',
  'explicit_instruction', 'processing', '${id(3)}', '2024-01-02');
 update ops.meeting_action set current_revision = 2 where action_number = 1;
 insert into ops.meeting_action_decision_request values ${[request(2), request(3), request(4, "decline"), request(11, "decline", 2), request(22)].join(", ")};
 insert into public.event (id, occurred_at, actor_id, verb, subject_type, subject_id, field, new_value, cause, idempotency_key)
  values ('${id(400)}', '2024-01-10', '${id(1)}', 'set-next-step', 'deal', '${id(30)}', 'next_step', '{"next_action_id": "${id(90)}"}', 'human_stated', '${id(202)}');
 insert into public.tool_call (idempotency_key, verb, actor_id, request_hash, response)
  values ('${id(203)}', 'set-next-action', '${id(1)}', 'hash', '{"next_action_id": "${id(91)}"}'),
  ('${id(222)}', 'set-next-action', '${id(1)}', 'hash', '{"next_action_id": "not-a-uuid"}');
 commit;`);
});
after(cleanup);

test("copies each meeting suggestion with its decision and revisions, keeps the step an accepted one made, and lists the rest", async () => {
	const report = await run();
	// biome-ignore format: one row per line
	assert.deepEqual(await rows(`select id, kind, activity_id, activity_kind, evidence, proposed_by_job, status, decided_by_user_id, decided_at::text,
  deal_id, what, owner_party_id, due_on::text, changed_by_user_id, changed_by_job, created_at::text from proposal order by id`), [
		"#90 next_step #60 meeting Example summary 2 old_system accepted #1 2024-01-10 00:00:00+00 #30 Example made - - #1 - 2024-01-01 15:02:00+00",
		"#101 next_step #60 meeting Example summary revised old_system pending - - #30 Example revised #1 2024-02-01 - old_system 2024-01-02 00:00:00+00",
		"#104 next_step #60 meeting Example summary 4 old_system dismissed #1 2024-01-10 00:00:00+00 #30 Example declined - 2024-02-01 #1 - 2024-01-01 15:04:00+00",
		"#113 next_step #60 meeting Example summary 13 old_system pending - - #30 Example step text - - - old_system 2024-01-01 15:13:00+00",
	]);
	assert.deepEqual(await rows("select id from next_step"), ["#90"]);
	// biome-ignore format: one row per line
	assert.deepEqual(await rows(`select record ->> 'id' as id, action, new_value ->> 'status' as status, changed_by_user_id, changed_by_job, changed_at::text
  from change where table_name = 'proposal' order by record ->> 'id', changed_at`), [
		"#90 insert pending - old_system 2024-01-01 15:02:00+00",
		"#90 update accepted #1 - 2024-01-10 00:00:00+00",
		"#101 insert pending - old_system 2024-01-02 00:00:00+00",
		"#104 insert pending - old_system 2024-01-01 15:04:00+00",
		"#104 update dismissed #1 - 2024-01-10 00:00:00+00",
		"#113 insert pending - old_system 2024-01-01 15:13:00+00",
	]);
	// biome-ignore format: one row per line
	assert.deepEqual(await rows(`select id, record ->> 'id' as proposal, source_event #>> '{old_value,evidence}' as before, source_event #>> '{new_value,evidence}' as after,
  source_event #>> '{command,args,description}' as what, source_event ->> 'basis' as basis, changed_by_user_id, changed_by_job, changed_at::text
  from imported_change where table_name = 'proposal' and id <> '${id(123)}' order by record ->> 'id', changed_at`), [
		"#102 #90 - Example summary 2 - tentative_discussion #1 - 2024-01-01 15:02:00+00",
		"#101 #101 - Example summary 1 Example first tentative_discussion #1 - 2024-01-01 15:01:00+00",
		"#130 #101 Example summary 1 Example summary revised Example revised explicit_instruction - agent 2024-01-02 00:00:00+00",
		"#104 #104 - Example summary 4 Example declined tentative_discussion #1 - 2024-01-01 15:04:00+00",
		"#113 #113 - Example summary 13 Example ignored tentative_discussion #1 - 2024-01-01 15:13:00+00",
	]);
	assert.deepEqual(report, [
		"#102 assignee_actor #2 delegation_has_no_place",
		"#103 operation_key #91 next_step_not_copied",
		"#105 decided_revision 1 decision_not_requested",
		"#105 operation_key - next_step_not_copied",
		"#106 command - kind_has_no_suggestion",
		"#107 command update-deal kind_has_no_suggestion",
		"#108 ref #31 record_not_copied",
		"#109 meeting_id #51 meeting_not_copied",
		"#110 ref #21 meeting_not_about_record",
		"#111 decided_by_actor #2 decision_needs_user",
		"#112 owner partner_two owner_not_a_user",
		"#114 description - blank_next_step",
		"#115 revision #115 existing_history_conflicts",
		"#116 text - blank_next_step",
		"#117 next_date 20240201 invalid_due_date",
		"#118 due_on 02/03/2024 invalid_due_date",
		"#119 base_version - base_version_invalid",
		"#120 expected_action - condition_has_no_place",
		"#121 text  blank_next_step",
		"#122 operation_key - next_step_not_copied",
		"#123 revision #123 existing_history_conflicts",
		"#124 base_version 2 deal_changed_since_proposal",
		"#130 changed_for_user_id - agent_user_unknown",
	]);
	assert.deepEqual(
		await rows(
			"select tgname from pg_trigger where tgrelid in ('next.proposal'::regclass, 'next.change'::regclass, 'next.imported_change'::regclass) and tgenabled <> 'O'",
		),
		[],
	);

	const all =
		"select (select jsonb_agg(p order by id) from proposal p), (select jsonb_agg(c order by id) from change c), (select jsonb_agg(i order by id) from imported_change i)";
	const before = await rows(all);
	assert.deepEqual(await run(), report);
	assert.deepEqual(await rows(all), before);

	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into next_step (id, what, deal_id) values ('${id(91)}', 'Example dispatched', '${id(30)}');
 insert into ops.meeting_action_revision values ('${id(131)}', '${id(50)}', 1, 3, 'Example summary later', '${JSON.stringify(step("Example later"))}', 'tentative_discussion', 'participant', '${id(1)}', '2024-01-03');
 update ops.meeting_action set current_revision = 3 where action_number = 1;
 commit;`);
	const later = await run();
	assert.ok(!later.some((r) => r.startsWith("#103 ")));
	assert.ok(later.includes("#131 proposal #101 existing_proposal_conflicts"));
	assert.deepEqual(
		await rows(
			`select id, status, what from proposal where id in ('${id(91)}', '${id(101)}') order by id`,
		),
		["#91 accepted Example dispatched", "#101 pending Example revised"],
	);
	assert.deepEqual(await rows("select count(*) from next_step"), ["2"]);
});
