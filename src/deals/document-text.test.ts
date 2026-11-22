import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const deal = id(10);
const otherDeal = id(11);
const partner = { user: "alex" };
const pages = ["First line\nSecond line", "", "Last page"];

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${id(1)}', 'person', 'Alex Example'), ('${id(2)}', 'person', 'Casey Example');
		insert into app_user (id, slug) values ('${id(1)}', 'alex'), ('${id(2)}', 'casey');
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'Example lease', '${id(1)}'), ('${otherDeal}', 'Example purchase', '${id(2)}');
		insert into document_kind (slug, label) values ('other', 'Other');
		insert into document (id, deal_id, name, r2_key, content_type, sha256, bytes, kind)
			select doc.id, doc.deal_id, 'Example.pdf', 'example/' || doc.id, 'application/pdf',
				repeat('a', 64), 12, 'other'
			from (values
				('${id(20)}'::uuid, '${deal}'::uuid), ('${id(21)}', '${deal}'), ('${id(22)}', '${deal}'),
				('${id(23)}', '${deal}'), ('${id(24)}', '${deal}'), ('${id(25)}', '${deal}'),
				('${id(26)}', '${otherDeal}')
			) doc(id, deal_id);
		insert into document_extraction
			(document_id, deal_id, extracted_at, created_at, method, extractor_version, text_format_version, status, pages, receipt)
		values
			('${id(20)}', '${deal}', '2026-01-02', '2026-01-04', 'text_layer', 'v1', 'page-text.v1',
				'produced', array[E'First line\\nSecond line', '', 'Last page'], null),
			('${id(21)}', '${deal}', '2026-01-02', '2026-01-04', 'text_layer', 'v1', 'page-text.v1',
				'no_text', array[' ', ''], null),
			('${id(22)}', '${deal}', '2026-01-02', '2026-01-04', 'text_layer', 'v1', 'page-text.v1',
				'unavailable', '{}', null),
			('${id(23)}', '${deal}', '2026-01-02', '2026-01-04', 'legacy_fact_receipt', 'v1', 'fact-receipt.v1',
				'receipt_only', '{}', '{"note":"Example receipt"}'),
			('${id(25)}', '${deal}', '2026-01-02', '2026-01-06', 'text_layer', 'v1', 'page-text.v1',
				'produced', array['Older text stored later'], null),
			('${id(25)}', '${deal}', '2026-01-03', '2026-01-04', 'text_layer', 'v2', 'page-text.v1',
				'produced', array['Newest usable text'], null),
			('${id(25)}', '${deal}', '2026-01-04', '2026-01-05', 'text_layer', 'v3', 'page-text.v1',
				'unavailable', '{}', null),
			('${id(26)}', '${otherDeal}', '2026-01-02', '2026-01-04', 'text_layer', 'v1', 'page-text.v1',
				'produced', array['Text on a different deal'], null);
		commit;`);
});

after(async () => {
	await db.query("rollback");
	await cleanup();
});

const binding = { DEALS_READ_SCHEMA: "next" };
const read = (dealId: string, documentId: string, caller = partner) =>
	request(caller, `deals/${dealId}/documents/${documentId}/text`, {}, binding);

test("either partner can read the ordered pages, including blank pages", async () => {
	for (const caller of [partner, { user: "casey" }]) {
		const response = await read(deal, id(20), caller);
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { pages });
	}
});

for (const [status, n] of Object.entries({
	no_text: 21,
	unavailable: 22,
	receipt_only: 23,
	"no attempt": 24,
})) {
	test(`a document with ${status} returns empty pages`, async () => {
		const response = await read(deal, id(n));
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), { pages: [] });
	});
}

test("the newest produced extraction wins by extraction time", async () => {
	const response = await read(deal, id(25));
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { pages: ["Newest usable text"] });
});

test("a document can only be read on the deal it belongs to", async () => {
	const allowed = await read(otherDeal, id(26));
	assert.equal(allowed.status, 200);
	assert.deepEqual(await allowed.json(), {
		pages: ["Text on a different deal"],
	});

	const refused = await read(deal, id(26));
	assert.equal(refused.status, 404);
	assert.partialDeepStrictEqual(await refused.json(), { error: "not_found" });
});

test("a session without deal page access cannot read a deal's document text", async () => {
	const caller = { user: "unprovisioned" };
	const detail = await request(caller, `deals/${deal}`, {}, binding);
	assert.equal(detail.status, 422);
	const refused = await read(deal, id(20), caller);
	assert.equal(refused.status, detail.status);
	assert.partialDeepStrictEqual(await refused.json(), {
		error: "unauthenticated",
	});
	assert.equal((await read(deal, id(20))).status, 200);
});
