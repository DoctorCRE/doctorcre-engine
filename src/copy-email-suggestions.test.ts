import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-email-suggestions.sql");
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

const step = (
	n: number,
	deal: number | null,
	activity: number,
	status = "pending",
	owner = "partner_one",
	resolver = 1,
) =>
	`('${id(n)}', 'next_step', ${deal ? `'${id(deal)}'` : "null"}, '${id(activity)}', 'Example quote ${n}', ' Example step ${n} ', '2024-02-01',
  '${owner}', 0.9, '${status}', '${id(3)}', '2024-01-01 15:01', ${status === "pending" ? "null, null, null" : `'${id(resolver)}', '2024-01-10', 'Example reason'`})`;

before(async () => {
	await setup();
	// biome-ignore format: one fixture row per line
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 create table public.email_lead_exclusion (mailbox_owner text not null, message_hash text not null, recorded_at timestamptz not null default now(),
  primary key (mailbox_owner, message_hash));
 insert into public.email_lead_exclusion (mailbox_owner, message_hash) values ('partner_one', '${"a".repeat(64)}');
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User'),
  ('${id(2)}', 'partner_two', 'human', 'Example Other'), ('${id(3)}', 'example-mail', 'automation', 'Example Mail');
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User'), ('${id(12)}', 'person', 'Example Client');
 insert into app_user (id, slug) values ('${id(1)}', 'partner_one');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(1)}', '${id(1)}'), ('old_system', '${id(12)}', '${id(12)}');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) select v, 'person', 'Example Party', '${id(1)}', '${id(1)}'
  from unnest(array['${id(11)}', '${id(12)}']::uuid[]) v;
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(20)}', '${id(11)}', '${id(1)}', '${id(1)}'),
  ('${id(21)}', '${id(12)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('loi', 'Example LOI');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by)
  select v, '${id(20)}', 'Example Deal', 'lease', 'loi', 'partner_one', '${id(1)}', '${id(1)}' from unnest(array['${id(30)}', '${id(31)}']::uuid[]) v;
 insert into deal (id, name, owner_user_id) values ('${id(30)}', 'Example Deal', '${id(1)}');
 insert into outside_id (source, value, deal_id) values ('old_system', '${id(30)}', '${id(30)}');
 insert into public.activity_kind (slug, label, is_contact) values ('email_in', 'Example inbound email', true),
  ('email_out', 'Example outbound email', true);
 insert into public.activity (id, kind, occurred_at, actor_id, summary, deal_id, client_id) values
  ('${id(60)}', 'email_in', '2024-01-01 15:00', '${id(3)}', 'Example email', '${id(30)}', null),
  ('${id(61)}', 'email_in', '2024-01-01 15:00', '${id(3)}', 'Example email', null, '${id(21)}'),
  ('${id(62)}', 'email_in', '2024-01-01 15:00', '${id(3)}', 'Example email', '${id(30)}', null),
  ('${id(63)}', 'email_in', '2024-01-01 15:00', '${id(3)}', 'Example email', null, '${id(21)}'),
  ('${id(64)}', 'email_in', '2024-01-01 15:00', '${id(3)}', 'Example email', '${id(30)}', null),
  ('${id(65)}', 'email_in', '2024-01-01 15:00', '${id(3)}', 'Example email', '${id(30)}', null);
 insert into public.activity (id, kind, occurred_at, actor_id, summary, party_id)
  values ('${id(68)}', 'email_in', '2024-01-01 15:00', '${id(3)}', 'Example email', '${id(12)}'),
  ('${id(69)}', 'email_out', '2024-01-01 15:00', '${id(1)}', 'Example email', '${id(12)}');
 update public.activity set email_source = '{"mailbox_owner":"partner_one","sender_email":"sender@example.test"}'
  where id in ('${id(60)}', '${id(64)}');
 insert into activity (id, kind, happened_at) select v, 'email', '2024-01-01 15:00' from unnest(array['${id(60)}', '${id(61)}', '${id(63)}', '${id(66)}']::uuid[]) v;
 insert into activity (id, kind, happened_at) values ('${id(68)}', 'email', '2024-01-01 15:00');
 insert into activity_about (activity_id, deal_id, party_id) values ('${id(60)}', '${id(30)}', null), ('${id(61)}', null, '${id(12)}'),
  ('${id(63)}', '${id(30)}', null), ('${id(66)}', '${id(30)}', null), ('${id(68)}', null, '${id(12)}');
 insert into email (activity_id, message_id, sender, subject, body, imported) select v, case when v <> '${id(66)}' then 'message-' || v end,
  'sender@example.com', 'Example', 'Example', true from unnest(array['${id(60)}', '${id(61)}', '${id(63)}', '${id(66)}', '${id(68)}']::uuid[]) v;
 insert into email_mailbox (activity_id, user_id) values ('${id(60)}', '${id(1)}');
 -- Row 64 is another mailbox's row of email 60, and row 65 joined email 66, copied without a Message-ID; row 62 never copied.
 insert into outside_id (source, value, email_activity_id) values ('old_system', '${id(60)}', '${id(60)}'), ('old_system', '${id(61)}', '${id(61)}'),
  ('old_system', '${id(63)}', '${id(63)}'), ('old_system', '${id(64)}', '${id(60)}'), ('old_system', '${id(65)}', '${id(66)}'),
  ('old_system', '${id(68)}', '${id(68)}'), ('old_system', '${id(69)}', '${id(60)}');
 insert into public.email_proposal (id, kind, deal_id, activity_id, evidence_quote, task_text, next_date, owner, confidence, status, created_by,
  created_at, resolved_by, resolved_at, resolution_reason) values
  ${[
		step(71, 30, 60),
		step(72, null, 61, "dismissed"),
		step(73, 31, 60),
		step(74, 30, 62),
		step(75, 30, 61, "pending", "partner_two"),
		step(76, 30, 63, "dismissed", "partner_one", 3),
		step(77, 31, 61, "confirmed"),
		step(78, null, 63),
		step(80, 30, 64),
		step(81, 30, 65),
		step(82, null, 68),
	].join(",\n  ")};
 update public.email_proposal set resolution_note = 'Example note' where id = '${id(72)}';
 insert into public.email_proposal (id, kind, deal_id, activity_id, evidence_quote, task_text, confidence, sender_role, created_by, created_at) values
  ('${id(79)}', 'file_to_deal', '${id(30)}', '${id(60)}', 'Example quote', null, 0.9, 'client', '${id(3)}', '2024-01-01 15:01'),
  ('${id(83)}', 'possible_new_deal', null, '${id(64)}', 'Example quote', 'Example matter', 0.9, 'client', '${id(3)}', '2024-01-01 15:01'),
  ('${id(84)}', 'file_to_deal', '${id(30)}', '${id(64)}', 'Example duplicate', null, 0.9, 'client', '${id(3)}', '2024-01-01 15:02'),
  ('${id(85)}', 'possible_new_deal', null, '${id(68)}', 'Example quote', null, 0.9, 'client', '${id(3)}', '2024-01-01 15:01'),
  ('${id(86)}', 'possible_new_deal', null, '${id(69)}', 'Example quote', null, 0.9, 'client', '${id(3)}', '2024-01-01 15:01'),
  ('${id(87)}', 'possible_new_deal', null, '${id(60)}', 'Example quote', null, 0.9, 'client', '${id(3)}', '2024-01-01 15:01');
 update public.email_proposal set status='dismissed', resolved_by='${id(1)}', resolved_at='2024-01-10', resolution_reason='Example reason'
  where id = '${id(87)}';
 commit;`);
});
after(cleanup);

test("copies each email next step with its decision and email, lists what waits, and on a rerun adds what was fixed and lists what changed", async () => {
	const report = await run();
	// biome-ignore format: one row per line
	assert.deepEqual(await rows(`select id, kind, activity_id, activity_kind, evidence, proposed_by_job, status, decided_by_user_id, decided_at::text,
  deal_id, party_id, what, owner_party_id, due_on::text, changed_by_user_id, changed_by_job, changed_at::text from proposal order by id`), [
		"#71 next_step #60 email Example quote 71 old_system pending - - #30 - Example step 71 #01 2024-02-01 - old_system 2024-01-01 15:01:00+00",
		"#72 next_step #61 email Example quote 72 old_system dismissed #01 2024-01-10 00:00:00+00 - #12 Example step 72 #01 2024-02-01 #01 - 2024-01-10 00:00:00+00",
		"#79 file_to_deal #60 email Example quote old_system pending - - #30 - - - - - old_system 2024-01-01 15:01:00+00",
		"#80 next_step #60 email Example quote 80 old_system pending - - #30 - Example step 80 #01 2024-02-01 - old_system 2024-01-01 15:01:00+00",
		"#81 next_step #66 email Example quote 81 old_system pending - - #30 - Example step 81 #01 2024-02-01 - old_system 2024-01-01 15:01:00+00",
		"#82 next_step #68 email Example quote 82 old_system pending - - - #12 Example step 82 #01 2024-02-01 - old_system 2024-01-01 15:01:00+00",
		"#83 possible_new_deal #60 email Example quote old_system pending - - - - - - - - old_system 2024-01-01 15:01:00+00",
	]);
	// biome-ignore format: one row per line
	assert.deepEqual(await rows(`select record ->> 'id' as id, action, new_value ->> 'status' as status, changed_by_user_id, changed_by_job,
  changed_at::text from change where table_name = 'proposal' order by record ->> 'id', changed_at`), [
		"#71 insert pending - old_system 2024-01-01 15:01:00+00",
		"#72 insert pending - old_system 2024-01-01 15:01:00+00",
		"#72 update dismissed #01 - 2024-01-10 00:00:00+00",
		"#79 insert pending - old_system 2024-01-01 15:01:00+00",
		"#80 insert pending - old_system 2024-01-01 15:01:00+00",
		"#81 insert pending - old_system 2024-01-01 15:01:00+00",
		"#82 insert pending - old_system 2024-01-01 15:01:00+00",
		"#83 insert pending - old_system 2024-01-01 15:01:00+00",
	]);
	assert.deepEqual(
		await rows(
			`select id, changed_for_user_id from proposal where kind <> 'next_step' order by id`,
		),
		["#79 #01", "#83 #01"],
	);
	assert.deepEqual(report, [
		"#72 resolution_note Example note note_has_no_place",
		"#72 resolution_reason Example reason reason_has_no_place",
		"#73 deal_id #31 record_not_copied",
		"#74 activity_id #62 email_not_copied",
		"#75 owner partner_two owner_not_a_user",
		"#76 resolved_by #03 decision_needs_user",
		"#77 deal_id #31 record_not_copied",
		"#77 status confirmed accepted_not_copied",
		"#78 activity_id #63 email_not_about_record",
		"#84 proposal #84 duplicate_filing_suggestion",
		"#85 activity_id #68 mailbox_not_copied",
		"#86 activity_id #69 filing_not_inbound",
		"#87 status dismissed filing_not_pending",
		`- message_hash ${"a".repeat(64)} message_not_stored`,
	]);
	assert.deepEqual(
		await rows(
			"select tgname from pg_trigger where tgrelid in ('next.proposal'::regclass, 'next.change'::regclass) and tgenabled <> 'O'",
		),
		[],
	);

	const all =
		"select (select jsonb_agg(p order by id) from proposal p), (select jsonb_agg(c order by id) from change c)";
	const unchanged = await rows(all);
	assert.deepEqual(await run(), report);
	assert.deepEqual(await rows(all), unchanged);

	await db.query(`begin;
 update public.email_proposal set owner = 'partner_one' where id = '${id(75)}';
 update public.email_proposal set task_text = 'Example changed' where id = '${id(71)}';
 commit;`);
	const later = await run();
	assert.ok(later.includes("#71 proposal #71 existing_proposal_conflicts"));
	assert.ok(!later.some((r) => r.startsWith("#75 ")));
	// biome-ignore format: one row per line
	assert.deepEqual(await rows("select id, status, deal_id, what from proposal where kind = 'next_step' order by id"), [
		"#71 pending #30 Example step 71",
		"#72 dismissed - Example step 72",
		"#75 pending #30 Example step 75",
		"#80 pending #30 Example step 80",
		"#81 pending #30 Example step 81",
		"#82 pending - Example step 82",
	]);
});
