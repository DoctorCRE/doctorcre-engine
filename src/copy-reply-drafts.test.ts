import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-reply-drafts.sql");
const { db, setup, cleanup } = copyTest();
// Each row reads as one line, with a made-up id shown by its number.
const line = (row: pg.QueryResultRow) =>
	Object.values(row)
		.map((v) =>
			v === null ? "-" : String(v).replace(/^0{8}-0{4}-4000-8000-0{10}/, "#"),
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

// Old id, activity and status; who decided and the dismissal or failure reason; the owner and the submitted attachments.
type Draft = [
	n: number,
	activity: number,
	status: string,
	decider?: number | null,
	reason?: string | null,
	owner?: string,
	attachments?: string,
];
// biome-ignore format: one old draft per line
const drafts: Draft[] = [
	[70, 40, "pending"],
	[71, 41, "dismissed", 1, "Example answered by phone"],
	[72, 44, "failed", 1, "aborted_before_dispatch"],
	[73, 45, "failed", 1, "unconfirmed_after_3"],
	[74, 46, "approved_to_send", 1],
	[75, 43, "pending"],
	[76, 51, "pending", null, null, "partner_two"],
	[78, 47, "dismissed", 3, "Example expired"],
	[80, 49, "pending"],
	[81, 50, "pending"],
	[82, 53, "failed", 1, "aborted_before_dispatch", "partner_one", '[{"path": "/example/plan.pdf", "sha256": "example", "size": 1}]'],
];
// biome-ignore format: one column group per line
const oldDraft = ([n, activity, status, decider, reason, owner = "partner_one", attachments = "[]"]: Draft) =>
	`('${id(n)}', 'reply_draft', '${id(activity)}', 'Example asks to tour', '${owner}', 0.9, '${status}', '${id(3)}', '2024-01-01 15:00',
  ${decider ? `'${id(decider)}', '2024-01-02'` : "null, null"}, ${status === "dismissed" ? `'${reason}'` : "null"}, 'Re: Example tour', 'Example drafted reply',
  ${["pending", "dismissed"].includes(status) ? "null, null" : `'{"subject": "Re: Example tour", "body": "Example approved reply", "sha256": "example",
   "to": ["Doctor@Example.com"], "cc": ["partner.two@example.com"], "attachments": ${attachments}}', '2024-01-02'`},
  ${status === "failed" ? `'{"status": "failed", "reason": "${reason}"}', '2024-01-03'` : "null, null"})`;
// Old rows of one email share its Message-ID; a copied email keeps one row's id.
// biome-ignore format: one old row per pair
const messages: [activity: number, email: number | null][] = [
	[40, 40], [41, 42], [43, null], [44, 44], [45, 45], [46, null], [47, 47], [49, 48], [50, 48], [51, 40], [53, 40],
];
const EMAILS = [40, 42, 44, 45, 47, 48].map(id).join("', '");

before(async () => {
	await setup();
	// biome-ignore format: one fixture row per line
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 create table public.email (id uuid primary key, mailbox_account text not null, message_id text);
 alter table public.activity add column email_id uuid references public.email;
 insert into public.email select v, 'partner.one@example.com', '<' || v || '@example.test>' from unnest(array['${EMAILS}']::uuid[]) v;
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User'),
  ('${id(2)}', 'partner_two', 'human', 'Example Other'), ('${id(3)}', 'example-mail', 'automation', 'Example mail job');
 insert into public.activity_kind (slug, label, is_contact) values ('email_in', 'Example email', true);
 insert into public.activity (id, kind, occurred_at, actor_id, summary, email_id) values
  ${messages.map(([n, email]) => `('${id(n)}', 'email_in', '2024-01-01 14:00', '${id(3)}', 'Email from Example Doctor: Example tour', ${email ? `'${id(email)}'` : "null"})`).join(", ")};
 insert into public.email_proposal (id, kind, activity_id, evidence_quote, owner, confidence, status, created_by, created_at, resolved_by, resolved_at,
  resolution_reason, draft_subject, draft_body, submitted_email, submitted_at, send_result, result_recorded_at) values
  ${drafts.map(oldDraft).join(",\n  ")};
 update public.email_proposal set deferred_until = '2024-02-01' where id = '${id(70)}';
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User'), ('${id(10)}', 'company', 'Example Clinic');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(1)}', '${id(1)}');
 insert into activity (id, kind, happened_at) select v, 'email', '2024-01-01 14:00' from unnest(array['${EMAILS}']::uuid[]) v;
 insert into email (activity_id, message_id, sender, subject, body) select id, '<' || id || '@example.test>', 'doctor@example.com', 'Example tour', 'Example'
  from activity;
 insert into activity_about (activity_id, party_id) select id, '${id(10)}' from activity;
 commit;`);
});
after(cleanup);

