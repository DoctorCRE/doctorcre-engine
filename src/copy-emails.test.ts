import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-emails.sql");
const { db, setup, cleanup } = copyTest();
const rows = async (sql: string) =>
	(await db.query(sql)).rows.map((r) => Object.values(r));
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
const everything = () =>
	rows(`select (select jsonb_agg(a order by id) from activity a), (select jsonb_agg(e order by activity_id) from email e),
 (select jsonb_agg(l order by activity_id, deal_id, party_id) from activity_about l), (select count(*) from change)`);

const JOE = "partner-one@example.test";
const DELL = "partner-two@example.test";
const DOCTOR = "doctor@example.test";
const context = (sender: string, subject: string, extra = "") =>
	`'{"sender": {"email": "${sender}"}, "subject": "${subject}"${extra}}'`;
const source = `'{"mailbox_owner": "partner_one", "sender_email": "${DOCTOR}"}'`;
const identity = `'{"mailbox_owner": "partner_one", "mailbox_account": "${JOE}", "item_id": "example-46", "subject": "${id(30)}"}'`;
// Today's rows; context, source and identity are SQL literals, and email names the old public.email row.
type Mail = {
	n: number;
	kind: string;
	time: string;
	summary: string;
	detail?: string;
	link: [field: string, record: number];
	context?: string;
	source?: string;
	identity?: string;
	email?: number;
};
const deal: Mail["link"] = ["deal_id", 30];
// biome-ignore format: one old row per line
const mail: Mail[] = [
	{ n: 40, kind: "email_in", time: "10:00", summary: "Email from Example Doctor: Example tour", detail: "Example preview", link: deal, context: context(DOCTOR, "Example tour"), email: 90 },
	{ n: 41, kind: "email_in", time: "10:00", summary: "Email from Example Doctor: Example tour", detail: "Example preview", link: ["client_id", 20], context: context(DOCTOR, "Example tour"), email: 90 },
	{ n: 42, kind: "email_in", time: "10:00", summary: "Email from doctor: Example tour", detail: "Example preview", link: ["lead_id", 21], context: context(DOCTOR, "Example tour"), email: 91 },
	{ n: 52, kind: "email_in", time: "10:00", summary: "Email from doctor: Example tour", link: deal, context: context(DOCTOR, "Example tour") },
	{ n: 43, kind: "email_in", time: "11:00", summary: "Email from Example Doctor: Example lease", detail: "Example short", link: deal, source },
	{ n: 44, kind: "email_in", time: "11:00", summary: "Email from Example Doctor: Example lease", detail: "Example short", link: ["lead_id", 21], source },
	{ n: 45, kind: "note", time: "11:00", summary: "Full text of email: Example lease", detail: "Example full lease text", link: deal, context: `'{"source_activity_id": "${id(44)}"}'` },
	{ n: 46, kind: "email_out", time: "12:00", summary: `Email to ${DOCTOR}: Example question`, detail: "Example short question", link: deal, identity },
	{ n: 47, kind: "note", time: "12:00", summary: "Full text of email: Example question", detail: "Example full question", link: deal },
	{ n: 48, kind: "email_in", time: "13:00", summary: "Email from Example Doctor: Example withdrawn", link: deal, context: context(DOCTOR, "Example withdrawn", ', "lifecycle": {"state": "deleted"}') },
	{ n: 49, kind: "email_in", time: "14:00", summary: "Email from someone", link: deal },
	{ n: 50, kind: "email_out", time: "15:00", summary: "Email to someone: Example", link: ["lead_id", 25], context: context(JOE, "Example") },
	{ n: 51, kind: "note", time: "16:00", summary: "Full text of email: Example lost", link: deal },
	{ n: 53, kind: "call", time: "17:00", summary: "Example call about an email", link: deal, context: context(DOCTOR, "Example") },
];
const insert = (m: Mail) =>
	`insert into public.activity (id, kind, occurred_at, recorded_at, updated_at, actor_id, summary, detail,
  email_context, email_source, email_identity, email_id, ${m.link[0]})
 values ('${id(m.n)}', '${m.kind}', '2024-01-02 ${m.time}Z', '2024-02-01', '2024-03-01', '${id(3)}', '${m.summary}',
  ${m.detail ? `'${m.detail}'` : "null"}, ${m.context ?? "null"}, ${m.source ?? "null"}, ${m.identity ?? "null"},
  ${m.email ? `'${id(m.email)}'` : "null"}, '${id(m.link[1])}');`;

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 create table public.email (id uuid primary key, mailbox_account text not null, message_id text check (message_id = btrim(message_id)));
 alter table public.activity add column email_id uuid references public.email;
 insert into public.email values ('${id(90)}', '${JOE}', '<Tour@example.test>'), ('${id(91)}', '${DELL}', '<Tour@example.test>');
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User'),
  ('${id(3)}', 'example-mail', 'automation', 'Example mail job');
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User'), ('${id(10)}', 'company', 'Example Clinic'),
  ('${id(11)}', 'person', 'Example Doctor');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(10)}', '${id(10)}'), ('old_system', '${id(11)}', '${id(11)}');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) select v, 'person', 'Example Party', '${id(1)}', '${id(1)}'
  from unnest(array['${id(10)}', '${id(11)}', '${id(15)}']::uuid[]) v;
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(20)}', '${id(10)}', '${id(1)}', '${id(1)}');
 insert into public.lead_stage (slug, label) values ('new', 'Example new');
 insert into public.activity_kind (slug, label, is_contact) select s, s, true from unnest(array['email_in', 'email_out', 'note', 'call']) s;
 insert into public.lead (id, party_id, stage, created_by, updated_by) values ('${id(21)}', '${id(11)}', 'new', '${id(1)}', '${id(1)}'),
  ('${id(25)}', '${id(15)}', 'new', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('loi', 'Example LOI');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by)
  values ('${id(30)}', '${id(20)}', 'Example Deal', 'lease', 'loi', 'partner_one', '${id(1)}', '${id(1)}');
 insert into deal (id, name, owner_user_id) values ('${id(30)}', 'Example Deal', '${id(1)}');
 insert into outside_id (source, value, deal_id) values ('old_system', '${id(30)}', '${id(30)}');
 ${mail.map(insert).join("\n ")}
 insert into public.event (actor_id, verb, subject_type, subject_id, new_value, cause, occurred_at, sponsoring_human_slug)
  values ('${id(3)}', 'log-activity', 'deal', '${id(30)}', '{"activity": "${id(40)}"}', 'ingest_email', '2024-01-02', 'partner_one');
 commit;`);
});
after(cleanup);

test("stores each email once with all its records, its full text and its Message-ID, listing what it cannot copy", async () => {
	const report = await run();
	assert.deepEqual(
		await rows(
			"select id, kind, happened_at::text, summary, changed_by_job, changed_for_user_id from activity order by id",
		),
		[
			[
				id(40),
				"email",
				"2024-01-02 10:00:00+00",
				"Email from Example Doctor: Example tour",
				"mail_capture",
				id(1),
			],
			[
				id(43),
				"email",
				"2024-01-02 11:00:00+00",
				"Email from Example Doctor: Example lease",
				"old_system",
				null,
			],
			[
				id(46),
				"email",
				"2024-01-02 12:00:00+00",
				`Email to ${DOCTOR}: Example question`,
				"old_system",
				null,
			],
		],
	);
	assert.deepEqual(
		await rows(
			"select activity_id, message_id, sender, subject, body from email order by activity_id",
		),
		[
			[
				id(40),
				"<Tour@example.test>",
				DOCTOR,
				"Example tour",
				"Example preview",
			],
			[id(43), null, DOCTOR, "Example lease", "Example full lease text"],
			[id(46), null, JOE, "Example question", "Example full question"],
		],
	);
	assert.deepEqual(
		await rows(
			"select activity_id, deal_id, party_id, created_at::text from activity_about order by activity_id, deal_id, party_id",
		),
		[
			[id(40), id(30), null, "2024-02-01 00:00:00+00"],
			[id(40), null, id(10), "2024-02-01 00:00:00+00"],
			[id(40), null, id(11), "2024-02-01 00:00:00+00"],
			[id(43), id(30), null, "2024-02-01 00:00:00+00"],
			[id(43), null, id(11), "2024-02-01 00:00:00+00"],
			[id(46), id(30), null, "2024-02-01 00:00:00+00"],
		],
	);
	assert.deepEqual(
		report.map(
			(r) => `${r.old_id.slice(-2)} ${r.field} ${r.value} ${r.reason}`,
		),
		[
			"48 email_context deleted email_not_live",
			`49 sender null sender_unknown`,
			`50 activity ${id(50)} about_nothing_copied`,
			`50 lead_id ${id(25)} lead_not_copied`,
			`51 activity ${id(51)} full_text_without_its_email`,
			"53 kind call mail_note_has_no_place",
		],
	);
	const before = await everything();
	assert.deepEqual(await run(), report, "a rerun lists the same corrections");
	assert.deepEqual(await everything(), before, "a rerun changes no row");
});
