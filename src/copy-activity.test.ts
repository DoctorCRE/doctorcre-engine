import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-activity.sql");
const { db, setup, cleanup } = copyTest();
const rows = async (sql: string) => (await db.query(sql)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	await db.query("begin");
	try {
		const results = await db.query(copy);
		assert.ok(Array.isArray(results));
		await db.query("commit");
		return results.at(-1)?.rows ?? [];
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
};
const reasons = (report: pg.QueryResultRow[]) =>
	report.map((r) => `${r.old_id.slice(-2)} ${r.field} ${r.reason}`);
const about = () =>
	rows(
		"select activity_id, deal_id, party_id, created_at::text from activity_about order by activity_id, deal_id, party_id",
	);

const activity = (
	n: number,
	kind: string,
	links: Partial<
		Record<"deal" | "client" | "lead" | "vendor" | "party", number>
	>,
	extra = "null, null, null, null",
) =>
	`('${id(n)}', '${kind}', '2024-01-0${n % 9 || 1}', '2024-02-01', '2024-03-01', '${id(links.party ? 2 : 1)}', 'Example ${kind}', ${[
		"deal",
		"client",
		"lead",
		"vendor",
		"party",
	]
		.map((k) => {
			const v = links[k as keyof typeof links];
			return v ? `'${id(v)}'` : "null";
		})
		.join(", ")}, ${extra})`;

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User'),
  ('${id(2)}', 'claude', 'automation', 'Example Agent');
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by)
  select v, case when v in ('${id(10)}'::uuid, '${id(12)}') then 'org' else 'person' end, 'Example Party ' || v, '${id(1)}', '${id(1)}'
  from unnest(array['${id(10)}', '${id(11)}', '${id(12)}', '${id(13)}', '${id(14)}', '${id(15)}']::uuid[]) v;
 insert into party (id, kind, name) select v, case when v in ('${id(10)}'::uuid, '${id(12)}') then 'company' else 'person' end, 'Example Party'
  from unnest(array['${id(10)}', '${id(11)}', '${id(12)}', '${id(14)}']::uuid[]) v;
 insert into outside_id (source, value, party_id) values ('old_system', '${id(1)}', '${id(1)}'), ('old_system', '${id(10)}', '${id(10)}'),
  ('old_system', '${id(11)}', '${id(11)}'), ('old_system', '${id(12)}', '${id(12)}'), ('old_system', '${id(13)}', '${id(14)}'), ('old_system', '${id(14)}', '${id(14)}');
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(20)}', '${id(10)}', '${id(1)}', '${id(1)}');
 insert into public.lead_stage (slug, label) values ('new', 'Example new');
 insert into public.lead (id, party_id, stage, created_by, updated_by) values ('${id(21)}', '${id(11)}', 'new', '${id(1)}', '${id(1)}'),
  ('${id(25)}', '${id(15)}', 'new', '${id(1)}', '${id(1)}');
 insert into public.vendor_disposition (slug, label, workable, sort) values ('active', 'Example active', true, 1);
 insert into public.vendor (id, party_id, category, created_by, updated_by) values ('${id(23)}', '${id(10)}', 'lender', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('loi', 'Example LOI');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by)
  select v, '${id(20)}', 'Example Deal', 'lease', 'loi', 'partner_one', '${id(1)}', '${id(1)}' from unnest(array['${id(30)}', '${id(31)}']::uuid[]) v;
 insert into deal (id, name, owner_user_id) values ('${id(30)}', 'Example Deal', '${id(1)}');
 insert into outside_id (source, value, deal_id) values ('old_system', '${id(30)}', '${id(30)}');
 insert into public.activity_kind (slug, label, is_contact) select s, s, true from unnest(array['call', 'tour', 'note', 'email_in', 'meeting']) s;
 insert into public.activity_kind (slug, label, is_contact) values ('text', 'Text', true), ('analysis', 'Analysis', false), ('loi', 'LOI', true),
  ('counter_sent', 'Counter Sent', true), ('counter_received', 'Counter Received', true), ('lease_signed', 'Lease Signed', true), ('task', 'Task', false);
 insert into public.activity (id, kind, occurred_at, recorded_at, updated_at, actor_id, summary, deal_id, client_id, lead_id, vendor_id, party_id,
  detail, owed, connected, email_context) values
  ${[
		activity(
			40,
			"call",
			{ deal: 30, client: 20 },
			"'Example call notes', null, null, null",
		),
		activity(41, "tour", { lead: 21 }),
		activity(42, "note", { party: 13 }),
		activity(43, "email_in", { deal: 30 }),
		activity(
			44,
			"note",
			{ deal: 30 },
			`'Example full text', null, null, '{"subject": "Example"}'`,
		),
		activity(45, "text", { deal: 30 }),
		activity(46, "call", { deal: 31 }),
		activity(
			47,
			"call",
			{ deal: 30, lead: 25 },
			`'{"match": "exact"}', 'Example figure', false, null`,
		),
		activity(48, "meeting", { client: 20, vendor: 23 }),
		activity(49, "note", { deal: 30 }),
		activity(
			39,
			"note",
			{ deal: 30 },
			"'https://example.com/listing', null, null, null",
		),
		activity(
			54,
			"analysis",
			{ deal: 30 },
			"'Example analysis detail', null, null, null",
		),
		activity(55, "loi", { deal: 30 }),
		activity(56, "counter_sent", { deal: 30 }),
		activity(57, "counter_received", { deal: 30 }),
		activity(58, "lease_signed", { client: 20 }),
		activity(59, "task", { deal: 30 }),
	].join(",\n  ")};
 update public.activity set summary = 'Full text of email: Example subject' where id = '${id(49)}';
 update public.activity set summary = 'Links from matched email' where id = '${id(39)}';
 insert into public.event (actor_id, verb, subject_type, subject_id, new_value, cause, occurred_at, sponsoring_human_slug)
  values ('${id(2)}', 'log-activity', 'party', '${id(13)}', '{"activity": "${id(42)}"}', 'automation_job', '2024-01-06', 'partner_one');
 insert into public.deal_note (id, deal_id, kind, text, actor_id, created_at) values
  ('${id(50)}', '${id(30)}', 'note', 'Example deal note', '${id(1)}', '2024-05-01'),
  ('${id(51)}', '${id(30)}', 'next_step', 'Example next step', '${id(1)}', '2024-05-02'),
  ('${id(52)}', '${id(30)}', 'note', 'Example agent note', '${id(2)}', '2024-05-03'),
  ('${id(53)}', '${id(30)}', 'note', 'Example unsigned note', '${id(2)}', '2024-05-04');
 insert into public.event (actor_id, verb, subject_type, subject_id, field, new_value, cause, occurred_at, sponsoring_human_slug) values
  ('${id(2)}', 'add-deal-note', 'deal', '${id(30)}', 'note', '{"note": "Example agent note"}', 'automation_job', '2024-05-03', 'partner_one'),
  ('${id(2)}', 'add-deal-note', 'deal', '${id(30)}', 'note', '{"note": "Example other note"}', 'automation_job', '2024-05-04', 'partner_one');
 commit;`);
});
after(cleanup);

test("copies calls, meetings, tours and notes, and other kinds as notes that keep their word, listing what has no place", async () => {
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
				"call",
				"2024-01-04 00:00:00+00",
				"Example call\n\nExample call notes",
				id(1),
				null,
				null,
				"2024-03-01 00:00:00+00",
			],
			[
				id(41),
				"meeting",
				"2024-01-05 00:00:00+00",
				"Example tour",
				id(1),
				null,
				null,
				"2024-03-01 00:00:00+00",
			],
			[
				id(42),
				"note",
				"2024-01-06 00:00:00+00",
				"Example note",
				null,
				"agent",
				id(1),
				"2024-03-01 00:00:00+00",
			],
			[
				id(45),
				"note",
				"2024-01-01 00:00:00+00",
				"Text\n\nExample text",
				id(1),
				null,
				null,
				"2024-03-01 00:00:00+00",
			],
			[
				id(47),
				"call",
				"2024-01-02 00:00:00+00",
				"Example call\n\nInformation still missing\nExample figure",
				id(1),
				null,
				null,
				"2024-03-01 00:00:00+00",
			],
			[
				id(48),
				"meeting",
				"2024-01-03 00:00:00+00",
				"Example meeting",
				id(1),
				null,
				null,
				"2024-03-01 00:00:00+00",
			],
			[
				id(50),
				"note",
				"2024-05-01 00:00:00+00",
				"Example deal note",
				id(1),
				null,
				null,
				"2024-05-01 00:00:00+00",
			],
			[
				id(51),
				"note",
				"2024-05-02 00:00:00+00",
				"Recorded next step\n\nExample next step",
				id(1),
				null,
				null,
				"2024-05-02 00:00:00+00",
			],
			[
				id(52),
				"note",
				"2024-05-03 00:00:00+00",
				"Example agent note",
				null,
				"agent",
				id(1),
				"2024-05-03 00:00:00+00",
			],
			[
				id(53),
				"note",
				"2024-05-04 00:00:00+00",
				"Example unsigned note",
				null,
				"agent",
				null,
				"2024-05-04 00:00:00+00",
			],
			[
				id(54),
				"note",
				"2024-01-01 00:00:00+00",
				"Analysis\n\nExample analysis\n\nExample analysis detail",
				id(1),
				null,
				null,
				"2024-03-01 00:00:00+00",
			],
			[
				id(55),
				"note",
				"2024-01-01 00:00:00+00",
				"LOI\n\nExample loi",
				id(1),
				null,
				null,
				"2024-03-01 00:00:00+00",
			],
			[
				id(56),
				"note",
				"2024-01-02 00:00:00+00",
				"Counter Sent\n\nExample counter_sent",
				id(1),
				null,
				null,
				"2024-03-01 00:00:00+00",
			],
			[
				id(57),
				"note",
				"2024-01-03 00:00:00+00",
				"Counter Received\n\nExample counter_received",
				id(1),
				null,
				null,
				"2024-03-01 00:00:00+00",
			],
			[
				id(58),
				"note",
				"2024-01-04 00:00:00+00",
				"Lease Signed\n\nExample lease_signed",
				id(1),
				null,
				null,
				"2024-03-01 00:00:00+00",
			],
		],
	);
	const recorded = "2024-02-01 00:00:00+00";
	assert.deepEqual((await about()).map(Object.values), [
		[id(40), id(30), null, recorded],
		[id(40), null, id(10), recorded],
		[id(41), null, id(11), recorded],
		[id(42), null, id(14), recorded],
		[id(45), id(30), null, recorded],
		[id(47), id(30), null, recorded],
		[id(48), null, id(10), recorded],
		[id(50), id(30), null, "2024-05-01 00:00:00+00"],
		[id(51), id(30), null, "2024-05-02 00:00:00+00"],
		[id(52), id(30), null, "2024-05-03 00:00:00+00"],
		[id(53), id(30), null, "2024-05-04 00:00:00+00"],
		[id(54), id(30), null, recorded],
		[id(55), id(30), null, recorded],
		[id(56), id(30), null, recorded],
		[id(57), id(30), null, recorded],
		[id(58), null, id(10), recorded],
	]);
	assert.deepEqual(reasons(report), [
		"39 kind later_copy_365",
		"43 kind later_copy_365",
		"44 kind later_copy_365",
		"46 activity about_nothing_copied",
		"46 deal_id deal_not_copied",
		"47 detail structured_detail_not_copied",
		"47 lead_id lead_not_copied",
		"49 kind later_copy_365",
		"53 changed_for_user_id agent_user_unknown",
		"59 kind kind_has_no_place",
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

test("a record copied later gains its activity and link on the next run", async () => {
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into deal (id, name, owner_user_id) values ('${id(31)}', 'Example Deal', '${id(1)}');
 insert into party (id, kind, name) values ('${id(15)}', 'person', 'Example Party');
 insert into outside_id (source, value, deal_id) values ('old_system', '${id(31)}', '${id(31)}');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(15)}', '${id(15)}');
 commit;`);
	const report = await run();
	assert.ok(
		!reasons(report).some(
			(r) => r.startsWith("46 ") || r.includes("lead_not_copied"),
		),
	);
	assert.deepEqual(
		(await about())
			.filter((r) => [id(46), id(47)].includes(r.activity_id))
			.map((r) => [r.activity_id, r.deal_id, r.party_id]),
		[
			[id(46), id(31), null],
			[id(47), id(30), null],
			[id(47), null, id(15)],
		],
	);
});

