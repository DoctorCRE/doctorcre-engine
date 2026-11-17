import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sql = (file: string) =>
	readFile(new URL(`../schema/${file}`, import.meta.url), "utf8");
const schema = await sql("next.sql");
const attribution = await sql("copy-attribution.sql");
const copy = await sql("copy-deal-next-steps.sql");
const name = `copy_steps_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (text: string) => (await db.query(text)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	const result = await db.query(copy);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const reasons = (report: pg.QueryResultRow[], n: number) =>
	report.filter((r) => r.old_id === id(n)).map((r) => r.reason);
let report: pg.QueryResultRow[];
const copyOnce = async () => {
	await db.query("begin");
	try {
		const result = await run();
		await db.query("commit");
		return result;
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
};
before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User');
 insert into app_user (id) values ('${id(1)}');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(1)}', '${id(1)}');
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User'),
 ('${id(2)}', 'claude', 'automation', 'Example Agent');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) values ('${id(6)}', 'org', 'Example Client', '${id(1)}', '${id(1)}');
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(3)}', '${id(6)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('closed', 'Example closed');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, next_date, created_by, updated_by)
 select v, '${id(3)}', 'Example deal', 'lease', 'closed', 'partner_one', '2026-03-01', '${id(1)}', '${id(1)}'
 from unnest(array[${Array.from({ length: 9 }, (_, i) => `'${id(10 + i)}'::uuid`).join(",")}]) v;
 insert into deal (id, name, owner_user_id) select id, name, '${id(1)}' from public.deal where id <> '${id(17)}';
 insert into outside_id (source, value, deal_id) select 'old_system', id::text, id from deal;
 insert into public.next_action (id, subject_type, subject_id, owner_id, description, status, due_on, created_at, updated_at, created_by) values
 ${[
		[100, 10, 1, "Example open", "open", "'2026-02-01'"],
		[101, 10, 1, "Example done", "done", "null"],
		[102, 10, 2, "Example dropped", "dropped", "null"],
		[103, 10, 1, "Example expired", "expired", "null"],
		[107, 10, 1, "Example expired alongside", "expired", "null"],
		[112, 10, 1, "Example dropped twice", "dropped", "null"],
		[113, 10, 1, "Example changed after drop", "dropped", "null"],
		[104, 15, 1, "  ", "open", "null"],
		[105, 17, 1, "Example missing deal", "open", "null"],
		[106, 10, 2, "Example unknown owner", "open", "null"],
		[108, 13, 1, "Example completed plan", "done", "null"],
		[109, 16, 1, "Example checklist", "open", "null"],
		[110, 11, 1, "Example earlier completed plan", "done", "null"],
		[111, 14, 1, "Example pending assessment", "open", "null"],
 ]
		.map(
			([n, d, o, text, status, due]) =>
				`('${id(Number(n))}', 'deal', '${id(Number(d))}', '${id(Number(o))}', '${text}', '${status}', ${due}, '2025-01-01', '${n === 110 ? "2025-01-01" : "2025-02-01"}', '${id(1)}')`,
		)
		.join(",")};
 update public.next_action set hold_until='2026-04-01', source_ref='example:source', item_title='Example display', item_bullets='["Example bullet"]' where id='${id(100)}';
 update public.next_action set item_title='Example checklist', source_ref='example:checklist' where id='${id(109)}';
 update public.next_action set created_by='${id(2)}' where id='${id(106)}';
 insert into party (id, kind, name) values ('${id(61)}', 'company', 'Example Vendor');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(60)}', '${id(61)}'), ('old_system', '${id(62)}', '${id(61)}');
 insert into public.next_action (id, subject_type, subject_id, owner_id, description, status, due_on, hold_until, created_at, updated_at, created_by) values
 ${[
		[120, 60, "Example vendor open", "open", "'2026-05-01'", "null"],
		[121, 60, "Example vendor done", "done", "null", "null"],
		[122, 60, "Example vendor dropped", "dropped", "null", "null"],
		[123, 60, "Example vendor expired", "expired", "null", "null"],
		[124, 62, "Example merged vendor hold", "open", "null", "'2026-06-01'"],
		[125, 63, "Example uncopied vendor", "open", "null", "null"],
 ]
		.map(
			([n, v, text, status, due, hold]) =>
				`('${id(Number(n))}', 'vendor', '${id(Number(v))}', '${id(1)}', '${text}', '${status}', ${due}, ${hold}, '2025-01-01', '2025-02-01', '${id(1)}')`,
		)
		.join(",")};
 insert into public.deal_note (id, deal_id, kind, text, actor_id, created_at) values
 ('${id(200)}','${id(11)}','next_step','Example old note','${id(1)}','2025-01-01'),
 ('${id(201)}','${id(11)}','next_step','Example current note','${id(2)}','2025-02-01'),
 ('${id(202)}','${id(12)}','next_step','Example superseded','${id(1)}','2025-01-01'),
 ('${id(203)}','${id(10)}','next_step','Example hidden note','${id(1)}','2025-01-01'),
 ('${id(204)}','${id(14)}','next_step','Example undated note','${id(1)}','2025-01-01'),
 ('${id(205)}','${id(11)}','note','Example ordinary note','${id(1)}','2025-01-01'),
 ('${id(206)}','${id(13)}','next_step','Example finished plan note','${id(1)}','2025-01-01'),
 ('${id(207)}','${id(16)}','next_step','Example alongside checklist','${id(1)}','2025-01-01');
 insert into public.event (subject_type,subject_id,field,new_value,actor_id,verb,cause,occurred_at) values
 ('deal','${id(14)}','overdue_assessment_pending','{"candidate_kind":"next_step","actions":[{"id":"${id(111)}","source":"next_action"}]}','${id(1)}','example-assessment','human_stated','2025-01-01');
 update public.deal set next_date=null where id='${id(14)}';
 update public.deal set next_date='2026-02-01' where id='${id(10)}';
 insert into public.event (subject_type, subject_id, field, new_value, occurred_at, recorded_at, actor_id, verb, cause, sponsoring_human_slug) values
 ('deal','${id(12)}','next_step','{"superseded_action_ids":[]}', '2025-02-01','2025-02-01','${id(1)}','replace-step','human_stated',null),
 ('deal','${id(11)}','next_step','{"next_step":"Example current note"}', '2025-01-31 23:59:59','2025-02-01 00:00:01','${id(2)}','set-next-step','automation_job','partner_one');
 insert into public.activity_kind (slug, label, is_contact) values ('task','Example task',false);
 insert into public.activity (id, kind, occurred_at, recorded_at, actor_id, summary, detail, deal_id, party_id) values
 ('${id(300)}','task','2025-01-01','2025-02-01','${id(2)}','Example task','Example details','${id(10)}',null),
 ('${id(301)}','task','2025-01-01','2025-02-01','${id(1)}','Example ambiguous',null,'${id(10)}',null),
 ('${id(302)}','task','2025-01-01','2025-02-01','${id(1)}','Example unlinked',null,null,null),
 ('${id(303)}','task','2025-01-01','2025-02-01','${id(1)}','Example structured','{"example":true}','${id(10)}',null),
 ('${id(304)}','task','2025-01-01','2025-02-01','${id(1)}','Example party task',null,null,'${id(6)}');
 update public.activity set client_id='${id(3)}' where id='${id(301)}';
 insert into public.capture_session (id,nonce,device_id,actor_id,mode,started_at,consent_announced_at,session_token_hash,expires_at,state_at)
 values ('${id(400)}','example-nonce','example-device','${id(1)}','meeting','2025-01-01','2025-01-01','example-hash','2025-01-02','2025-01-01');
 insert into public.capture_post_call_candidate (id,session_id,idempotency_key,batch_hash,item_index,kind,deal_id,assignee_slug,action_description,evidence_quote,confidence)
 select v,'${id(400)}',v::text,'example-batch', row_number() over () - 1,'assigned_action','${id(10)}','partner_one','Example post-call action','Example evidence',1
 from unnest(array['${id(401)}','${id(402)}','${id(403)}','${id(404)}']::uuid[]) v;
 insert into public.capture_post_call_action (id,candidate_id,deal_id,owner_id,description,accepted_by,accepted_at,status,due_on,completed_at,updated_at) values
 ('${id(501)}','${id(401)}','${id(10)}','${id(1)}','Example post-call open','${id(1)}','2025-01-01','open',null,null,'2025-02-01'),
 ('${id(502)}','${id(402)}','${id(10)}','${id(1)}','Example post-call done','${id(1)}','2025-01-01','done','2025-02-01','2025-02-02','2025-02-03'),
 ('${id(503)}','${id(403)}','${id(10)}','${id(1)}','Example post-call dropped','${id(1)}','2025-01-01','dropped',null,null,'2025-02-01'),
 ('${id(504)}','${id(404)}','${id(17)}','${id(2)}','Example post-call missing deal','${id(1)}','2025-01-01','open',null,null,'2025-02-01');
 insert into public.event (subject_type,subject_id,new_value,actor_id,verb,cause,sponsoring_human_slug,occurred_at) values
 ('deal','${id(10)}','{"next_action_id":"${id(501)}"}','${id(2)}','resolve-post-call-candidate','automation_job','partner_one','2025-01-01'),
 ('deal','${id(10)}','{"completed_post_call_action_ids":["${id(502)}"]}','${id(2)}','log-outreach','automation_job','partner_one','2025-02-02');
 update public.next_action set version=2 where id in ('${id(112)}','${id(113)}');
 insert into public.event (id,subject_type,subject_id,field,new_value,human_quote,actor_id,verb,cause,occurred_at) values
 ('${id(600)}','deal','${id(10)}','status','{"next_action_id":"${id(101)}","status":"done","version":2}',null,'${id(1)}','complete-one-action','human_stated','2025-01-15'),
 ('${id(601)}','deal','${id(10)}','status','{"next_action_id":"${id(102)}","status":"dropped","version":1,"reason":"Example no longer needed"}','Example no longer needed','${id(1)}','drop-action','human_stated','2025-01-20'),
 ('${id(602)}','clear_the_deck','${id(602)}',null,'{"kind":"next_action","action":"drop","rows":[{"id":"${id(103)}","status":"open"},{"id":"${id(107)}","status":"open"},{"id":"${id(123)}","status":"open"}]}',null,'${id(1)}','clear-the-deck-apply','human_stated','2025-01-25'),
 ('${id(603)}','clear_the_deck','${id(603)}',null,'{"kind":"next_action","action":"keep","rows":[{"id":"${id(123)}","status":"expired"}]}',null,'${id(1)}','clear-the-deck-apply','human_stated','2025-01-26'),
 ('${id(604)}','vendor','${id(60)}','status','{"next_action_id":"${id(121)}","status":"done","version":2}',null,'${id(1)}','complete-one-action','human_stated','2025-01-15'),
 ('${id(605)}','vendor','${id(60)}','status','{"action_id":"${id(121)}","status":"open","completion_event_id":"${id(604)}"}',null,'${id(1)}','reopen-one-action','human_stated','2025-01-16'),
 ('${id(606)}','deal','${id(10)}','status','{"next_action_id":"${id(112)}","status":"dropped","version":1,"reason":"Example first"}','Example first','${id(1)}','drop-action','human_stated','2025-01-20'),
 ('${id(607)}','deal','${id(10)}','status','{"next_action_id":"${id(112)}","status":"dropped","version":2,"reason":"Example second"}','Example second','${id(1)}','drop-action','human_stated','2025-01-21'),
 ('${id(608)}','deal','${id(10)}','status','{"next_action_id":"${id(113)}","status":"dropped","version":1,"reason":"Example stale"}','Example stale','${id(1)}','drop-action','human_stated','2025-01-20'),
 ('${id(609)}','deal','${id(13)}','deal_item','{"item_id":"${id(108)}","status":"done"}',null,'${id(1)}','complete-deal-item','human_stated','2025-01-18');
 commit;`);
	await db.query(`begin; ${await sql("copy-activity.sql")}; commit`);
	report = await copyOnce();
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("actions keep their own due dates and done time, never the deal date", async () => {
	// biome-ignore format: one row per source action
	assert.deepEqual((await rows(`select id, due_on::text, done_at::text, owner_party_id, created_at::text from next_step where id in ('${id(100)}','${id(101)}','${id(106)}') order by id`)).map(Object.values), [
 [id(100), "2026-02-01", null, id(1), "2025-01-01 00:00:00+00"],
 [id(101), null, "2025-01-15 00:00:00+00", id(1), "2025-01-01 00:00:00+00"],
 [id(106), null, null, null, "2025-01-01 00:00:00+00"],
 ]);
	assert.deepEqual(
		await rows(
			"select n.id from next_step n join public.next_action a using (id) where n.changed_at <> a.updated_at",
		),
		[],
	);
});
test("the board fallback keeps only the newest unsuperseded note and its date", async () => {
	// biome-ignore format: one row per fallback note
	assert.deepEqual((await rows(`select id,what,due_on::text,done_at,changed_by_job,changed_for_user_id from next_step where id between '${id(200)}' and '${id(207)}' order by id`)).map(Object.values), [
 [id(201), "Example current note", "2026-03-01", null, "agent", id(1)],
 [id(204), "Example undated note", null, null, null, null],
 [id(207), "Example alongside checklist", "2026-03-01", null, null, null],
 ]);
	const fallback = await rows(
		"select id from next_step where what='Imported deal follow-up'",
	);
	assert.equal(fallback.length, 1);
	assert.deepEqual(reasons(report, 200), ["older_next_step_note"]);
	assert.deepEqual(reasons(report, 202), ["superseded_note"]);
	assert.deepEqual(reasons(report, 203), ["note_hidden_by_action"]);
});
test("fallbacks agree with today's board for completed plans and checklist items", async () => {
	// biome-ignore format: one row per board case
	assert.deepEqual((await rows(`select id,next_step,next_date::text from public.v_deal_room_board where id in ('${id(13)}','${id(16)}') order by id`)).map(Object.values), [
 [id(13),null,null], [id(16),'Example alongside checklist','2026-03-01'],
 ]);
	assert.deepEqual(
		await rows(
			`select id from next_step where deal_id='${id(13)}' and status = 'open'`,
		),
		[],
	);
	assert.equal(
		(
			await rows(`select due_on::text from next_step where deal_id='${id(18)}'`)
		)[0]?.due_on,
		"2026-03-01",
	);
});
test("logged task history waits for an owner ruling without creating open work", async () => {
	for (const n of [300, 301, 302, 303, 304])
		assert.deepEqual(reasons(report, n), ["task_kind_unconfirmed"]);
	assert.deepEqual(
		await rows(
			`select id from next_step where id between '${id(300)}' and '${id(304)}'`,
		),
		[],
	);
});
test("post-call actions keep explicit completion times and list dropped or unmapped rows", async () => {
	// biome-ignore format: one row per post-call action
	assert.deepEqual((await rows(`select id,due_on::text,done_at::text,created_at::text,changed_at::text from next_step where id in ('${id(501)}','${id(502)}') order by id`)).map(Object.values), [
 [id(501),null,null,'2025-01-01 00:00:00+00','2025-02-01 00:00:00+00'],
 [id(502),'2025-02-01','2025-02-02 00:00:00+00','2025-01-01 00:00:00+00','2025-02-03 00:00:00+00'],
 ]);
	assert.deepEqual(reasons(report, 503), ["cancellation_reason_missing"]);
	assert.deepEqual(reasons(report, 504), [
		"deal_not_copied",
		"owner_not_a_user",
	]);
	assert.deepEqual(reasons(report, 206), ["plan_already_done"]);
});
test("unmappable values are listed and refused rows never appear", async () => {
	assert.deepEqual(reasons(report, 100), [
		"hold_has_no_place",
		"display_bullets_not_copied",
		"display_title_not_copied",
		"reference_not_copied",
	]);
	assert.deepEqual(reasons(report, 104), ["blank_next_step"]);
	assert.deepEqual(reasons(report, 105), ["deal_not_copied"]);
	assert.deepEqual(reasons(report, 106), [
		"agent_user_unknown",
		"owner_not_a_user",
	]);
	assert.deepEqual(reasons(report, 10), []);
	assert.deepEqual(
		await rows(
			`select id from next_step where id in ('${id(104)}','${id(105)}','${id(112)}','${id(113)}','${id(202)}','${id(203)}','${id(205)}')`,
		),
		[],
	);
});
test("ended actions keep only the end state, reason, time and event their old closing event proves", async () => {
	// biome-ignore format: one row per ended action
	assert.deepEqual((await rows(`select id,status,done_at::text,resolved_at::text,resolution_reason,resolution_event_id from next_step where status <> 'open' and id between '${id(100)}' and '${id(599)}' order by id`)).map(Object.values), [
 [id(101),'done','2025-01-15 00:00:00+00',null,null,null],
 [id(102),'cancelled',null,'2025-01-20 00:00:00+00','Example no longer needed',id(601)],
 [id(103),'expired',null,'2025-01-25 00:00:00+00',null,id(602)],
 [id(107),'expired',null,'2025-01-25 00:00:00+00',null,id(602)],
 [id(108),'done','2025-01-18 00:00:00+00',null,null,null],
 [id(110),'done',null,null,null,null],
 [id(121),'done',null,null,null,null],
 [id(123),'expired',null,null,null,null],
 [id(502),'done','2025-02-02 00:00:00+00',null,null,null],
 ]);
	assert.deepEqual(reasons(report, 102), ["owner_not_a_user"]);
	for (const n of [103, 107]) assert.deepEqual(reasons(report, n), []);
	assert.deepEqual(
		report.filter((r) => [112, 113].map(id).includes(r.old_id)),
		[
			{
				old_id: id(112),
				field: "status",
				value: "dropped",
				reason: "cancellation_evidence_conflict",
			},
			{
				old_id: id(113),
				field: "status",
				value: "dropped",
				reason: "cancellation_evidence_conflict",
			},
		],
	);
	// biome-ignore format: ended and open actions on Home
	assert.deepEqual((await rows(`select id from home_next_step where id in (${[100, 101, 102, 103, 107, 121, 123, 502].map((n) => `'${id(n)}'`).join(",")})`)).map((r) => r.id), [id(100)]);
});
test("unattached dates and unknown agent sponsors are reported with their values", () => {
	const listed = report.filter(
		(r) =>
			r.old_id === id(15) ||
			r.old_id === id(202) ||
			(r.old_id === id(106) && r.reason === "agent_user_unknown"),
	);
	// biome-ignore format: one row per correction
	assert.deepEqual(listed.map(Object.values), [
 [id(15),'next_date','2026-03-01','date_without_fallback'],
 [id(106),'changed_for_user_id',null,'agent_user_unknown'],
 [id(202),'text','Example superseded','superseded_note'],
 ]);
});
test("post-call acceptance and outreach-completion events name their own author and sponsor", async () => {
	// biome-ignore format: one row per event form
	assert.deepEqual((await rows(`select id,changed_by_user_id,changed_by_job,changed_for_user_id from next_step where id in ('${id(501)}','${id(502)}') order by id`)).map(Object.values), [
 [id(501),null,'agent',id(1)], [id(502),null,'agent',id(1)],
 ]);
});
test("a recorded next-step activity names its sponsoring user", async () => {
	assert.deepEqual(
		await rows(`select changed_by_user_id, changed_by_job, changed_for_user_id
 from activity where id='${id(201)}'`),
		[
			{
				changed_by_user_id: null,
				changed_by_job: "agent",
				changed_for_user_id: id(1),
			},
		],
	);
});

