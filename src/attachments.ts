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
	deal_id: isUuid,
	kind: isText,
};

async function asCaller<T>(
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

function encodeFilename(name: string) {
	return encodeURIComponent(name).replace(
		/['()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

export const attachmentFiles = new Hono<AttachmentEnv>();
attachmentFiles.onError((error, c) =>
	error instanceof SaveRefusal
		? refuse(c, error.refusal)
		: refuse(c, new Refusal(503, "database_unavailable")),
);

attachmentFiles.put("/files/:sha256", async (c) => {
	await asCaller(c, async () => undefined);
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
	const bucket = c.env.DEAL_DOCUMENTS;
	if (!bucket) return refuse(c, new Refusal(503, "database_unavailable"));
	const stored = await storeFile(bucket, sha256, body, length);
	if ("refused" in stored) return refuse(c, new Refusal(422, stored.refused));
	return c.json(
		{ sha256, content_type: stored.type, bytes: stored.bytes },
		stored.existing ? 200 : 201,
	);
});

attachmentFiles.get("/documents/:id", async (c) => {
	const id = c.req.param("id");
	if (!isUuid(id)) return refuse(c, new Refusal(404, "not_found"));
	const document = await asCaller(c, (tx) =>
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
	if (!bucket) return refuse(c, new Refusal(503, "database_unavailable"));
	const file = await bucket.get(document.r2_key);
	if (!file) return refuse(c, new Refusal(404, "not_found"));
	return new Response(file.body, {
		headers: {
			"Content-Type": document.content_type ?? "application/octet-stream",
			"Content-Disposition": `attachment; filename*=UTF-8''${encodeFilename(document.name)}`,
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "private, no-store",
		},
	});
});

export const attachments = new Hono<AttachmentEnv>().post("/attachments", (c) =>
	answerNextSave(
		c,
		"attachment",
		(body) =>
			fit(body, ATTACHMENT, [
				"idempotency_key",
				"sha256",
				"name",
				"deal_id",
				"kind",
			]),
		async (tx, request) => {
			const { sha256, name, deal_id, kind, message_id } = request;
			const bucket = c.env.DEAL_DOCUMENTS;
			if (!bucket)
				throw new SaveRefusal(new Refusal(503, "database_unavailable"));
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
				!(await tx
					.selectFrom("deal")
					.select("id")
					.where("id", "=", deal_id)
					.executeTakeFirst())
			)
				throw new SaveRefusal(new Refusal(404, "not_found"));
			await sql`select pg_advisory_xact_lock(hashtextextended(${sha256}, 0))`.execute(
				tx,
			);
			const prior = await tx
				.selectFrom("document")
				.select("id")
				.where("deal_id", "=", deal_id)
				.where("sha256", "=", sha256)
				.limit(1)
				.executeTakeFirst();
			const linkEmail = async (document_id: string) => {
				if (email)
					await tx
						.insertInto("email_document")
						.values({ email_activity_id: email.activity_id, document_id })
						.onConflict((conflict) => conflict.doNothing())
						.execute();
			};
			if (prior) {
				await linkEmail(prior.id);
				return { document_id: prior.id, existing: true };
			}
			const file = await bucket.head(`sha256/${sha256}`);
			if (!file?.httpMetadata?.contentType)
				throw new SaveRefusal(new Refusal(409, "file_not_uploaded"));
			const document = await tx
				.insertInto("document")
				.values({
					name,
					r2_bucket: "deal_documents",
					r2_key: `sha256/${sha256}`,
					content_type: file.httpMetadata.contentType,
					sha256,
					bytes: file.size,
					deal_id,
					kind,
				})
				.returning("id")
				.executeTakeFirstOrThrow();
			await linkEmail(document.id);
			return { document_id: document.id, existing: false };
		},
		201,
	),
);
