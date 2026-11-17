import { type Context, Hono } from "hono";
import { sql } from "kysely";
import { Refusal, refuse } from "./answer.ts";
import { nextTransaction } from "./next-connection.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { signNextCaller } from "./next-save.ts";
import { storeFile } from "./post-media.ts";
import { fit, isText, isUuid, optional } from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";

type Bucket = Parameters<typeof storeFile>[0] & {
	head(
		key: string,
	): Promise<{ size: number; httpMetadata?: { contentType?: string } } | null>;
	get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null>;
};
export type AttachmentEnv = NextSaveEnv & {
	Bindings: { DEAL_DOCUMENTS?: Bucket; POST_MEDIA?: Bucket };
};
const isHash = (value: unknown): value is string =>
	typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const ATTACHMENT = {
	idempotency_key: isUuid,
	sha256: isHash,
	name: isText,
	message_id: optional(isText),
	deal_id: optional(isUuid),
	kind: optional(isText),
};

async function read<T>(
	c: Context<AttachmentEnv>,
	run: Parameters<typeof nextTransaction<T>>[2],
) {
	const database = c.env.DATABASE_WRITER;
	if (!database)
		throw new SaveRefusal(new Refusal(503, "database_unavailable"));
	return nextTransaction(database.connectionString, "save", async (tx) => {
		await signNextCaller(tx, c.get("stamp"));
		return run(tx);
	});
}

export const attachmentFiles = new Hono<AttachmentEnv>();
attachmentFiles.onError((error, c) =>
	error instanceof SaveRefusal
		? refuse(c, error.refusal)
		: refuse(c, new Refusal(503, "database_unavailable")),
);

attachmentFiles.put("/files/:sha256", async (c) => {
	await read(c, async () => undefined);
	const sha256 = c.req.param("sha256");
	if (!isHash(sha256))
		return refuse(
			c,
			new Refusal(400, "invalid_field_value", { fields: ["sha256"] }),
		);
	const length = Number(c.req.header("Content-Length"));
	const body = c.req.raw.body;
	if (!body || !Number.isSafeInteger(length) || length <= 0)
		return refuse(c, new Refusal(411, "length_required"));
	if (length > 25 * 1024 * 1024)
		return refuse(c, new Refusal(422, "too_large"));
	const bucket = c.env.DEAL_DOCUMENTS;
	if (!bucket) return refuse(c, new Refusal(503, "database_unavailable"));
	let bytes = 0;
	const counted = body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(piece, controller) {
				bytes += piece.length;
				if (bytes > length) controller.error(new Error("length mismatch"));
				else controller.enqueue(piece);
			},
			flush(controller) {
				if (bytes !== length) controller.error(new Error("length mismatch"));
			},
		}),
	);
	const stored = await storeFile(bucket, sha256, counted, length);
	if ("refused" in stored && stored.refused !== "already_stored")
		return refuse(
			c,
			new Refusal(
				422,
				stored.refused === "too_large" || stored.refused === "sha256_mismatch"
					? stored.refused
					: "unsupported_file",
			),
		);
	const file = await bucket.head(`sha256/${sha256}`);
	if (!file) return refuse(c, new Refusal(503, "database_unavailable"));
	return c.json(
		{ sha256, content_type: file.httpMetadata?.contentType, bytes: file.size },
		"refused" in stored ? 200 : 201,
	);
});

attachmentFiles.get("/documents/:id", async (c) => {
	const id = c.req.param("id");
	if (!isUuid(id)) return refuse(c, new Refusal(404, "not_found"));
	const document = await read(c, (tx) =>
		tx
			.selectFrom("document")
			.select(["r2_bucket", "r2_key", "content_type", "name"])
			.where("id", "=", id)
			.executeTakeFirst(),
	);
	if (!document) return refuse(c, new Refusal(404, "not_found"));
	const bucket =
		document.r2_bucket === "deal_documents"
			? c.env.DEAL_DOCUMENTS
			: c.env.POST_MEDIA;
	const file = await bucket?.get(document.r2_key);
	if (!file) return refuse(c, new Refusal(404, "not_found"));
	return new Response(file.body, {
		headers: {
			"Content-Type": document.content_type ?? "application/octet-stream",
			"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "private, no-store",
		},
	});
});

export const attachments = new Hono<AttachmentEnv>().post("/attachments", (c) =>
	answerNextSave(
		c,
		"attachment",
		(body) => {
			const request = fit(
				body,
				ATTACHMENT,
				["idempotency_key", "sha256", "name"],
				["message_id", "deal_id"],
			);
			if (!(request instanceof Refusal) && request.deal_id && !request.kind)
				return new Refusal(400, "missing_required", { fields: ["kind"] });
			return request;
		},
		async (tx, request) => {
			const { sha256, name, deal_id, kind, message_id } = request;
			const email = message_id
				? await tx
						.selectFrom("email")
						.select("activity_id")
						.where("message_id", "=", message_id)
						.executeTakeFirst()
				: undefined;
			if (message_id && !email)
				throw new SaveRefusal(new Refusal(409, "email_not_stored"));
			if (
				deal_id &&
				!(await tx
					.selectFrom("deal")
					.select("id")
					.where("id", "=", deal_id)
					.executeTakeFirst())
			)
				throw new SaveRefusal(new Refusal(404, "not_found"));
			await sql`select pg_advisory_xact_lock(hashtextextended(${`${email?.activity_id ?? deal_id}/${sha256}`}, 0))`.execute(
				tx,
			);
			const prior = await tx
				.selectFrom("document")
				.select(["id", "deal_id"])
				.where("sha256", "=", sha256)
				.where(
					"email_activity_id",
					email ? "=" : "is",
					email?.activity_id ?? null,
				)
				.$if(!email, (q) => q.where("deal_id", "=", deal_id ?? ""))
				.executeTakeFirst();
			if (prior) {
				if (deal_id && prior.deal_id && prior.deal_id !== deal_id)
					throw new SaveRefusal(
						new Refusal(409, "filed_to_another_deal", {
							deal_id: prior.deal_id,
						}),
					);
				if (deal_id && !prior.deal_id)
					await tx
						.updateTable("document")
						.set({ deal_id, kind: kind ?? null })
						.where("id", "=", prior.id)
						.execute();
				return { document_id: prior.id, existing: true };
			}
			const file = await c.env.DEAL_DOCUMENTS?.head(`sha256/${sha256}`);
			if (!file?.httpMetadata?.contentType)
				throw new SaveRefusal(new Refusal(409, "file_not_uploaded"));
			const { rows } = await sql<{
				id: string;
			}>`insert into document (name, r2_bucket, r2_key, content_type, sha256, bytes, email_activity_id, deal_id, kind)
		values (${name}, 'deal_documents', ${`sha256/${sha256}`}, ${file.httpMetadata.contentType}, ${sha256}, ${file.size}, ${email?.activity_id ?? null}::uuid, ${deal_id ?? null}::uuid, ${deal_id ? kind : null}) returning id`.execute(
				tx,
			);
			const document = rows[0];
			if (!document) throw new Error("document insert returned no row");
			return { document_id: document.id, existing: false };
		},
		201,
	),
);