for (const scenario of [
	{
		name: "set-next-step",
		setup: `insert into public.event (id,subject_type,subject_id,field,new_value,actor_id,verb,cause,occurred_at,recorded_at,sponsoring_human_slug)
 values ('${id(704)}','deal','${id(700)}','next_step','{"next_step":"Example repeated step"}','${id(2)}','set-next-step','automation_job','2025-03-01 00:00:01','2025-03-01 00:00:05','partner_one');`,
		expected: id(1),
		matchedNotes: [id(701), id(702)],
	},
	{
		name: "undo-call-change",
		setup: `insert into public.event (id,subject_type,subject_id,field,new_value,actor_id,verb,cause,occurred_at,recorded_at,sponsoring_human_slug)
 values ('${id(704)}','deal','${id(700)}','next_step','{"next_step":"Example repeated step"}','${id(2)}','undo-call-change','automation_job','2025-03-01 00:00:01','2025-03-01 00:00:05','partner_one');`,
		expected: id(1),
		matchedNotes: [id(701), id(702)],
	},
	{
		name: "undo-call",
		setup: `insert into public.event (id,subject_type,subject_id,field,new_value,actor_id,verb,cause,occurred_at,recorded_at,sponsoring_human_slug)
 values ('${id(704)}','deal','${id(700)}','next_step','{"next_step":"Example repeated step"}','${id(2)}','undo-call','automation_job','2025-03-01 00:00:01','2025-03-01 00:00:05','partner_one');`,
		expected: id(1),
		matchedNotes: [id(701), id(702)],
	},
	{
		name: "an earlier sponsor cannot sign the current note",
		setup: `insert into public.event (id,subject_type,subject_id,field,new_value,actor_id,verb,cause,occurred_at,recorded_at,sponsoring_human_slug)
 values ('${id(704)}','deal','${id(700)}','next_step','{"next_step":"Example repeated step"}','${id(2)}','set-next-step','automation_job','2025-03-01 00:00:01','2025-03-01 00:00:05',null);
 update public.event set sponsoring_human_slug='partner_one' where id='${id(703)}';`,
		expected: null,
		matchedNotes: [id(701), id(702)],
	},
	{
		name: "tied event times",
		setup: `insert into public.event (id,subject_type,subject_id,field,new_value,actor_id,verb,cause,occurred_at,recorded_at,sponsoring_human_slug)
 values ('${id(704)}','deal','${id(700)}','next_step','{"next_step":"Example repeated step"}','${id(2)}','set-next-step','automation_job','2025-03-01 00:00:01','2025-03-01 00:00:05','partner_one');
 delete from public.event where id='${id(703)}';
 insert into public.event (subject_type,subject_id,field,new_value,actor_id,verb,cause,occurred_at,recorded_at,sponsoring_human_slug)
 select subject_type,subject_id,field,new_value,actor_id,verb,cause,occurred_at,recorded_at,sponsoring_human_slug from public.event where id='${id(704)}';`,
		expected: null,
		matchedNotes: [],
	},
	{
		name: "tied note times",
		setup: `insert into public.event (id,subject_type,subject_id,field,new_value,actor_id,verb,cause,occurred_at,recorded_at,sponsoring_human_slug)
 values ('${id(704)}','deal','${id(700)}','next_step','{"next_step":"Example repeated step"}','${id(2)}','set-next-step','automation_job','2025-03-01 00:00:01','2025-03-01 00:00:05','partner_one');
 update public.deal_note set created_at='2025-03-01 00:00:04' where id='${id(701)}';`,
		expected: null,
		matchedNotes: [],
	},
	{
		name: "no event for the current note",
		setup: `delete from public.event where id='${id(704)}';`,
		expected: null,
		matchedNotes: [id(701)],
	},
]) {
	test(`fallback signing uses mutual closest matches for ${scenario.name}`, async () => {
		await db.query("begin; select set_config('engine.job','old_system',true)");
		try {
			await db.query(`insert into public.deal (id,client_id,name,deal_type,phase,owner,next_date,created_by,updated_by)
 values ('${id(700)}','${id(3)}','Example signing deal','lease','closed','partner_one','2026-03-01','${id(1)}','${id(1)}');
 insert into deal (id,name,owner_user_id) values ('${id(700)}','Example signing deal','${id(1)}');
 insert into public.deal_note (id,deal_id,kind,text,actor_id,created_at) values
 ('${id(701)}','${id(700)}','next_step','Example repeated step','${id(2)}','2025-03-01 00:00:02'),
 ('${id(702)}','${id(700)}','next_step','Example repeated step','${id(2)}','2025-03-01 00:00:04');
 insert into public.event (id,subject_type,subject_id,field,new_value,actor_id,verb,cause,occurred_at,recorded_at,sponsoring_human_slug) values
 ('${id(703)}','deal','${id(700)}','next_step','{"next_step":"Example repeated step"}','${id(2)}','set-next-step','automation_job','2025-03-01 00:00:00','2025-03-01 00:00:03',null);`);
			await db.query(scenario.setup);
			assert.deepEqual(
				(
					await rows(`select note_id from copy_next_step_event()
 where note_id in ('${id(701)}','${id(702)}') order by note_id`)
				).map((row) => row.note_id),
				scenario.matchedNotes,
			);
			const result = await run();
			assert.deepEqual(
				await rows(
					`select what,due_on::text,changed_by_user_id,changed_by_job,changed_for_user_id from next_step where id='${id(702)}'`,
				),
				[
					{
						what: "Example repeated step",
						due_on: "2026-03-01",
						changed_by_user_id: null,
						changed_by_job: "agent",
						changed_for_user_id: scenario.expected,
					},
				],
			);
			assert.deepEqual(
				reasons(result, 702),
				scenario.expected ? [] : ["agent_user_unknown"],
			);
		} finally {
			await db.query("rollback");
		}
	});
}

