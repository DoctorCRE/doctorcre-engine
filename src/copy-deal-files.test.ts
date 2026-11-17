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
const copy = await sql("copy-deal-files.sql");
const name = `copy_deal_files_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (text: string) => (await db.query(text)).rows;
const mapping = `create temp table copy_template_kind (template_slug text primary key, kind text not null) on commit drop;
 insert into copy_template_kind values ('example-loi', 'loi'), ('example-bad', 'brochure'), ('example-invoice', 'invoice');`;
const run = async (setup = ""): Promise<pg.QueryResultRow[]> => {
	await db.query(`begin; ${setup}`);
	const result = await db.query(copy);
	await db.query("commit");
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const reasons = (report: pg.QueryResultRow[], n: number) =>
	report.filter((r) => r.old_id === id(n)).map((r) => r.reason);
const sha = (n: number) => String(n).repeat(22).slice(0, 64);
const attachment = (n: number, deal = 10, subject = "deal") =>
	`('${id(n)}', '${subject}', '${id(deal)}', 'files/${n}', 'Example file ${n}.pdf', 'application/pdf', '${sha(n)}', ${n}, '2025-01-0${n % 9 || 1}', '${id(1)}')`;
const deliverable = (n: number, key: string, state = "finalized") =>
	`('${id(n)}', 'example-tenant', '${id(10)}', 'Example deliverable ${n}.pdf', 'application/pdf', ${n}, '${sha(n)}', '${key}', 'partner_one', '2025-02-01', ${state === "finalized" ? "'2025-02-02'" : "null"}, '${state}', ${state === "finalized" ? "2" : "0"}, '${state === "finalized" ? "shared" : "private"}')`;
const documents = () =>
	rows(
		"select id, created_at::text, name, r2_bucket, r2_key, content_type, sha256, bytes, deal_id, kind, version, supersedes_id, changed_at::text, changed_by_user_id from document order by id",
	);
let report: pg.QueryResultRow[];
before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User');
 insert into app_user values ('${id(1)}');
 insert into deal (id, name, owner_user_id) values ('${id(10)}', 'Example deal', '${id(1)}'), ('${id(11)}', 'Example other deal', '${id(1)}');
 insert into document (id, name, r2_bucket, r2_key, content_type, sha256, bytes) values
 ('${id(218)}', 'Example lease 218.pdf', 'deal_documents', 'files/218', 'application/pdf', '${sha(218)}', 218),
 ('${id(219)}', 'Example lease 219.pdf', 'deal_documents', 'files/219', 'application/pdf', '${sha(219)}', 1),
 ('${id(224)}', 'Example photo', 'post_media', 'photos/224', 'image/png', null, null);
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) values ('${id(6)}', 'org', 'Example Client', '${id(1)}', '${id(1)}');
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(3)}', '${id(6)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('closed', 'Example closed');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by) select v, '${id(3)}', 'Example deal', 'lease', 'closed', 'partner_one', '${id(1)}', '${id(1)}'
 from unnest(array['${id(10)}'::uuid, '${id(11)}'::uuid, '${id(12)}'::uuid]) v;
 insert into ops.deal_deliverable (id, organization_tenant_id, deal_id, filename, mime, bytes, sha256, object_key, created_by, created_at, finalized_at, state, version, visibility) values
 ${deliverable(200, "deliverables/example-tenant/10/200")}, ${deliverable(201, "deliverables/example-tenant/10/201", "started")},
 ${deliverable(202, "files/202")}, ${deliverable(215, "files/216")}, ${deliverable(228, "files/228")},
 ${deliverable(229, "deliverables/example-tenant/10/229")};
 insert into public.attachment (id, subject_type, subject_id, r2_key, filename, mime, sha256, bytes, created_at, created_by) values
 ${[202, 210, 211, 218, 219, 220, 221, 222, 226, 227, 228, 229].map((n) => attachment(n)).join(", ")},
 ${attachment(230, 3, "client")}, ${attachment(231)}, ${attachment(212, 12)}, ${attachment(216)}, ${attachment(223, 3, "client")}, ${attachment(225, 11)};
 insert into public.attachment (id, subject_type, subject_id, r2_key, filename, mime, sha256, bytes, created_by) values
 ('${id(217)}', 'deal', '${id(10)}', 'files/217', 'Example file 217.pdf', ' ', 'not-a-hash', 217, '${id(1)}'),
 ('${id(224)}', 'deal', '${id(10)}', 'files/224', 'Example file 224.pdf', 'application/pdf', '${sha(224)}', 224, '${id(1)}');
 insert into public.lease (id, deal_id, doc_attachment, evidence_kind, created_by) values
 ('${id(500)}', '${id(10)}', '${id(218)}', 'executed_lease', '${id(1)}'),
 ('${id(501)}', '${id(10)}', '${id(230)}', 'lease_amendment', '${id(1)}'),
 ('${id(502)}', '${id(10)}', '${id(231)}', 'lease_abstract', '${id(1)}'),
 ('${id(503)}', '${id(10)}', null, 'executed_lease', '${id(1)}');
 update public.attachment set filename = 'Example executed lease.pdf' where id = '${id(231)}';
 update public.attachment set deleted_at = '2025-03-01' where id in ('${id(211)}', '${id(228)}');
 insert into public.doc_template (id, slug, name, source_path, template_version, field_map, created_by) values
 ('${id(300)}', 'example-loi', 'Example LOI', 'templates/loi', '1', '{}', '${id(1)}'),
 ('${id(301)}', 'example-unmapped', 'Example letter', 'templates/letter', '1', '{}', '${id(1)}'),
 ('${id(302)}', 'example-bad', 'Example brochure', 'templates/brochure', '1', '{}', '${id(1)}'),
 ('${id(303)}', 'example-invoice', 'Example invoice', 'templates/invoice', '1', '{}', '${id(1)}');
 insert into public.document (id, template_id, deal_id, client_id, prepared_by, working_attachment, pdf_attachment, note) values
 ('${id(400)}', '${id(300)}', '${id(10)}', null, '${id(1)}', '${id(220)}', '${id(221)}', 'Example note'),
 ('${id(401)}', '${id(301)}', '${id(10)}', null, '${id(1)}', '${id(211)}', '${id(222)}', ' '),
 ('${id(402)}', '${id(300)}', null, '${id(3)}', '${id(1)}', null, '${id(223)}', null),
 ('${id(403)}', '${id(300)}', '${id(10)}', null, '${id(1)}', null, null, null),
 ('${id(404)}', '${id(300)}', '${id(10)}', null, '${id(1)}', null, '${id(225)}', null),
 ('${id(405)}', '${id(300)}', '${id(10)}', null, '${id(1)}', null, '${id(226)}', 'Example note A'),
 ('${id(406)}', '${id(303)}', '${id(10)}', null, '${id(1)}', null, '${id(226)}', 'Example note B'),
 ('${id(407)}', '${id(302)}', '${id(10)}', null, '${id(1)}', null, '${id(227)}', null),
 ('${id(408)}', '${id(300)}', null, null, '${id(1)}', null, '${id(223)}', null),
 ('${id(409)}', '${id(301)}', '${id(10)}', null, '${id(1)}', null, '${id(218)}', 'Example source note');
 commit;`);
	report = await run(mapping);
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("finalized deliverables and deal attachments become first versions on their deal in the legacy bucket", async () => {
	const copied = await documents();
	assert.deepEqual(
		copied.filter((d) => [id(200), id(210)].includes(d.id)),
		[
			{
				id: id(200),
				created_at: "2025-02-01 00:00:00+00",
				name: "Example deliverable 200.pdf",
				r2_bucket: "deal_documents",
				r2_key: "deliverables/example-tenant/10/200",
				content_type: "application/pdf",
				sha256: sha(200),
				bytes: "200",
				deal_id: id(10),
				kind: "other",
				version: 1,
				supersedes_id: null,
				changed_at: "2025-02-02 00:00:00+00",
				changed_by_user_id: id(1),
			},
			{
				id: id(210),
				created_at: "2025-01-03 00:00:00+00",
				name: "Example file 210.pdf",
				r2_bucket: "deal_documents",
				r2_key: "files/210",
				content_type: "application/pdf",
				sha256: sha(210),
				bytes: "210",
				deal_id: id(10),
				kind: "other",
				version: 1,
				supersedes_id: null,
				changed_at: "2025-01-03 00:00:00+00",
				changed_by_user_id: id(1),
			},
		],
	);
	assert.deepEqual(reasons(report, 200), ["kind_unclassified"]);
	assert.ok(!copied.some((d) => d.id === id(201)), "an unfinished upload");
	assert.deepEqual(reasons(report, 201), []);
});