test("keeps reached, attempt-only and unknown outcomes for calls and texts, without overwriting later edits", async () => {
	await db.query(`insert into public.activity (id, kind, occurred_at, recorded_at, updated_at, actor_id, summary,
 deal_id, client_id, lead_id, vendor_id, party_id, detail, owed, connected, email_context) values
 ${[
		activity(60, "call", { deal: 30 }, "null, null, true, null"),
		activity(61, "call", { deal: 30 }, "null, null, false, null"),
		activity(62, "call", { deal: 30 }),
		activity(63, "text", { deal: 30 }, "null, null, true, null"),
		activity(64, "text", { deal: 30 }, "null, null, false, null"),
		activity(65, "text", { deal: 30 }),
 ].join(",\n")};
 update public.activity set summary = '[connected] Spoke with the person' where id = '${id(62)}';`);
	const outcomes = () =>
		rows(`select id, kind, reached from activity
 where id between '${id(60)}' and '${id(65)}' order by id`);
	const snapshot = () =>
		rows(`select to_jsonb(a) as activity from activity a
 where id between '${id(60)}' and '${id(65)}' order by id`);
	const report = await run();
	assert.ok(!report.some((r) => r.field === "connected"));
	assert.deepEqual((await outcomes()).map(Object.values), [
		[id(60), "call", true],
		[id(61), "call", false],
		[id(62), "call", null],
		[id(63), "note", true],
		[id(64), "note", false],
		[id(65), "note", null],
	]);
	const copied = await snapshot();
	assert.deepEqual(await run(), report);
	assert.deepEqual(await snapshot(), copied);
	await db.query(`begin; select set_config('engine.user_id', '${id(1)}', true);
 update activity set reached = case when reached is null then true when reached then false else null end
 where id between '${id(60)}' and '${id(65)}'; commit;`);
	const edited = await snapshot();
	assert.deepEqual(
		(await outcomes()).map((r) => r.reached),
		[false, null, true, false, null, true],
	);
	const history = await rows(
		"select jsonb_agg(c order by id) as all from change c",
	);
	assert.deepEqual(await run(), report);
	assert.deepEqual(await snapshot(), edited);
	assert.deepEqual(
		await rows("select jsonb_agg(c order by id) as all from change c"),
		history,
	);
});