test("the activity copy keeps every next-step note as a recorded note beside the step it backs, and copies no task", async () => {
	const recorded = (text: string) => `Recorded next step\n\n${text}`;
	// biome-ignore format: one row per deal note
	assert.deepEqual((await rows(`select a.id, a.summary, s.id is not null as backs_step
 from activity a left join next_step s using (id) order by a.id`)).map(Object.values), [
 [id(200), recorded("Example old note"), false],
 [id(201), recorded("Example current note"), true],
 [id(202), recorded("Example superseded"), false],
 [id(203), recorded("Example hidden note"), false],
 [id(204), recorded("Example undated note"), true],
 [id(205), "Example ordinary note", false],
 [id(206), recorded("Example finished plan note"), false],
 [id(207), recorded("Example alongside checklist"), true],
 ]);
});

test("vendor actions become next steps about the vendor's record, never about a deal", async () => {
	// biome-ignore format: one row per vendor action
	assert.deepEqual((await rows(`select id, deal_id, party_id, due_on::text, done_at::text, owner_party_id, changed_by_user_id from next_step where id between '${id(120)}' and '${id(125)}' order by id`)).map(Object.values), [
 [id(120), null, id(61), "2026-05-01", null, id(1), id(1)],
 [id(121), null, id(61), null, null, id(1), id(1)],
 [id(123), null, id(61), null, null, id(1), id(1)],
 [id(124), null, id(61), null, null, id(1), id(1)],
 ]);
	for (const n of [120, 121]) assert.deepEqual(reasons(report, n), []);
	assert.deepEqual(reasons(report, 122), ["cancellation_reason_missing"]);
	assert.deepEqual(reasons(report, 123), ["expiry_unproven"]);
	assert.deepEqual(reasons(report, 124), ["hold_has_no_place"]);
	assert.deepEqual(
		report.filter((r) => r.old_id === id(125)),
		[
			{
				old_id: id(125),
				field: "vendor_id",
				value: id(63),
				reason: "vendor_not_copied",
			},
		],
	);
});