test("rows naming one key are one file whatever their names, and a lease's stored source file is filed to its deal", async () => {
	assert.deepEqual(
		await rows(
			"select id, r2_key, deal_id, kind, name from document where r2_key in ('files/202', 'files/218') order by id",
		),
		[
			{
				id: id(202),
				r2_key: "files/202",
				deal_id: id(10),
				kind: "other",
				name: "Example file 202.pdf",
			},
			{
				id: id(218),
				r2_key: "files/218",
				deal_id: id(10),
				kind: "lease",
				name: "Example lease 218.pdf",
			},
		],
	);
});

test("lease evidence types file source attachments without guessing from names or inventing a missing file", async () => {
	assert.deepEqual(
		(
			await rows(
				`select id, deal_id, kind from document where id in ('${id(218)}', '${id(230)}', '${id(231)}') order by id`,
			)
		).map(Object.values),
		[
			[id(218), id(10), "lease"],
			[id(230), id(10), "amendment"],
			[id(231), id(10), "other"],
		],
	);
	assert.deepEqual(reasons(report, 218), []);
	assert.deepEqual(reasons(report, 230), []);
	assert.deepEqual(reasons(report, 231), ["kind_unclassified"]);
	assert.deepEqual(
		(
			await rows(
				`select id from document where deal_id = '${id(10)}' order by id`,
			)
		).map((r) => r.id),
		[200, 202, 210, 218, 220, 221, 222, 227, 230, 231].map(id),
	);
});

