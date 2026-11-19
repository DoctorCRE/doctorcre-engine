import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, type TestContext, test } from "node:test";
import { doorTest } from "./test-door.ts";

Object.assign(globalThis, {
	FixedLengthStream: class extends TransformStream {
		constructor(_length: number) {
			super();
		}
	},
});

const { db, setup, cleanup, request } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const json = async (response: Response): Promise<Record<string, unknown>> => {
	const body: Record<string, unknown> = await response.json();
	return body;
};
const files = new Map<
	string,
	{ data: Uint8Array; httpMetadata: { contentType: string } }
>();
let heads = 0;
const bucket = {
	async head(key: string) {
		heads++;
		const file = files.get(key);
		return file
			? { size: file.data.length, httpMetadata: file.httpMetadata }
			: null;
	},
	async get(key: string) {
		const file = files.get(key);
		return file ? { body: new Blob([file.data]).stream() } : null;
	},
	async put(
		key: string,
		stream: ReadableStream<Uint8Array>,
		options: { httpMetadata: { contentType: string }; sha256: string },
	) {
		if (files.has(key)) return null;
		const data = new Uint8Array(await new Response(stream).arrayBuffer());
		if (createHash("sha256").update(data).digest("hex") !== options.sha256)
			throw new Error("R2 put failed: (10037) checksum mismatch");
		files.set(key, { data, httpMetadata: options.httpMetadata });
		return {};
	},
	async delete(key: string) {
		files.delete(key);
	},
};
const caller = { job: "mail_capture", for_user: "alex" };
const pdf = new TextEncoder().encode("%PDF-1.7\nExample file\n%%EOF");
const hash = createHash("sha256").update(pdf).digest("hex");
const bindings = { DEAL_DOCUMENTS: bucket, POST_MEDIA: bucket };
const tie = (args: object = {}) =>
	request(
		caller,
		"attachments",
		{
			method: "POST",
			body: JSON.stringify({
				idempotency_key: randomUUID(),
				sha256: hash,
				name: "Example's plan.pdf",
				message_id: "Example@example.test",
				deal_id: id(2),
				kind: "other",
				...args,
			}),
		},
		bindings,
	);