test("reruns preserve every row and history entry, and retry a deal or vendor copied later", async () => {
	const snapshot = async () => [
		await rows("select * from next_step order by id"),
		await rows("select * from change order by id"),
	];
	const before = await snapshot();
	assert.deepEqual(await copyOnce(), report);
	assert.deepEqual(await snapshot(), before);
	await db.query(
		`begin; select set_config('engine.job','old_system',true); insert into deal (id,name,owner_user_id) values ('${id(17)}','Example late deal','${id(1)}'); commit`,
	);
	await copyOnce();
	assert.equal(
		(await rows(`select what from next_step where id='${id(105)}'`))[0]?.what,
		"Example missing deal",
	);
	await db.query(
		`begin; select set_config('engine.job','old_system',true); insert into outside_id (source,value,party_id) values ('old_system','${id(63)}','${id(61)}'); commit`,
	);
	await copyOnce();
	assert.equal(
		(await rows(`select party_id from next_step where id='${id(125)}'`))[0]
			?.party_id,
		id(61),
	);
});
test("an id on another record is listed without changing its row", async () => {
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into next_step (id,deal_id,what) values ('${id(999)}','${id(11)}','Example existing');
 insert into public.next_action (id,subject_type,subject_id,owner_id,description,status,created_by) values ('${id(999)}','deal','${id(10)}','${id(1)}','Example conflict','done','${id(1)}');`);
	try {
		assert.deepEqual(reasons(await run(), 999), ["id_taken"]);
		assert.equal(
			(await rows(`select what from next_step where id='${id(999)}'`))[0]?.what,
			"Example existing",
		);
	} finally {
		await db.query("rollback");
	}
});

test("the record constraint and stamp still apply after copying", async () => {
	await db.query("begin; select set_config('engine.job','old_system',true)");
	await assert.rejects(
		db.query("insert into next_step (what) values ('Example invalid')"),
		{ constraint: "next_step_one_record" },
	);
	await db.query("rollback");
	await db.query(
		`begin; select set_config('engine.job','agent',true); update next_step set what='Example edited' where id='${id(100)}'`,
	);
	assert.equal(
		(
			await rows(`select changed_by_job from next_step where id='${id(100)}'`)
		)[0]?.changed_by_job,
		"agent",
	);
	await db.query("rollback");
});