test("keeps what is still missing under its label after the summary and detail, skipping mail and tasks", async () => {
	await db.query(`insert into public.activity (id, kind, occurred_at, recorded_at, updated_at, actor_id, summary,
 deal_id, client_id, lead_id, vendor_id, party_id, detail, owed, connected, email_context) values
 ${[
		activity(70, "call", { deal: 30 }),
		activity(71, "call", { deal: 30 }, `null, E' \\n\\t', null, null`),
		activity(
			72,
			"analysis",
			{ deal: 30 },
			`'Example analysis detail', E' Example figure\\n  Example name', null, null`,
		),
		activity(
			73,
			"email_in",
			{ deal: 30 },
			"null, 'Example figure', null, null",
		),
		activity(74, "note", { deal: 30 }, "null, 'Example figure', null, null"),
		activity(75, "task", { deal: 30 }, "null, 'Example figure', null, null"),
 ].join(",\n")};
 update public.activity set summary = 'Full text of email: Example subject' where id = '${id(74)}';`);
	const snapshot = () =>
		rows(`select id, summary from activity
 where id between '${id(70)}' and '${id(75)}' order by id`);
	const report = await run();
	assert.deepEqual(
		reasons(report.filter((r) => r.old_id >= id(70) && r.old_id <= id(75))),
		[
			"73 kind later_copy_365",
			"74 kind later_copy_365",
			"75 kind kind_has_no_place",
		],
	);
	const copied = await snapshot();
	assert.deepEqual(copied.map(Object.values), [
		[id(70), "Example call"],
		[id(71), "Example call"],
		[
			id(72),
			"Analysis\n\nExample analysis\n\nExample analysis detail\n\nInformation still missing\n Example figure\n  Example name",
		],
	]);
	const history = await rows(
		"select jsonb_agg(c order by id) as all from change c",
	);
	assert.deepEqual(await run(), report);
	assert.deepEqual(await snapshot(), copied);
	assert.deepEqual(
		await rows("select jsonb_agg(c order by id) as all from change c"),
		history,
	);
});

