import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-deal-file-text.sql");
const { db, setup, cleanup } = copyTest();
const rows = async (text: string) => (await db.query(text)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	await db.query("begin");
	const result = await db.query(copy);
	await db.query("commit");
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const listed = (report: pg.QueryResultRow[], n: number) =>
	report.filter((r) => r.old_id === id(n)).map((r) => [r.reason, r.value]);
const sha = (n: number) => String(n).repeat(32).slice(0, 64);
const attachment = (n: number, deal = 10) =>
	`('${id(n)}', 'deal', '${id(deal)}', 'files/${n}', 'Example file ${n}.pdf', 'application/pdf', '${sha(n)}', ${n}, '${id(1)}')`;
const file = (n: number, deal: number | null = 10) =>
	`('${id(n)}', 'Example file ${n}.pdf', 'deal_documents', 'files/${n}', 'application/pdf', '${sha(n)}', ${n}, ${deal ? `'${id(deal)}', 'other'` : "null, null"})`;
const text = (n: number, status: string, pages: string[], hash = sha(n)) =>
	`('${id(n)}', '${id(10)}', '${hash}', 'page-text.v1', '${status}', '${JSON.stringify(pages)}', 'example-digest', '2025-03-0${n % 9 || 1}')`;
const job = (
	n: number,
	attachment: number,
	contract: object,
	actor = 1,
	hash = sha(attachment),
) =>
	`('${id(n)}', 'example-tenant', '${id(actor)}', '${id(10)}', '${id(attachment)}', '${JSON.stringify(contract)}', '${hash}', '{"abstentions": [], "example": ${n}}', '2025-04-0${n % 9 || 1}')`;
const attempts = () =>
	rows(
		"select id, created_at::text, document_id, deal_id, extracted_at::text, method, extractor_version, model, text_format_version, status, pages, receipt, changed_at::text, changed_by_user_id, changed_by_job, changed_for_user_id from document_extraction order by document_id, method, extractor_version",
	);
let report: pg.QueryResultRow[];
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}');
 insert into deal (id, name, owner_user_id) values ('${id(10)}', 'Example deal', '${id(1)}');
 insert into document_kind values ('other', 'Other');
 insert into document (id, name, r2_bucket, r2_key, content_type, sha256, bytes, deal_id, kind) values
 ${[20, 21, 23, 26, 27, 28, 29, 30].map((n) => file(n)).join(", ")}, ${file(24, null)};
 insert into document_extraction (id, document_id, deal_id, extracted_at, method, extractor_version, text_format_version, status, pages) values
 ('${id(46)}', '${id(23)}', '${id(10)}', '2025-05-01', 'text_layer', 'engine.v1', 'page-text.v2', 'produced', '{"Example engine page"}'),
 ('${id(50)}', '${id(26)}', '${id(10)}', '2025-05-01', 'text_layer', 'page-text.v1', 'page-text.v1', 'produced', '{"Example other page"}'),
 ('${id(51)}', '${id(27)}', '${id(10)}', '2026-01-01', 'text_layer', 'page-text.v1', 'page-text.v1', 'produced', '{"Example same page"}');
 insert into document_extraction (id, document_id, deal_id, extracted_at, method, extractor_version, text_format_version, status, pages, receipt) values
 ('${id(47)}', '${id(20)}', '${id(10)}', '2025-04-02', 'legacy_fact_receipt', 'facts.v5', 'fact-receipt.v1', 'receipt_only', '{}',
  '{"contract": {"extractor_version": "facts.v5"}, "receipt": {"abstentions": [], "example": 47}}');
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User'),
 ('${id(2)}', 'claude', 'automation', 'Example agent');
 insert into public.attachment (id, subject_type, subject_id, r2_key, filename, mime, sha256, bytes, created_by) values
 ${[20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map((n) => attachment(n)).join(", ")};
 update public.attachment set deleted_at = '2025-03-01' where id = '${id(25)}';
 insert into ops.deal_document_text (document_ref, entity_ref, content_hash, text_format_version, status, pages, text_hash, created_at) values
 ${text(20, "produced", ["Example page one", "", "Example page three"])}, ${text(21, "no_text", ["", " "])},
 ${text(22, "produced", ["Example uncopied page"])}, ${text(23, "unavailable", [])},
 ${text(23, "produced", ["Example stale page"], sha(99))}, ${text(24, "produced", ["Example lease page"])},
 ${text(25, "produced", ["Example deleted page"])}, ${text(26, "produced", ["Example different page"])},
 ${text(27, "produced", ["Example same page"])}, ('${id(28)}', '${id(10)}', '${sha(28)}', 'page-text.v1', 'produced', '[123]', 'example-digest', '2025-03-01'),
 ('${id(30)}', '${id(10)}', '${sha(30)}', 'page-text.v1', 'produced', '[["Example nested page"]]', 'example-digest', '2025-03-01'),
 ${text(29, "no_text", ["Example page"])};
 insert into ops.deal_extraction_job (id, organization_tenant_id, actor_id, entity_ref, document_ref, contract, content_hash, receipt, recorded_at) values
 ${job(40, 20, { extractor_version: "facts.v2", model: "example-model" }, 2)}, ${job(41, 20, { extractor_version: "facts.v1" })},
 ${job(42, 20, { extractor_version: "facts.v3" }, 1, sha(99))}, ${job(43, 20, { model: "example-model" })},
 ${job(44, 21, { extractor_version: "facts.v1" })}, ${job(45, 21, { extractor_version: "facts.v1" })},
 ${job(46, 20, { extractor_version: "facts.v4" })}, ${job(47, 20, { extractor_version: "facts.v5" })};
 commit;`);
	report = await run();
});
after(cleanup);

test("page texts become text-layer attempts on their file, keeping pages, status, format and time", async () => {
	const copied = (await attempts()).filter(
		(a) =>
			a.method === "text_layer" && ![id(46), id(50), id(51)].includes(a.id),
	);
	assert.deepEqual(
		copied.map(({ id: _, ...a }) => a),
		[
			{
				created_at: "2025-03-02 00:00:00+00",
				document_id: id(20),
				deal_id: id(10),
				extracted_at: "2025-03-02 00:00:00+00",
				method: "text_layer",
				extractor_version: "page-text.v1",
				model: null,
				text_format_version: "page-text.v1",
				status: "produced",
				pages: ["Example page one", "", "Example page three"],
				receipt: null,
				changed_at: "2025-03-02 00:00:00+00",
				changed_by_user_id: null,
				changed_by_job: "old_system",
				changed_for_user_id: null,
			},
			{
				created_at: "2025-03-03 00:00:00+00",
				document_id: id(21),
				deal_id: id(10),
				extracted_at: "2025-03-03 00:00:00+00",
				method: "text_layer",
				extractor_version: "page-text.v1",
				model: null,
				text_format_version: "page-text.v1",
				status: "no_text",
				pages: ["", " "],
				receipt: null,
				changed_at: "2025-03-03 00:00:00+00",
				changed_by_user_id: null,
				changed_by_job: "old_system",
				changed_for_user_id: null,
			},
			{
				created_at: "2025-03-05 00:00:00+00",
				document_id: id(23),
				deal_id: id(10),
				extracted_at: "2025-03-05 00:00:00+00",
				method: "text_layer",
				extractor_version: "page-text.v1",
				model: null,
				text_format_version: "page-text.v1",
				status: "unavailable",
				pages: [],
				receipt: null,
				changed_at: "2025-03-05 00:00:00+00",
				changed_by_user_id: null,
				changed_by_job: "old_system",
				changed_for_user_id: null,
			},
		],
	);
});

test("fact jobs become receipt-only attempts keeping their id, actor, time, contract and receipt", async () => {
	const receipts = (await attempts()).filter(
		(a) => a.method === "legacy_fact_receipt" && a.id !== id(47),
	);
	assert.deepEqual(
		receipts.map((a) => [
			a.id,
			a.document_id,
			a.extractor_version,
			a.model,
			a.text_format_version,
			a.status,
			a.pages,
			a.extracted_at,
			a.created_at,
			a.changed_by_user_id,
			a.changed_by_job,
		]),
		[
			[
				id(41),
				id(20),
				"facts.v1",
				null,
				"fact-receipt.v1",
				"receipt_only",
				[],
				"2025-04-05 00:00:00+00",
				"2025-04-05 00:00:00+00",
				id(1),
				null,
			],
			[
				id(40),
				id(20),
				"facts.v2",
				"example-model",
				"fact-receipt.v1",
				"receipt_only",
				[],
				"2025-04-04 00:00:00+00",
				"2025-04-04 00:00:00+00",
				null,
				"agent",
			],
		],
	);
	assert.deepEqual(receipts[1]?.receipt, {
		contract: { extractor_version: "facts.v2", model: "example-model" },
		receipt: { abstentions: [], example: 40 },
	});
});

test("texts and jobs that cannot find their file or identity are listed, never guessed", async () => {
	assert.deepEqual(listed(report, 22), [["document_not_copied", id(22)]]);
	assert.deepEqual(listed(report, 23), [["hash_mismatch", sha(99)]]);
	assert.deepEqual(listed(report, 24), [["document_not_copied", id(24)]]);
	assert.deepEqual(listed(report, 25), [
		["attachment_deleted", "2025-03-01 00:00:00+00"],
	]);
	assert.deepEqual(listed(report, 26), [["extraction_conflict", id(26)]]);
	assert.deepEqual(listed(report, 27), [["extraction_conflict", id(27)]]);
	assert.deepEqual(listed(report, 28), [["pages_not_text", null]]);
	assert.deepEqual(listed(report, 30), [["pages_not_text", null]]);
	assert.deepEqual(listed(report, 29), [
		["text_refused", "document_extraction_status_matches_text"],
	]);
	assert.deepEqual(listed(report, 47), [["extraction_conflict", id(47)]]);
	assert.deepEqual(listed(report, 42), [["hash_mismatch", sha(99)]]);
	assert.deepEqual(listed(report, 43), [["contract_incomplete", null]]);
	assert.deepEqual(listed(report, 44), [["extraction_conflict", id(44)]]);
	assert.deepEqual(listed(report, 45), [["extraction_conflict", id(45)]]);
	assert.deepEqual(listed(report, 46), [["extraction_conflict", id(46)]]);
	assert.deepEqual(
		(
			await rows(
				"select document_id, method, extractor_version, pages[1] as first_page from document_extraction order by document_id, method, extractor_version",
			)
		).map(Object.values),
		[
			[id(20), "legacy_fact_receipt", "facts.v1", null],
			[id(20), "legacy_fact_receipt", "facts.v2", null],
			[id(20), "legacy_fact_receipt", "facts.v5", null],
			[id(20), "text_layer", "page-text.v1", "Example page one"],
			[id(21), "text_layer", "page-text.v1", ""],
			[id(23), "text_layer", "engine.v1", "Example engine page"],
			[id(23), "text_layer", "page-text.v1", null],
			[id(26), "text_layer", "page-text.v1", "Example other page"],
			[id(27), "text_layer", "page-text.v1", "Example same page"],
		],
	);
});

test("a repeat changes nothing", async () => {
	const before = await attempts();
	const again = await run();
	assert.deepEqual(await attempts(), before);
	assert.deepEqual(again, report);
});
