import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-client-files.sql");
const { db, setup, cleanup } = copyTest();
const rows = async (text: string) => (await db.query(text)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	await db.query("begin");
	const result = await db.query(copy);
	await db.query("commit");
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const attachment = (n: number, client = 20, key = `files/${n}`) =>
	`('${id(n)}', 'client', '${id(client)}', '${key}', 'Example file ${n}.pdf', 'application/pdf', '${"b".repeat(64)}', 100, '2025-01-01', '${id(1)}')`;
const files = () => rows("select * from document order by id");
const links = () =>
	rows(
		"select party_id, document_id from party_document order by party_id, document_id",
	);
let report: pg.QueryResultRow[];
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User'),
 ('${id(10)}', 'company', 'Example Client'), ('${id(11)}', 'company', 'Example Second'), ('${id(12)}', 'company', 'Example Survivor');
 insert into app_user values ('${id(1)}');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(10)}', '${id(10)}'),
 ('old_system', '${id(11)}', '${id(11)}'), ('old_system', '${id(13)}', '${id(12)}');
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by)
 select v, 'org', 'Example Client ' || v, '${id(1)}', '${id(1)}' from unnest(array['${id(10)}'::uuid, '${id(11)}', '${id(13)}', '${id(14)}']) v;
 insert into public.client (id, party_id, created_by, updated_by) values
 ('${id(20)}', '${id(10)}', '${id(1)}', '${id(1)}'), ('${id(21)}', '${id(11)}', '${id(1)}', '${id(1)}'),
 ('${id(22)}', '${id(13)}', '${id(1)}', '${id(1)}'), ('${id(23)}', '${id(14)}', '${id(1)}', '${id(1)}'),
 ('${id(24)}', '${id(14)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('closed', 'Example closed');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by)
 values ('${id(30)}', '${id(20)}', 'Example deal', 'lease', 'closed', 'partner_one', '${id(1)}', '${id(1)}');
 update public.client set merged_into = '${id(22)}' where id = '${id(24)}';
 insert into public.attachment (id, subject_type, subject_id, r2_key, filename, mime, sha256, bytes, created_at, created_by) values
 ${attachment(100)}, ${attachment(102, 22)}, ${attachment(103, 24)},
 ${attachment(104, 23)}, ${attachment(105)}, ${attachment(106)}, ${attachment(107)}, ${attachment(108)},
 ${attachment(109)}, ${attachment(110)}, ${attachment(111)}, ${attachment(112)}, ${attachment(113)}, ${attachment(114)}, ${attachment(115)};
 update public.attachment set deleted_at = '2025-02-01' where id = '${id(105)}';
 update public.attachment set mime = ' ' where id = '${id(106)}';

 update public.attachment set subject_type = 'party' where id in ('${id(112)}', '${id(113)}', '${id(114)}');
 update public.attachment set subject_type = 'deal' where id = '${id(115)}';
 insert into document (id, name, r2_bucket, r2_key, content_type, sha256, bytes) values
 ('${id(207)}', 'Example hash conflict.pdf', 'deal_documents', 'files/107', 'application/pdf', '${"c".repeat(64)}', 100),
 ('${id(208)}', 'Example type conflict.pdf', 'deal_documents', 'files/108', 'image/png', '${"b".repeat(64)}', 100),
 ('${id(200)}', 'Example existing.pdf', 'deal_documents', 'files/109', 'application/pdf', '${"b".repeat(64)}', 100),
 ('${id(201)}', 'Example conflict.pdf', 'deal_documents', 'files/110', 'application/pdf', '${"b".repeat(64)}', 99),
 ('${id(111)}', 'Example other.pdf', 'post_media', 'other/111', 'application/pdf', null, null);
 insert into public.doc_template (id, slug, name, source_path, template_version, field_map, created_by)
 values ('${id(300)}', 'example', 'Example template', 'templates/example', '1', '{}', '${id(1)}');
 insert into public.document (id, template_id, client_id, prepared_by, working_attachment, pdf_attachment, note) values
 ('${id(403)}', '${id(300)}', '${id(21)}', '${id(1)}', null, '${id(100)}', null),
 ('${id(400)}', '${id(300)}', '${id(20)}', '${id(1)}', '${id(112)}', '${id(113)}', 'Example generated note'),
 ('${id(401)}', '${id(300)}', '${id(20)}', '${id(1)}', null, null, null),
 ('${id(402)}', '${id(300)}', '${id(20)}', '${id(1)}', '${id(105)}', null, null),
 ('${id(404)}', '${id(300)}', '${id(23)}', '${id(1)}', null, '${id(100)}', null);
 insert into public.document (id, template_id, deal_id, client_id, prepared_by, pdf_attachment)
 values ('${id(405)}', '${id(300)}', '${id(30)}', '${id(20)}', '${id(1)}', '${id(115)}');
 commit;`);
	report = await run();
});
after(cleanup);

test("client and generated working and PDF files keep their bytes, times and author without a deal", async () => {
	assert.deepEqual(
		(await files())
			.filter((f) => f.id === id(100))
			.map((f) => [
				f.id,
				f.name,
				f.r2_bucket,
				f.r2_key,
				f.content_type,
				f.sha256,
				f.bytes,
				f.created_at.toISOString(),
				f.changed_at.toISOString(),
				f.changed_by_user_id,
				f.deal_id,
				f.kind,
			]),
		[
			[
				id(100),
				"Example file 100.pdf",
				"deal_documents",
				"files/100",
				"application/pdf",
				"b".repeat(64),
				"100",
				"2025-01-01T00:00:00.000Z",
				"2025-01-01T00:00:00.000Z",
				id(1),
				null,
				null,
			],
		],
	);
	assert.deepEqual((await links()).map(Object.values), [
		[id(10), id(100)],
		[id(10), id(112)],
		[id(10), id(113)],
		[id(10), id(200)],
		[id(11), id(100)],
		[id(12), id(102)],
		[id(12), id(103)],
	]);
	assert.equal(
		(await files()).filter((f) => f.r2_key === "files/100").length,
		1,
	);
	assert.deepEqual(
		await rows(`select created_at::text, changed_at::text, changed_by_user_id from party_document
 where document_id = '${id(100)}' order by party_id`),
		Array.from({ length: 2 }, () => ({
			created_at: "2025-01-01 00:00:00+00",
			changed_at: "2025-01-01 00:00:00+00",
			changed_by_user_id: id(1),
		})),
	);
});

test("a prepared file keeps its note as written, and files with disagreeing notes wait", async () => {
	assert.deepEqual(
		(await files()).filter((f) => f.note !== null).map((f) => [f.id, f.note]),
		[
			[id(112), "Example generated note"],
			[id(113), "Example generated note"],
		],
	);
	await db.query("begin");
	try {
		await db.query(`update public.document set note = 'Example note A' where id = '${id(403)}';
 update public.document set note = 'Example note B' where id = '${id(404)}'`);
		const result = await db.query(copy);
		assert.ok(Array.isArray(result));
		const waiting: pg.QueryResultRow[] = result.at(-1)?.rows ?? [];
		assert.deepEqual(
			waiting
				.filter((r) => r.reason === "several_notes")
				.map((r) => [r.old_id, r.value]),
			[
				[id(100), "Example note A"],
				[id(100), "Example note B"],
			],
		);
	} finally {
		await db.query("rollback");
	}
});

test("a generated file with both a deal and a client stays out of client files", async () => {
	assert.deepEqual(
		(await files()).filter((f) => f.id === id(115)),
		[],
	);
	assert.deepEqual(
		(await links()).filter((l) => l.document_id === id(115)),
		[],
	);
});

test("a shared file keeps its mapped clients when another client is unmapped", async () => {
	assert.deepEqual(
		(await links()).filter((l) => l.document_id === id(100)).map(Object.values),
		[
			[id(10), id(100)],
			[id(11), id(100)],
		],
	);
	assert.deepEqual(
		report.filter((r) => r.old_id === id(100)),
		[
			{
				old_id: id(100),
				field: "client_id",
				value: id(23),
				reason: "client_not_copied",
			},
		],
	);
});

test("missing bytes, deleted files, unmapped clients and conflicts are listed without invented files or links", async () => {
	assert.deepEqual(
		report.map((r) => [r.old_id, r.reason]),
		[
			[id(100), "client_not_copied"],
			[id(104), "client_not_copied"],
			[id(105), "attachment_deleted"],
			[id(106), "file_incomplete"],
			[id(107), "file_conflict"],
			[id(108), "file_conflict"],
			[id(110), "file_conflict"],
			[id(111), "document_id_taken"],
			[id(401), "no_file"],
			[id(402), "file_deleted"],
			[id(404), "client_not_copied"],
		],
	);
	assert.deepEqual(
		(await files()).map((f) => f.id),
		[100, 102, 103, 111, 112, 113, 200, 201, 207, 208].map(id),
	);
});

test("a rerun changes no files, links or history and keeps the correction list", async () => {
	const before = {
		files: await files(),
		links: await rows(
			"select * from party_document order by party_id, document_id",
		),
		history: await rows("select * from change order by id"),
	};
	assert.deepEqual(await run(), report);
	assert.deepEqual(await files(), before.files);
	assert.deepEqual(
		await rows("select * from party_document order by party_id, document_id"),
		before.links,
	);
	assert.deepEqual(
		await rows("select * from change order by id"),
		before.history,
	);
});

test("client-only generated corrections appear once across the deal and client copiers", async () => {
	await db.query("begin");
	try {
		const result = await db.query(await readSchema("copy-deal-files.sql"));
		assert.ok(Array.isArray(result));
		const combined = [...(result.at(-1)?.rows ?? []), ...report];
		assert.deepEqual(
			combined
				.filter((r) => [400, 401, 402, 403, 404].map(id).includes(r.old_id))
				.map((r) => [r.old_id, r.field, r.value, r.reason]),
			[
				[id(401), "id", id(401), "no_file"],
				[id(402), "working_attachment", id(105), "file_deleted"],
				[id(404), "client_id", id(23), "client_not_copied"],
			],
		);
	} finally {
		await db.query("rollback");
	}
});

test("a later party merge keeps shared files once and a rerun follows the moved map", async () => {
	await db.query(`begin; select set_config('engine.user_id', '${id(1)}', true);
 select merge_party('${id(11)}', '${id(10)}')`);
	const before = await links();
	assert.equal(before.filter((r) => r.document_id === id(100)).length, 1);
	try {
		const result = await db.query(copy);
		assert.ok(Array.isArray(result));
		assert.deepEqual(result.at(-1)?.rows, report);
		assert.deepEqual(await links(), before);
	} finally {
		await db.query("rollback");
	}
});
