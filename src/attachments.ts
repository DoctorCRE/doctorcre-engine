import { type Context, Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal, refuse } from "./answer.ts";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { stampNextSave } from "./next-save.ts";
import { storeFile } from "./post-media.ts";
import { asText } from "./reader.ts";
import {
	fit,
	isStoredText,
	isText,
	isUuid,
	optional,
} from "./request-shape.ts";
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
const DEAL_DOCUMENT = {
	idempotency_key: isUuid,
	sha256: isHash,
	name: isStoredText,
	kind: isStoredText,
	supersedes_id: optional(isUuid),
};

async function lockedDealFiles(
	tx: Transaction<DB>,
	dealId: string,
	sha256: string,
) {
	const deal = await tx
		.selectFrom("deal")
		.select("id")
		.where("id", "=", dealId)
		.executeTakeFirst();
	if (!deal) throw new SaveRefusal(new Refusal(404, "not_found"));
	await sql`select pg_advisory_xact_lock(hashtextextended(${sha256}, 0))`.execute(
		tx,
	);
	return tx
		.selectFrom("document")
		.where("deal_id", "=", dealId)
		.where("sha256", "=", sha256);
}

const filingFields = [
	"id as document_id",
	"deal_id",
	"name",
	"kind",
	"sha256",
	"supersedes_id",
	"changed_by_user_id",
	"changed_by_job",
	asText(sql.ref("created_at")).$notNull().as("filed_at"),
] as const;

type DealFile = { deal_id: string; sha256: string; name: string; kind: string };

async function insertDealFile(
	tx: Transaction<DB>,
	bucket: Bucket,
	fields: DealFile & { supersedes_id?: string | null; version?: number },
) {
	const key = `sha256/${fields.sha256}`;
	const file = await bucket.head(key);
	if (!file?.httpMetadata?.contentType)
		throw new SaveRefusal(new Refusal(409, "file_not_uploaded"));
	const document = await tx
		.insertInto("document")
		.values({
			...fields,
			r2_bucket: "deal_documents",
			r2_key: key,
			content_type: file.httpMetadata.contentType,
			bytes: file.size,
			changed_at: sql<string>`now()`,
		})
		.onConflict((conflict) =>
			conflict.constraint("document_supersedes_id_key").doNothing(),
		)
		.returning(filingFields)
		.executeTakeFirst();
	if (!document)
		throw new SaveRefusal(new Refusal(409, "predecessor_replaced"));
	return document;
}

async function replacementVersion(
	tx: Transaction<DB>,
	dealId: string,
	kind: string,
	predecessorId: string,
) {
	const predecessor = await tx
		.selectFrom("document")
		.select(["version", "kind"])
		.where("id", "=", predecessorId)
		.where("deal_id", "=", dealId)
		.forShare()
		.executeTakeFirst();
	if (!predecessor)
		throw new SaveRefusal(new Refusal(409, "predecessor_not_found"));
	if (predecessor.kind !== kind)
		throw new SaveRefusal(new Refusal(409, "predecessor_kind_differs"));
	const replacement = await tx
		.selectFrom("document")
		.select("id")
		.where("supersedes_id", "=", predecessorId)
		.executeTakeFirst();
	if (replacement)
		throw new SaveRefusal(new Refusal(409, "predecessor_replaced"));
	return predecessor.version + 1;
}

async function asCaller<T>(
	c: Context<AttachmentEnv>,
	run: Parameters<typeof nextTransaction<T>>[2],
) {
	const database = c.env.DATABASE_WRITER;
	if (!database)
		throw new SaveRefusal(new Refusal(503, "database_unavailable"));
	return nextTransaction(database.connectionString, "save", async (tx) => {
		await stampNextSave(tx, c.get("stamp"));
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
			const filed = await lockedDealFiles(tx, deal_id, sha256);
			const prior = await filed
				.select("id as document_id")
				.limit(1)
				.executeTakeFirst();
			const { document_id } =
				prior ??
				(await insertDealFile(tx, bucket, { name, sha256, deal_id, kind }));
			if (email)
				await sql`insert into email_document (email_activity_id, document_id)
					values (${email.activity_id}, ${document_id}) on conflict do nothing`.execute(
					tx,
				);
			return { document_id, existing: prior !== undefined };
		},
		201,
	),
);

export const dealDocuments = new Hono<AttachmentEnv>().post(
	"/deals/:id/documents",
	async (c) => {
		const deal_id = c.req.param("id");
		if (!isUuid(deal_id)) return refuse(c, new Refusal(404, "not_found"));
		let status: 200 | 201 = 200;
		return answerNextSave(
			c,
			"file_deal_document",
			(body) => {
				const request = fit(body, DEAL_DOCUMENT, [
					"idempotency_key",
					"sha256",
					"name",
					"kind",
				]);
				return request instanceof Refusal ? request : { ...request, deal_id };
			},
			async (tx, { name, kind, sha256, supersedes_id, deal_id }) => {
				const filed = await lockedDealFiles(tx, deal_id, sha256);
				const knownKind = await tx
					.selectFrom("document_kind")
					.select("slug")
					.where("slug", "=", kind)
					.executeTakeFirst();
				if (!knownKind)
					throw new SaveRefusal(
						new Refusal(400, "invalid_field_value", { fields: ["kind"] }),
					);
				const prior = await filed
					.select(filingFields)
					.orderBy("created_at")
					.orderBy("id")
					.limit(1)
					.executeTakeFirst();
				if (
					prior &&
					(prior.name !== name ||
						prior.kind !== kind ||
						prior.supersedes_id !== (supersedes_id?.toLowerCase() ?? null))
				)
					throw new SaveRefusal(
						new Refusal(409, "already_filed", {
							document_id: prior.document_id,
						}),
					);
				let document = prior;
				if (!document) {
					const bucket = c.env.DEAL_DOCUMENTS;
					if (!bucket)
						throw new SaveRefusal(new Refusal(503, "database_unavailable"));
					const version = supersedes_id
						? await replacementVersion(tx, deal_id, kind, supersedes_id)
						: 1;
					document = await insertDealFile(tx, bucket, {
						name,
						kind,
						sha256,
						deal_id,
						supersedes_id: supersedes_id ?? null,
						version,
					});
					status = 201;
				}
				const { changed_by_user_id, changed_by_job, ...receipt } = document;
				const partner = changed_by_user_id
					? await tx
							.selectFrom("app_user")
							.select("slug")
							.where("id", "=", changed_by_user_id)
							.executeTakeFirstOrThrow()
					: undefined;
				return { ...receipt, filed_by: partner?.slug ?? changed_by_job };
			},
			() => status,
		);
	},
);
