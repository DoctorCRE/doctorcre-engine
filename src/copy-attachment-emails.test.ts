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

// Attachments 20 to 27 and the deal files they became; 23 is a partner's own upload, and 26 became file 36.
// Old email rows 40 to 45 and the email each became: 40 and 41 are one email in two mailboxes, 42 never copied, and 45 had no Message-ID.
const became: [row: number, email: number][] = [
	[40, 41],
	[41, 41],
	[43, 43],
	[44, 44],
	[45, 45],
];
// Reply proposals: attachment, old email row, filed day.
const proposals: [attachment: number, email: number, day: number][] = [
	[20, 40, 1],
	[22, 42, 1],
	[24, 42, 1],
	[24, 43, 2],
	[24, 41, 3],
	[25, 44, 1],
	[26, 44, 1],
	[27, 45, 1],
];
const filed = [20, 21, 22, 24];
const emails: [n: number, header: string | null][] = [
	[41, "<First@example.test>"],
	[43, "<Second@example.test>"],
	[44, "<Third@example.test>"],
	[45, null],
];

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 create table ops.requirement_reply_proposal (id uuid primary key default gen_random_uuid(), activity_id uuid not null,
  attachment_id uuid not null, created_at timestamptz not null);
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}');
 insert into deal (id, name, owner_user_id) values ('${id(10)}', 'Example deal', '${id(1)}');
 insert into document_kind (slug, label) values ('other', 'Other');
 insert into document (id, name, r2_bucket, r2_key, content_type, sha256, bytes, deal_id, kind)
 select v, 'Example file.pdf', 'deal_documents', 'files/' || right(v::text, 2), 'application/pdf', repeat(right(v::text, 2), 32), 1000, '${id(10)}', 'other'
 from unnest(array[${[20, 21, 22, 23, 24, 25, 27].map((n) => `'${id(n)}'`).join(", ")}]::uuid[]) v;
 insert into document (id, name, r2_bucket, r2_key, content_type, sha256, bytes, deal_id, kind)
 values ('${id(36)}', 'Example file.pdf', 'deal_documents', 'files/26', 'application/pdf', repeat('36', 32), 1000, '${id(10)}', 'other');
 insert into activity (id, kind, happened_at) values ${emails.map(([n]) => `('${id(n)}', 'email', '2025-01-01')`).join(", ")};
 insert into email (activity_id, message_id, sender, subject, body, imported) values
 ${emails.map(([n, header]) => `('${id(n)}', ${header === null ? "null" : `'${header}'`}, 'doctor@example.test', 'Example', 'Example body', true)`).join(", ")};
 insert into activity_about (activity_id, deal_id) select activity_id, '${id(10)}' from email;
 insert into outside_id (source, value, email_activity_id) values ${became.map(([row, email]) => `('old_system', '${id(row)}', '${id(email)}')`).join(", ")};
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User');
 insert into public.attachment (id, subject_type, subject_id, r2_key, filename, mime, sha256, bytes, created_by)
 select ('00000000-0000-4000-8000-0000000000' || n)::uuid, 'deal', '${id(10)}', 'files/' || n,
  'Example file.pdf', 'application/pdf', '${"0".repeat(64)}', 1000, '${id(1)}' from generate_series(20, 27) n;
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
			[id(27), id(45)],
			[id(36), id(44)],
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
