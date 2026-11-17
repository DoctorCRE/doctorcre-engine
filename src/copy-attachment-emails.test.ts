import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-attachment-emails.sql");
const { db, setup, cleanup } = copyTest();
const rows = async (sql: string) => (await db.query(sql)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	await db.query("begin");
	const result = await db.query(copy);
	await db.query("commit");
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const links = () =>
	rows(
		"select id, email_activity_id, changed_at::text from document order by id",
	);

// Attachments 20 to 25 and the deal files they became; 23 is a partner's own upload.
// Old emails 40 to 44: the Message-ID each mailbox row kept; 40 and 41 are one email in two mailboxes, and 42 never copied.
const messages: [n: number, header: string][] = [
	[40, "First"],
	[41, "First"],
	[42, "Lost"],
	[43, "Second"],
	[44, "Third"],
];
// Reply proposals: attachment, old email row, filed day.
const proposals: [attachment: number, email: number, day: number][] = [
	[20, 40, 1],
	[22, 42, 1],
	[24, 42, 1],
	[24, 43, 2],
	[24, 41, 3],
	[25, 44, 1],
];
const header = Object.fromEntries(messages);
const filed = [20, 21, 22, 24];

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 create table public.email (id uuid primary key, mailbox_account text not null, message_id text);
 alter table public.activity add column email_id uuid references public.email;
 create table ops.requirement_reply_proposal (id uuid primary key default gen_random_uuid(), activity_id uuid not null,
  attachment_id uuid not null, created_at timestamptz not null);
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}');
 insert into deal (id, name, owner_user_id) values ('${id(10)}', 'Example deal', '${id(1)}');
 insert into document_kind (slug, label) values ('other', 'Other');
 insert into document (id, name, r2_bucket, r2_key, content_type, sha256, bytes, deal_id, kind)
 select v, 'Example file.pdf', 'deal_documents', 'files/' || right(v::text, 2), 'application/pdf', repeat(right(v::text, 2), 32), 1000, '${id(10)}', 'other'
 from unnest(array[${[20, 21, 22, 23, 24, 25].map((n) => `'${id(n)}'`).join(", ")}]::uuid[]) v;
 insert into activity (id, kind, happened_at) values ${[41, 43, 44].map((n) => `('${id(n)}', 'email', '2025-01-01')`).join(", ")};
 insert into email (activity_id, message_id, sender, subject, body) values
 ${[41, 43, 44].map((n) => `('${id(n)}', '<${header[n]}@example.test>', 'doctor@example.test', 'Example', 'Example body')`).join(", ")};
 insert into activity_about (activity_id, deal_id) select id, '${id(10)}' from email e join activity a on a.id = e.activity_id;
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User');
 insert into public.activity_kind (slug, label, is_contact) values ('email_in', 'Example email', true);
 insert into public.email values ${messages.map(([n, header]) => `('${id(n + 50)}', 'partner@example.test', '<${header}@example.test>')`).join(", ")};
 insert into public.activity (id, kind, occurred_at, actor_id, summary, email_id)
 select ('00000000-0000-4000-8000-0000000000' || n)::uuid, 'email_in', '2025-01-01', '${id(1)}', 'Email from Example Doctor: Example', ('00000000-0000-4000-8000-0000000000' || n + 50)::uuid
 from unnest(array[${messages.map(([n]) => n).join(", ")}]) n;
 insert into public.attachment (id, subject_type, subject_id, r2_key, filename, mime, sha256, bytes, created_by)
 select ('00000000-0000-4000-8000-0000000000' || n)::uuid, 'deal', '${id(10)}', 'files/' || n,
  'Example file.pdf', 'application/pdf', '${"0".repeat(64)}', 1000, '${id(1)}' from generate_series(20, 25) n;
 insert into public.event (actor_id, verb, subject_type, subject_id, new_value, cause, occurred_at)
 select '${id(1)}', 'attach-deal-file', 'deal', '${id(10)}', jsonb_build_object('attachment_id', ('00000000-0000-4000-8000-0000000000' || n)::uuid), 'ingest_email', '2025-01-01'
 from unnest(array[${filed.join(", ")}]) n;
 insert into ops.requirement_reply_proposal (activity_id, attachment_id, created_at) values
 ${proposals.map(([a, e, day]) => `('${id(e)}', '${id(a)}', '2025-01-0${day}')`).join(", ")};
 commit;`);
});
after(cleanup);

test("a file names the first copied email it arrived with and lists each emailed file whose email cannot be found", async () => {
	const before = await links();
	const report = await run();
	assert.deepEqual(
		(await links()).map((d) => [d.id, d.email_activity_id]),
		[
			[id(20), id(41)],
			[id(21), null],
			[id(22), null],
			[id(23), null],
			[id(24), id(43)],
			[id(25), id(44)],
		],
	);
	assert.deepEqual(
		(await links()).map((d) => d.changed_at),
		before.map((d) => d.changed_at),
		"the link is the file's own, so its stamp stays",
	);
	assert.deepEqual(
		report.map((r) => Object.values(r)),
		[
			[id(21), "email", null, "email_unknown"],
			[id(22), "activity_id", id(42), "email_not_copied"],
		],
	);
});

test("a second run changes nothing and lists the same files", async () => {
	const before = await rows(
		"select (select jsonb_agg(d order by id) from document d), (select count(*) from change)",
	);
	const again = await run();
	assert.deepEqual(
		await rows(
			"select (select jsonb_agg(d order by id) from document d), (select count(*) from change)",
		),
		before,
	);
	assert.deepEqual(
		again.map((r) => Object.values(r)),
		[
			[id(21), "email", null, "email_unknown"],
			[id(22), "activity_id", id(42), "email_not_copied"],
		],
	);
});