const upload = (
	args: {
		data?: Uint8Array;
		hash?: string;
		length?: string;
		user?: boolean;
	} = {},
) =>
	request(
		args.user ? { user: "alex" } : caller,
		`files/${args.hash ?? hash}`,
		{
			method: "PUT",
			headers:
				args.length === "missing"
					? {}
					: {
							"Content-Length":
								args.length ?? String((args.data ?? pdf).length),
						},
			body: args.data ?? pdf,
		},
		bindings,
	);

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
	insert into party (id, kind, name) values ('${id(1)}', 'person', 'Alex Example'), ('${id(6)}', 'person', 'Casey Example');
	insert into app_user (id, slug) values ('${id(1)}', 'alex'), ('${id(6)}', 'casey');
	insert into deal (id, name, owner_user_id) values ('${id(2)}', 'Example Deal', '${id(6)}'), ('${id(3)}', 'Another Deal', '${id(1)}');
	insert into document_kind values ('other', 'Other'), ('lease', 'Lease');
	insert into activity (id, kind, happened_at) values ('${id(4)}', 'email', now()), ('${id(5)}', 'email', now());
	insert into email (activity_id, message_id, sender, subject, body) values ('${id(4)}', 'Example@example.test', 'sender@example.test', 'Example', 'Example body'), ('${id(5)}', 'Second@example.test', 'sender@example.test', 'Second', 'Second body');
	insert into activity_about (activity_id, deal_id) values ('${id(4)}', '${id(2)}'), ('${id(5)}', '${id(2)}'); commit;`);
});
after(cleanup);

const fileToDeal = (
	sha256: string,
	args: object = {},
	deal = id(2),
	storage = bucket,
) =>
	request(
		{ user: "alex" },
		`deals/${deal}/documents`,
		{
			method: "POST",
			body: JSON.stringify({
				idempotency_key: randomUUID(),
				sha256,
				name: "Example lease.pdf",
				kind: "lease",
				...args,
			}),
		},
		{ DEAL_DOCUMENTS: storage },
	);

async function uploadDealFile(t: TestContext, label: string) {
	const data = new TextEncoder().encode(`%PDF-1.7\n${label}\n%%EOF`);
	const sha256 = createHash("sha256").update(data).digest("hex");
	assert.equal((await upload({ data, hash: sha256, user: true })).status, 201);
	t.after(() => {
		files.delete(`sha256/${sha256}`);
	});
	return sha256;
}

async function assertRefusal(response: Response, error: string, status = 409) {
	const answer = await json(response);
	assert.deepEqual([response.status, answer.error], [status, error]);
	return answer;
}

test("a signed-in partner files an upload and sees both versions on the deal", async (t) => {
	const sha256 = await uploadDealFile(t, "Original lease");
	const first = await fileToDeal(sha256);
	assert.equal(first.status, 201);
	const { document_id } = await json(first);
	const replacement = await uploadDealFile(t, "Replacement lease");
	const args = { supersedes_id: document_id, idempotency_key: randomUUID() };
	const response = await fileToDeal(replacement, args);
	assert.equal(response.status, 201);
	const filed = await json(response);
	assert.equal(typeof filed.filed_at, "string");
	assert.deepEqual(filed, {
		document_id: filed.document_id,
		deal_id: id(2),
		name: "Example lease.pdf",
		kind: "lease",
		sha256: replacement,
		supersedes_id: document_id,
		filed_at: filed.filed_at,
		filed_by: "alex",
	});
	for (const [retry, expected] of [
		[args, { ...filed, replayed: true }],
		[{ supersedes_id: document_id }, filed],
	] as const) {
		const result = await fileToDeal(replacement, retry);
		assert.equal(result.status, 200);
		assert.deepEqual(await json(result), expected);
	}
	await assertRefusal(
		await fileToDeal(replacement, { ...args, name: "Changed.pdf" }),
		"key_reuse",
	);
	await assertRefusal(
		await fileToDeal("1".repeat(64), { supersedes_id: document_id }),
		"predecessor_replaced",
	);

	for (const user of ["alex", "casey"]) {
		const detail = await request(
			{ user },
			`deals/${id(2)}`,
			{},
			{
				DEALS_READ_SCHEMA: "next",
			},
		);
		assert.equal(detail.status, 200);
		assert.partialDeepStrictEqual(await json(detail), {
			documents: [
				{
					id: filed.document_id,
					version: 2,
					actor: "alex",
					prepared_at: filed.filed_at,
				},
				{ id: document_id, version: 1, actor: "alex" },
			],
		});
	}
});

test("signed-in filing checks the existing hash before checking replacement lineage", async (t) => {
	const sha256 = await uploadDealFile(t, "Shared lease");
	const first = await json(await fileToDeal(sha256, {}, id(3)));
	const crossed = await fileToDeal(sha256, {}, id(2));
	assert.equal(crossed.status, 201);
	const { document_id } = await json(crossed);
	assert.notEqual(document_id, first.document_id);
	const alternative = await uploadDealFile(t, "Another lease");
	const other = await json(
		await fileToDeal(alternative, { kind: "other" }, id(3)),
	);
	const missing = "1".repeat(64);
	for (const [deal, hash, args, status, error] of [
		[id(3), sha256, { supersedes_id: id(99) }, 409, "already_filed"],
		[id(3), sha256, { kind: "other" }, 409, "already_filed"],
		[id(3), sha256, { name: "Other.pdf" }, 409, "already_filed"],
		[id(99), sha256, {}, 404, "not_found"],
		[id(3), missing, {}, 409, "file_not_uploaded"],
		[id(3), missing, { supersedes_id: id(99) }, 409, "predecessor_not_found"],
		[
			id(3),
			missing,
			{ supersedes_id: document_id },
			409,
			"predecessor_not_found",
		],
		[
			id(3),
			missing,
			{ supersedes_id: other.document_id },
			409,
			"predecessor_kind_differs",
		],
		[id(3), missing, { kind: "unknown" }, 400, "invalid_field_value"],
		[id(3), missing, { name: " " }, 400, "invalid_field_value"],
		[id(3), "invalid", {}, 400, "invalid_field_value"],
	] as const) {
		const answer = await assertRefusal(
			await fileToDeal(hash, args, deal),
			error,
			status,
		);
		if (error === "already_filed")
			assert.equal(answer.document_id, first.document_id);
	}
	const job = await request(
		caller,
		`deals/${id(3)}/documents`,
		{ method: "POST", body: "{}" },
		bindings,
	);
	assert.equal(job.status, 404);
});

test("copied filings keep a shared first match and accept uppercase predecessor IDs", async (t) => {
	const deal = id(8);
	const sha256 = "a".repeat(64);
	const earliest = "a0000000-0000-4000-8000-000000000001";
	const tied = "b0000000-0000-4000-8000-000000000001";
	await db.query(`begin; set local engine.job = 'old_system';
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Imported Example Deal', '${id(1)}');
		insert into document (id, deal_id, name, r2_bucket, r2_key, content_type, sha256, bytes, kind, created_at) values
		('${id(7)}', '${deal}', 'Example lease.pdf', 'deal_documents', 'legacy/later', 'application/pdf', '${sha256}', 15, 'lease', '2026-01-02'),
		('${tied}', '${deal}', 'Example lease.pdf', 'deal_documents', 'legacy/tied', 'application/pdf', '${sha256}', 15, 'lease', '2026-01-01'),
		('${earliest}', '${deal}', 'Example lease.pdf', 'deal_documents', 'legacy/first', 'application/pdf', '${sha256}', 15, 'lease', '2026-01-01');
		commit;`);
	await t.test(
		"both filing routes select the earliest copied row and break ties by ID",
		async () => {
			const partner = await fileToDeal(sha256, {}, deal);
			assert.equal(partner.status, 200);
			assert.equal((await json(partner)).document_id, earliest);
			const job = await tie({ sha256, deal_id: deal });
			assert.equal(job.status, 201);
			assert.deepEqual(await json(job), {
				document_id: earliest,
				existing: true,
			});
		},
	);
	await t.test(
		"a fresh key with an uppercase predecessor finds the same replacement",
		async (t) => {
			const replacement = await uploadDealFile(
				t,
				"Replacement of a copied lease",
			);
			const first = await fileToDeal(
				replacement,
				{ supersedes_id: earliest },
				deal,
			);
			assert.equal(first.status, 201);
			const retry = await fileToDeal(
				replacement,
				{ supersedes_id: earliest.toUpperCase() },
				deal,
			);
			assert.equal(retry.status, 200);
			assert.deepEqual(await json(retry), await json(first));
		},
	);
});

test("two overlapping replacements of one predecessor leave one new version", async (t) => {
	const original = await uploadDealFile(t, "Original plan");
	const first = await fileToDeal(original);
	assert.equal(first.status, 201);
	const { document_id } = await json(first);
	const candidates = [
		await uploadDealFile(t, "New plan"),
		await uploadDealFile(t, "Alternate plan"),
	];
	const { promise, resolve } = Promise.withResolvers<void>();
	let waiting = 0;
	const storage = {
		...bucket,
		async head(key: string) {
			if (++waiting === 2) resolve();
			await promise;
			return bucket.head(key);
		},
	};
	const responses = await Promise.all(
		candidates.map((sha256) =>
			fileToDeal(
				sha256,
				{ supersedes_id: document_id },
				id(2),
				storage,
			).finally(resolve),
		),
	);
	assert.equal(waiting, 2);
	assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
	const refused = responses.find((response) => response.status === 409);
	assert.ok(refused);
	await assertRefusal(refused, "predecessor_replaced");
});

test("files upload, attach and open through door 20", async (t) => {
	await t.test(
		"an upload checks type, size, length and hash before any file can be opened",
		async () => {
			for (const [args, status, error] of [
				[{ length: "missing" }, 411, "length_required"],
				[{ length: "300000001" }, 422, "too_large"],
				[
					{ data: new TextEncoder().encode("example") },
					422,
					"unsupported_file",
				],
				[{ hash: "0".repeat(64) }, 422, "sha256_mismatch"],
			] as const) {
				const response = await upload(args);
				assert.deepEqual(
					[response.status, (await json(response)).error],
					[status, error],
				);
			}
			assert.equal(files.size, 0);
			for (const marker of [
				"word/document.xml",
				"word/document2.xml",
				"xl/workbook.xml",
				"ppt/presentation.xml",
			]) {
				const data = new TextEncoder().encode(`PK\x03\x04${marker}`);
				const officeHash = createHash("sha256").update(data).digest("hex");
				const response = await upload({ data, hash: officeHash });
				assert.equal(response.status, 201);
				assert.match(
					String((await json(response)).content_type),
					/openxmlformats/,
				);
				files.delete(`sha256/${officeHash}`);
			}
			const metadata = {
				sha256: hash,
				content_type: "application/pdf",
				bytes: pdf.length,
			};
			for (const [user, status] of [
				[false, 201],
				[true, 200],
			] as const) {
				const before = heads;
				const response = await upload({ user });
				assert.deepEqual(
					[response.status, await json(response)],
					[status, metadata],
				);
				assert.equal(heads - before, 1);
			}
			assert.equal(
				(await upload({ data: new TextEncoder().encode("%PDF-different") }))
					.status,
				200,
			);
			assert.equal(files.size, 1);
			assert.equal(
				(await request({ user: "alex" }, `documents/${id(90)}`, {}, bindings))
					.status,
				404,
			);
		},
	);

	await t.test(
		"concurrent first ties with different keys return one document",
		async () => {
			const fresh = new TextEncoder().encode("%PDF-concurrent");
			const sha256 = createHash("sha256").update(fresh).digest("hex");
			assert.equal((await upload({ data: fresh, hash: sha256 })).status, 201);
			await db.query("begin; lock table document in share mode");
			const pending = [tie({ sha256 }), tie({ sha256 })];
			try {
				let waiting = 0;
				for (let attempts = 0; waiting < 2 && attempts < 1000; attempts++) {
					await db.query("select pg_stat_clear_snapshot()");
					const locks = await db.query(
						"select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and usename like 'door_%'",
					);
					waiting = locks.rows[0].n;
				}
				assert.equal(waiting, 2);
			} finally {
				await db.query("rollback");
			}
			const responses = await Promise.all(pending);
			const answers = await Promise.all(responses.map(json));
			assert.ok(responses.every((r) => r.status === 201));
			assert.equal(new Set(answers.map((a) => a.document_id)).size, 1);
			assert.equal(answers.filter((a) => a.existing === false).length, 1);
			files.delete(`sha256/${sha256}`);
		},
	);

	await t.test(
		"attachments converge by email and hash, file once, and open through both entrances",
		async () => {
			const args = { idempotency_key: randomUUID() };
			const first = await tie(args);
			const answer = await json(first);
			assert.equal(first.status, 201);
			assert.equal(answer.existing, false);
			assert.deepEqual(await json(await tie(args)), {
				...answer,
				replayed: true,
			});
			assert.equal((await tie({ ...args, name: "Changed.pdf" })).status, 409);
			const same = await Promise.all([tie(), tie()]);
			for (const response of same)
				assert.deepEqual(await json(response), { ...answer, existing: true });
			const crossed = await json(await tie({ deal_id: id(3) }));
			assert.notEqual(crossed.document_id, answer.document_id);
			const second = await json(
				await tie({ message_id: "Second@example.test" }),
			);
			assert.equal(second.document_id, answer.document_id);
			for (const email of [id(4), id(5)]) {
				const result = await db.query(
					"select activity_entry(a)->'email'->'documents' as documents from activity a where id = $1",
					[email],
				);
				assert.ok(
					result.rows[0].documents.some(
						(d: { id: string }) => d.id === answer.document_id,
					),
				);
			}
			assert.equal(
				(await request(caller, `documents/${answer.document_id}`, {})).status,
				503,
			);
			assert.equal(files.size, 1);
			for (const who of [caller, { user: "alex" }]) {
				const opened = await request(
					who,
					`documents/${answer.document_id}`,
					{},
					bindings,
				);
				assert.equal(opened.status, 200);
				assert.equal(opened.headers.get("Content-Type"), "application/pdf");
				assert.match(
					opened.headers.get("Content-Disposition") ?? "",
					/Example%27s%20plan.pdf/,
				);
				assert.deepEqual(new Uint8Array(await opened.arrayBuffer()), pdf);
			}
			const row = (
				await db.query(
					"select deal_id, changed_by_job, changed_for_user_id from document where id = $1",
					[answer.document_id],
				)
			).rows[0];
			assert.deepEqual(row, {
				deal_id: id(2),
				changed_by_job: "mail_capture",
				changed_for_user_id: id(1),
			});
			await assert.rejects(
				db.query(
					`begin; set local engine.job = 'old_system'; update document set deal_id = '${id(3)}' where id = '${answer.document_id}'`,
				),
				{ constraint: "document_filed_once" },
			);
			await db.query("rollback");
		},
	);

	await t.test(
		"ties refuse missing records, uploads and fields; only jobs reach the attachment door",
		async () => {
			for (const [args, status, error] of [
				[{ message_id: "Missing@example.test" }, 409, "email_not_stored"],
				[{ sha256: "1".repeat(64) }, 409, "file_not_uploaded"],
				[{ deal_id: id(99) }, 404, "not_found"],
				[{ deal_id: undefined }, 400, "missing_required"],
				[{ kind: undefined }, 400, "missing_required"],
			] as const) {
				const response = await tie(args);
				assert.deepEqual(
					[response.status, (await json(response)).error],
					[status, error],
				);
			}
			assert.equal(
				(
					await request(
						{ user: "alex" },
						"attachments",
						{ method: "POST", body: "{}" },
						bindings,
					)
				).status,
				404,
			);
			assert.equal(
				(
					await request(
						{ job: "unknown" },
						`files/${hash}`,
						{ method: "PUT", body: pdf },
						bindings,
					)
				).status,
				403,
			);
			assert.equal(
				(
					await request(caller, `files/${hash}`, {
						method: "PUT",
						headers: { "Content-Length": String(pdf.length) },
						body: pdf,
					})
				).status,
				503,
			);
			assert.equal(
				(
					await request(caller, "attachments", {
						method: "POST",
						body: JSON.stringify({
							idempotency_key: randomUUID(),
							sha256: hash,
							name: "Example.pdf",
							deal_id: id(2),
							kind: "other",
						}),
					})
				).status,
				503,
			);
			const solo = await tie({ message_id: undefined });
			assert.equal(solo.status, 201);
			const document = await json(solo);
			assert.deepEqual(await json(await tie({ message_id: undefined })), {
				...document,
				existing: true,
			});
		},
	);
});