test("copies each reply draft with its decision and failed try, and on a rerun adds what arrived and lists what changed", async () => {
	const report = await run();
	// biome-ignore format: one row per line
	assert.deepEqual(await rows(`select id, email_activity_id, owner_user_id, status, subject, body, decided_at::text, dismiss_reason, to_address, cc_address,
  failure_reason, may_have_sent, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at::text from reply_draft order by id`), [
		"#70 #40 #01 pending Re: Example tour Example drafted reply - - - - - - - old_system - 2024-01-01 15:00:00+00",
		"#71 #42 #01 dismissed Re: Example tour Example drafted reply 2024-01-02 00:00:00+00 Example answered by phone - - - - #01 - - 2024-01-02 00:00:00+00",
		"#72 #44 #01 failed Re: Example tour Example approved reply 2024-01-02 00:00:00+00 - doctor@example.com partner.two@example.com aborted_before_dispatch false - old_system #01 2024-01-03 00:00:00+00",
		"#73 #45 #01 failed Re: Example tour Example approved reply 2024-01-02 00:00:00+00 - doctor@example.com partner.two@example.com unconfirmed_after_3 true - old_system #01 2024-01-03 00:00:00+00",
		"#78 #47 #01 dismissed Re: Example tour Example drafted reply 2024-01-02 00:00:00+00 Example expired - - - - - old_system - 2024-01-02 00:00:00+00",
	]);
	// biome-ignore format: one row per line
	assert.deepEqual(await rows(`select record ->> 'id' as id, action, new_value ->> 'status' as status, changed_by_user_id, changed_by_job, changed_for_user_id,
  changed_at::text from change where table_name = 'reply_draft' order by record ->> 'id', id`), [
		"#70 insert pending - old_system - 2024-01-01 15:00:00+00",
		"#71 insert pending - old_system - 2024-01-01 15:00:00+00",
		"#71 update dismissed #01 - - 2024-01-02 00:00:00+00",
		"#72 insert pending - old_system - 2024-01-01 15:00:00+00",
		"#72 update approved #01 - - 2024-01-02 00:00:00+00",
		"#72 update failed - old_system #01 2024-01-03 00:00:00+00",
		"#73 insert pending - old_system - 2024-01-01 15:00:00+00",
		"#73 update approved #01 - - 2024-01-02 00:00:00+00",
		"#73 update failed - old_system #01 2024-01-03 00:00:00+00",
		"#78 insert pending - old_system - 2024-01-01 15:00:00+00",
		"#78 update dismissed - old_system - 2024-01-02 00:00:00+00",
	]);
	assert.deepEqual(report, [
		"#70 deferred_until 2024-02-01 00:00:00+00 snooze_waits_for_home_marks",
		"#74 status approved_to_send status_not_copied",
		"#75 activity_id #43 email_not_copied",
		"#76 owner partner_two owner_not_a_user",
		"#80 reply_draft #80 existing_draft_conflicts",
		"#81 reply_draft #81 existing_draft_conflicts",
		`#82 submitted_email [{"path": "/example/plan.pdf", "size": 1, "sha256": "example"}] attachments_have_no_place`,
	]);
	assert.deepEqual(
		await rows(
			"select tgname from pg_trigger where tgrelid in ('next.reply_draft'::regclass, 'next.change'::regclass) and tgenabled <> 'O'",
		),
		[],
	);

	const all =
		"select (select jsonb_agg(d order by id) from reply_draft d), (select jsonb_agg(c order by id) from change c)";
	const before = await rows(all);
	assert.deepEqual(await run(), report);
	assert.deepEqual(await rows(all), before);

	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into activity (id, kind, happened_at) values ('${id(43)}', 'email', '2024-01-01 14:00');
 insert into email (activity_id, message_id, sender, subject, body) values ('${id(43)}', '<later@example.test>', 'doctor@example.com', 'Example tour', 'Example');
 insert into activity_about (activity_id, party_id) values ('${id(43)}', '${id(10)}');
 update public.email_proposal set draft_body = 'Example edited reply' where id = '${id(70)}';
 commit;`);
	const later = await run();
	assert.ok(!later.some((r) => r.startsWith("#75 ")));
	assert.ok(later.includes("#70 reply_draft #70 existing_draft_conflicts"));
	assert.deepEqual(
		await rows(
			`select id, status, body from reply_draft where id in ('${id(70)}', '${id(75)}') order by id`,
		),
		["#70 pending Example drafted reply", "#75 pending Example drafted reply"],
	);
});
