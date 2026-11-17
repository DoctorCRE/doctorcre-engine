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
// Each row as one line, with fixture ids shortened to their number.
const lines = async (sql: string) =>
	(await rows(sql)).map((r) =>
		r.map((v) => String(v).replace(/^0{8}-0{4}-4000-8000-0{10}/, "")).join(" "),
	);
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
// Today's public.email rows: the mailbox that kept each and its Message-ID.
const messages: [n: number, account: string, header: string][] = [
	[90, JOE, "Tour"],
	[91, DELL, "Tour"],
	[92, JOE, "Visit"],
	[93, DELL, "Visit"],
	[94, JOE, "Lease"],
	[95, JOE, "Question"],
	[96, JOE, "Withdrawn"],
	[97, JOE, "Someone"],
	[98, JOE, "Example"],
];
// biome-ignore format: one old row per line
const mail: Mail[] = [
	{ n: 40, kind: "email_in", time: "10:00", summary: "Email from Example Doctor: Example tour", detail: "Example preview", link: deal, context: context(DOCTOR, "Example tour"), email: 90 },
	{ n: 41, kind: "email_in", time: "10:00", summary: "Email from Example Doctor: Example tour", detail: "Example preview", link: ["client_id", 20], context: context(DOCTOR, "Example tour"), email: 90 },
	{ n: 42, kind: "email_in", time: "10:00", summary: "Email from doctor: Example tour", detail: "Example preview", link: ["lead_id", 21], context: context(DOCTOR, "Example tour"), email: 91 },
	{ n: 52, kind: "email_in", time: "10:00", summary: "Email from doctor: Example tour", link: deal, context: context(DOCTOR, "Example tour") },
	{ n: 43, kind: "email_in", time: "11:00", summary: "Email from Example Doctor: Example lease", detail: "Example short", link: deal, source, email: 94 },
	{ n: 44, kind: "email_in", time: "11:00", summary: "Email from Example Doctor: Example lease", detail: "Example short", link: ["lead_id", 21], source, email: 94 },
	{ n: 45, kind: "note", time: "11:00", summary: "Full text of email: Example lease", detail: "Example full lease text", link: deal, context: `'{"source_activity_id": "${id(44)}"}'` },
	{ n: 46, kind: "email_out", time: "12:00", summary: `Email to ${DOCTOR}: Example question`, detail: "Example short question", link: deal, identity, email: 95 },
	{ n: 47, kind: "note", time: "12:00", summary: "Full text of email: Example question", detail: "Example full question", link: deal },
	{ n: 48, kind: "email_in", time: "13:00", summary: "Email from Example Doctor: Example withdrawn", link: deal, context: context(DOCTOR, "Example withdrawn", ', "lifecycle": {"state": "deleted"}'), email: 96 },
	{ n: 49, kind: "email_in", time: "14:00", summary: "Email from someone", link: deal, email: 97 },
	{ n: 50, kind: "email_out", time: "15:00", summary: "Email to someone: Example", link: ["lead_id", 25], context: context(JOE, "Example"), email: 98 },
	{ n: 51, kind: "note", time: "16:00", summary: "Full text of email: Example lost", link: deal },
	{ n: 53, kind: "call", time: "17:00", summary: "Example call about an email", link: deal, context: context(DOCTOR, "Example") },
	{ n: 56, kind: "email_in", time: "19:00", summary: "Email from Example Doctor: Example visit", link: deal, context: context(DOCTOR, "Example visit", ', "lifecycle": {"state": "deleted"}'), email: 92 },
	{ n: 57, kind: "email_in", time: "19:00", summary: "Email from Example Doctor: Example visit", link: ["client_id", 20], context: `'{"subject": "Example visit"}'`, email: 93 },
];
// Without a Message-ID; 60 and 61 are one email in two mailboxes, and 65 matches two emails that have one.
// biome-ignore format: one old row per line
const withoutId: Mail[] = [
	{ n: 60, kind: "email_in", time: "20:00", summary: "Email from Example Doctor: Example offer", link: deal, context: context(DOCTOR, "Example offer") },
	{ n: 61, kind: "email_in", time: "20:00", summary: "Email from Example Doctor: example offer ", link: ["client_id", 20], source },
	{ n: 62, kind: "email_in", time: "21:00", summary: "Email from someone: Example unknown", link: deal },
	{ n: 63, kind: "email_in", time: "22:00", summary: "Email from Example Doctor: Example twin", link: deal, source, email: 88 },
	{ n: 64, kind: "email_in", time: "22:00", summary: "Email from Example Doctor: Example twin", link: deal, source, email: 89 },
	{ n: 65, kind: "email_in", time: "22:00", summary: "Email from Example Doctor: Example twin", link: deal, source },
];
// Filed after the first copy, with lower ids than the emails they belong to.
// biome-ignore format: one old row per line
const later: Mail[] = [
	{ n: 38, kind: "email_in", time: "10:00", summary: "Email from Example Doctor: Example tour", link: ["client_id", 20], context: context(DOCTOR, "Example tour"), email: 91 },
	{ n: 39, kind: "email_in", time: "11:00", summary: "Email from Example Doctor: Example lease", link: ["client_id", 20], source, email: 94 },
];
const offerWithId: Mail = {
	n: 59,
	kind: "email_in",
	time: "20:00",
	summary: "Email from Example Doctor: Example offer",
	link: ["lead_id", 21],
	source,
	email: 87,
};
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
 insert into public.email values ${messages.map(([n, account, header]) => `('${id(n)}', '${account}', '<${header}@example.test>')`).join(", ")};
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