test("keeps every written next step as a recorded note about its deal, making no next step", async () => {
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by)
  values ('${id(32)}', '${id(20)}', 'Example Deal', 'lease', 'loi', 'partner_one', '${id(1)}', '${id(1)}');
 insert into public.deal_note (id, deal_id, kind, text, actor_id, created_at) values
  ('${id(80)}', '${id(30)}', 'next_step', 'Example older step', '${id(1)}', '2024-06-01'),
  ('${id(81)}', '${id(30)}', 'next_step', 'Example superseded step', '${id(2)}', '2024-06-02 00:00:01'),
  ('${id(82)}', '${id(30)}', 'next_step', 'Example current step', '${id(1)}', '2024-06-04'),
  ('${id(83)}', '${id(32)}', 'next_step', 'Example step', '${id(1)}', '2024-06-05'),
  ('${id(84)}', '${id(30)}', 'next_step', 'Example agent step', '${id(2)}', '2024-06-06');
 insert into public.event (actor_id, verb, subject_type, subject_id, field, new_value, cause, occurred_at, recorded_at, sponsoring_human_slug) values
  ('${id(2)}', 'set-next-step', 'deal', '${id(30)}', 'next_step', '{"next_step": "Example superseded step"}', 'automation_job', '2024-06-02', '2024-06-02 00:00:02', 'partner_one'),
  ('${id(1)}', 'update-deal', 'deal', '${id(30)}', 'next_step', '{"next_step": null, "superseded_action_ids": []}', 'human_stated', '2024-06-03', '2024-06-03', null),
  ('${id(2)}', 'set-next-step', 'deal', '${id(30)}', 'next_step', '{"next_step": "Example agent step"}', 'automation_job', '2024-06-05', '2024-06-05', 'partner_one');
 commit;`);
	const snapshot = () =>
		rows(`select id, kind, happened_at::text, summary, changed_by_user_id, changed_by_job, changed_for_user_id
 from activity where id between '${id(80)}' and '${id(84)}' order by id`);
	const report = await run();
	assert.deepEqual(
		reasons(report.filter((r) => r.old_id >= id(80) && r.old_id <= id(84))),
		[
			"83 activity about_nothing_copied",
			"83 deal_id deal_not_copied",
			"84 changed_for_user_id agent_user_unknown",
		],
	);
	const copied = await snapshot();
	assert.deepEqual(copied.map(Object.values), [
		[
			id(80),
			"note",
			"2024-06-01 00:00:00+00",
			"Recorded next step\n\nExample older step",
			id(1),
			null,
			null,
		],
		[
			id(81),
			"note",
			"2024-06-02 00:00:01+00",
			"Recorded next step\n\nExample superseded step",
			null,
			"agent",
			id(1),
		],
		[
			id(82),
			"note",
			"2024-06-04 00:00:00+00",
			"Recorded next step\n\nExample current step",
			id(1),
			null,
			null,
		],
		[
			id(84),
			"note",
			"2024-06-06 00:00:00+00",
			"Recorded next step\n\nExample agent step",
			null,
			"agent",
			null,
		],
	]);
	assert.deepEqual(
		(await about())
			.filter((r) => r.activity_id >= id(80) && r.activity_id <= id(84))
			.map((r) => [r.activity_id, r.deal_id]),
		[id(80), id(81), id(82), id(84)].map((n) => [n, id(30)]),
	);
	assert.deepEqual(await rows("select id from next_step"), []);
	const history = await rows(
		"select jsonb_agg(c order by id) as all from change c",
	);
	assert.deepEqual(await run(), report);
	assert.deepEqual(await snapshot(), copied);
	assert.deepEqual(
		await rows("select jsonb_agg(c order by id) as all from change c"),
		history,
	);
});

test("signs a recorded next step only from the event written with it, even when a waiting write's event overlaps it", async () => {
	const note = (n: number, text: string, at: string) =>
		`('${id(n)}', '${id(30)}', 'next_step', '${text}', '${id(2)}', '${at}')`;
	const event = (text: string, from: string, to: string, sponsor: string) =>
		`('${id(2)}', 'set-next-step', 'deal', '${id(30)}', 'next_step', '{"next_step": "${text}"}', 'automation_job', '${from}', '${to}', ${sponsor})`;
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.deal_note (id, deal_id, kind, text, actor_id, created_at) values
  ${note(85, "Example repeated step", "2024-07-01 00:00:02")}, ${note(86, "Example repeated step", "2024-07-01 00:00:04")},
  ${note(87, "Example reversed step", "2024-07-02 00:00:02")}, ${note(88, "Example reversed step", "2024-07-02 00:00:04")},
  ${note(89, "Example unmatched step", "2024-07-03 00:00:02")}, ${note(90, "Example unmatched step", "2024-07-03 00:00:04")};
 insert into public.event (actor_id, verb, subject_type, subject_id, field, new_value, cause, occurred_at, recorded_at, sponsoring_human_slug) values
  ${event("Example repeated step", "2024-07-01", "2024-07-01 00:00:03", "null")},
  ${event("Example repeated step", "2024-07-01 00:00:01", "2024-07-01 00:00:05", "'partner_one'")},
  ${event("Example reversed step", "2024-07-02", "2024-07-02 00:00:03", "'partner_one'")},
  ${event("Example reversed step", "2024-07-02 00:00:01", "2024-07-02 00:00:05", "null")},
  ${event("Example unmatched step", "2024-07-03 00:00:01", "2024-07-03 00:00:05", "'partner_one'")};
 commit;`);
	const report = await run();
	assert.deepEqual(
		reasons(report.filter((r) => r.old_id >= id(85) && r.old_id <= id(90))),
		["85", "88", "89"].map(
			(n) => `${n} changed_for_user_id agent_user_unknown`,
		),
	);
	const signed =
		await rows(`select id, changed_by_job, changed_for_user_id from activity
 where id between '${id(85)}' and '${id(90)}' order by id`);
	assert.deepEqual(signed.map(Object.values), [
		[id(85), "agent", null],
		[id(86), "agent", id(1)],
		[id(87), "agent", id(1)],
		[id(88), "agent", null],
		[id(89), "agent", null],
		[id(90), "agent", id(1)],
	]);
});