test("generated files take their template's reviewed kind and keep the generated id on their deal", async () => {
	assert.deepEqual(
		(
			await rows(
				`select id, kind, deal_id from document where id in ('${id(220)}', '${id(221)}', '${id(222)}', '${id(227)}') order by id`,
			)
		).map(Object.values),
		[
			[id(220), "loi", id(10)],
			[id(221), "loi", id(10)],
			[id(222), "other", id(10)],
			[id(227), "other", id(10)],
		],
	);
	assert.deepEqual(
		await rows("select source, value, deal_id from outside_id order by value"),
		[
			{ source: "old_generated_document", value: id(400), deal_id: id(10) },
			{ source: "old_generated_document", value: id(401), deal_id: id(10) },
			{ source: "old_generated_document", value: id(407), deal_id: id(10) },
			{ source: "old_generated_document", value: id(409), deal_id: id(10) },
		],
	);
	assert.deepEqual(
		await rows("select slug, label from document_kind order by slug"),
		[
			{ slug: "amendment", label: "Amendment" },
			{ slug: "counter", label: "Counter" },
			{ slug: "invoice", label: "Invoice" },
			{ slug: "lease", label: "Lease" },
			{ slug: "loi", label: "LOI" },
			{ slug: "other", label: "Other" },
		],
	);
});

test("a prepared file keeps its note as written, and a blank note stays empty", async () => {
	assert.deepEqual(
		(
			await rows(
				`select id, note from document where deal_id = '${id(10)}' and (note is not null or id = '${id(222)}') order by id`,
			)
		).map(Object.values),
		[
			[id(218), "Example source note"],
			[id(220), "Example note"],
			[id(221), "Example note"],
			[id(222), null],
		],
	);
});