test("stores each email once by its Message-ID with all its records and its full text, listing what it cannot copy", async () => {
	const report = await run();
	assert.deepEqual(
		await lines(
			"select id, kind, happened_at::time, summary, changed_by_job, changed_for_user_id from activity order by id",
		),
		[
			"40 email 10:00:00 Email from Example Doctor: Example tour mail_capture 01",
			"43 email 11:00:00 Email from Example Doctor: Example lease old_system null",
			`46 email 12:00:00 Email to ${DOCTOR}: Example question old_system null`,
			"57 email 19:00:00 Email from Example Doctor: Example visit old_system null",
		],
	);
	assert.deepEqual(
		await lines(
			"select activity_id, message_id, sender, subject, body from email order by activity_id",
		),
		[
			`40 <Tour@example.test> ${DOCTOR} Example tour Example preview`,
			`43 <Lease@example.test> ${DOCTOR} Example lease Example full lease text`,
			`46 <Question@example.test> ${JOE} Example question Example full question`,
			`57 <Visit@example.test> ${DOCTOR} Example visit `,
		],
		"the sender comes from any row of the email",
	);
	const links = [
		"40 30 null 2024-02-01 00:00:00+00",
		"40 null 10 2024-02-01 00:00:00+00",
		"40 null 11 2024-02-01 00:00:00+00",
		"43 30 null 2024-02-01 00:00:00+00",
		"43 null 11 2024-02-01 00:00:00+00",
		"46 30 null 2024-02-01 00:00:00+00",
		"57 null 10 2024-02-01 00:00:00+00",
	];
	const about = () =>
		lines(
			"select activity_id, deal_id, party_id, created_at::text from activity_about order by activity_id, deal_id, party_id",
		);
	assert.deepEqual(
		await about(),
		links,
		"a mailbox that deleted its copy files nothing",
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
			"56 email_context deleted email_not_live",
		],
	);
	const before = await everything();
	assert.deepEqual(await run(), report, "a rerun lists the same corrections");
	assert.deepEqual(await everything(), before, "a rerun changes no row");

	await db.query(
		`begin; select set_config('engine.job', 'old_system', true); ${later.map(insert).join("\n")} commit;`,
	);
	assert.deepEqual(await run(), report);
	assert.deepEqual(
		await lines(
			"select (select count(*) from activity) activities, (select count(*) from email) emails",
		),
		["4 4"],
		"a row filed since never copies its email twice",
	);
	assert.deepEqual(
		await about(),
		links.toSpliced(4, 0, "43 null 10 2024-02-01 00:00:00+00"),
		"it adds that row's record",
	);
});

test("matches an email without its Message-ID by sender, sent time and subject, once across mailboxes and reruns", async () => {
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.email values ('${id(87)}', '${JOE}', '<Offer@example.test>'), ('${id(88)}', '${JOE}', '<Twin-1@example.test>'),
  ('${id(89)}', '${DELL}', '<Twin-2@example.test>');
 ${withoutId.map(insert).join("\n ")} commit;`);
	const listed = async () =>
		(await run())
			.filter((r) => r.old_id > id(58))
			.map((r) => `${r.old_id.slice(-2)} ${r.field} ${r.value} ${r.reason}`);
	const emails = () =>
		lines(
			`select activity_id, message_id, subject, imported from email where activity_id > '${id(58)}' order by activity_id`,
		);
	const offerLinks = () =>
		lines(
			`select deal_id, party_id from activity_about where activity_id = '${id(60)}' order by deal_id, party_id`,
		);
	assert.deepEqual(await listed(), [
		"62 sender null no_message_id_or_sender",
		"65 message_id null matches_several_message_ids",
	]);
	assert.deepEqual(await emails(), [
		"60 null Example offer true",
		"63 <Twin-1@example.test> Example twin true",
		"64 <Twin-2@example.test> Example twin true",
	]);
	assert.deepEqual(
		await offerLinks(),
		["30 null", "null 10"],
		"both mailboxes' records",
	);
	const before = await everything();
	await run();
	assert.deepEqual(await everything(), before, "a rerun adds nothing");

	await db.query(
		`begin; select set_config('engine.job', 'old_system', true); ${insert(offerWithId)} commit;`,
	);
	await run();
	assert.deepEqual(
		(await emails())[0],
		"60 <Offer@example.test> Example offer true",
		"a row filed since brings the Message-ID",
	);
	assert.deepEqual(await offerLinks(), ["30 null", "null 10", "null 11"]);
	assert.deepEqual(
		await lines(`select count(*) from email where activity_id > '${id(58)}'`),
		["3"],
	);
});
