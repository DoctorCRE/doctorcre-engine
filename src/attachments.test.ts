import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "./test-door.ts";

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
const bucket = {
	async head(key: string) {
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
		options: { httpMetadata: { contentType: string } },
	) {
		if (files.has(key)) return null;
		const data = new Uint8Array(await new Response(stream).arrayBuffer());
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
	insert into party (id, kind, name) values ('${id(1)}', 'person', 'Alex Example');
	insert into app_user (id, slug) values ('${id(1)}', 'alex');
	insert into deal (id, name, owner_user_id) values ('${id(2)}', 'Example Deal', '${id(1)}'), ('${id(3)}', 'Another Deal', '${id(1)}');
	insert into document_kind values ('other', 'Other');
	insert into activity (id, kind, happened_at) values ('${id(4)}', 'email', now()), ('${id(5)}', 'email', now());
	insert into email (activity_id, message_id, sender, subject, body) values ('${id(4)}', 'Example@example.test', 'sender@example.test', 'Example', 'Example body'), ('${id(5)}', 'Second@example.test', 'sender@example.test', 'Second', 'Second body');
	insert into activity_about (activity_id, deal_id) values ('${id(4)}', '${id(2)}'), ('${id(5)}', '${id(2)}'); commit;`);
});
after(cleanup);

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
			const first = await upload();
			assert.deepEqual(
				[first.status, await json(first)],
				[
					201,
					{ sha256: hash, content_type: "application/pdf", bytes: pdf.length },
				],
			);
			assert.equal((await upload({ user: true })).status, 200);
			assert.equal(
				(await upload({ data: new TextEncoder().encode("%PDF-different") }))
					.status,
				422,
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
			const same = await Promise.all([
				tie({ deal_id: id(2), kind: "other" }),
				tie({ deal_id: id(2), kind: "other" }),
			]);
			for (const response of same)
				assert.deepEqual(await json(response), { ...answer, existing: true });
			const crossed = await tie({ deal_id: id(3), kind: "other" });
			assert.deepEqual(
				[crossed.status, (await json(crossed)).error],
				[409, "filed_to_another_deal"],
			);
			const second = await json(
				await tie({ message_id: "Second@example.test" }),
			);
			assert.notEqual(second.document_id, answer.document_id);
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
				[{ deal_id: id(99), kind: "other" }, 404, "not_found"],
				[{ deal_id: id(2) }, 400, "missing_required"],
				[{ message_id: undefined }, 400, "missing_required"],
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
			const solo = await tie({
				message_id: undefined,
				deal_id: id(2),
				kind: "other",
			});
			assert.equal(solo.status, 201);
			const document = await json(solo);
			assert.deepEqual(
				await json(
					await tie({ message_id: undefined, deal_id: id(2), kind: "other" }),
				),
				{ ...document, existing: true },
			);
		},
	);
});