test("files that cannot map are listed with a reason and not stored, never guessed", async () => {
	assert.deepEqual(reasons(report, 211), ["attachment_deleted"]);
	assert.deepEqual(reasons(report, 212), ["deal_not_copied"]);
	assert.deepEqual(reasons(report, 215), ["file_conflict"]);
	assert.deepEqual(reasons(report, 216), ["file_conflict"]);
	assert.deepEqual(reasons(report, 217), ["file_incomplete"]);
	assert.deepEqual(reasons(report, 219), ["file_conflict"]);
	assert.deepEqual(reasons(report, 224), ["document_id_taken"]);
	assert.deepEqual(reasons(report, 228), ["attachment_deleted"]);
	assert.deepEqual(
		report.filter((r) => r.old_id === id(229)).map((r) => [r.reason, r.value]),
		[["document_id_taken", id(229)]],
	);
	assert.deepEqual(reasons(report, 225), ["file_conflict"]);
	assert.deepEqual(
		report.filter((r) => r.old_id === id(226)).map((r) => [r.reason, r.value]),
		[
			["several_kinds", "invoice"],
			["several_kinds", "loi"],
			["several_notes", "Example note A"],
			["several_notes", "Example note B"],
		],
	);
	assert.deepEqual(reasons(report, 302), ["unknown_kind"]);
	assert.deepEqual(reasons(report, 400), []);
	assert.deepEqual(reasons(report, 401), ["file_deleted"]);
	assert.deepEqual(reasons(report, 402), []);
	assert.deepEqual(reasons(report, 408), ["no_deal"]);
	assert.deepEqual(reasons(report, 403), ["no_file"]);
	assert.deepEqual(
		await rows(
			`select deal_id from document where r2_key in ('files/212', 'files/216', 'files/217', 'files/224', 'files/225', 'files/226', 'files/228', 'files/229') or id = '${id(229)}'`,
		),
		[],
	);
	assert.deepEqual(
		await rows(`select deal_id, bytes from document where id = '${id(219)}'`),
		[{ deal_id: null, bytes: "1" }],
	);
});

for (const [evidenceKind, fileKind] of [
	["lease_amendment", "amendment"],
	["lease_abstract", "other"],
]) {
	test(`an executed lease and ${evidenceKind} on one source file are listed and left unfiled`, async () => {
		await db.query("begin");
		try {
			await db.query(`insert into public.attachment (id, subject_type, subject_id, r2_key, filename, mime, sha256, bytes, created_at, created_by) values ${attachment(234)};
 insert into public.lease (deal_id, doc_attachment, evidence_kind, created_by) values
 ('${id(10)}', '${id(234)}', 'executed_lease', '${id(1)}'),
 ('${id(10)}', '${id(234)}', '${evidenceKind}', '${id(1)}');`);
			const result = await db.query(copy);
			assert.ok(Array.isArray(result));
			const report: pg.QueryResultRow[] = result.at(-1)?.rows ?? [];
			assert.deepEqual(
				report
					.filter((r) => r.old_id === id(234))
					.map((r) => [r.reason, r.value]),
				["lease", fileKind].sort().map((kind) => ["several_kinds", kind]),
			);
			assert.deepEqual(
				await rows(`select id from document where r2_key = 'files/234'`),
				[],
			);
		} finally {
			await db.query("rollback");
		}
	});
}

test("a repeat with the same template list changes nothing", async () => {
	const before = {
		documents: await documents(),
		outside: await rows("select * from outside_id order by value"),
	};
	const again = await run(mapping);
	assert.deepEqual(await documents(), before.documents);
	assert.deepEqual(
		await rows("select * from outside_id order by value"),
		before.outside,
	);
	assert.deepEqual(again, report);
});
