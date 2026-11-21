import { createHash } from "node:crypto";
import { type Context, Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/postgres";
import { answerNextRead, isoMillis, Refusal, refuse } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import { readHomeEmailThread, sourceInMailbox } from "./home-email-thread.ts";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import {
	fit,
	isChangeId,
	isInstant,
	isText,
	isUuid,
	optional,
} from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";

const text = { subject: isText, body: isText };
export const replacedDraftReason =
	"Replaced by a newer reply draft in this conversation";
const draftVersion = { idempotency_key: isUuid, version: isChangeId };
const create = {
	idempotency_key: isUuid,
	activity_id: isUuid,
	...text,
	evidence: isText,
};
const submission = {
	to: isText,
	cc: isText,
	...draftVersion,
	...text,
	document_ids: (v: unknown): v is string[] =>
		Array.isArray(v) && v.every(isUuid),
};
const delivery = {
	idempotency_key: isUuid,
	version: isChangeId,
	sha256: (v: unknown): v is string =>
		typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
	status: (v: unknown): v is "sent" | "failed" =>
		v === "sent" || v === "failed",
	sent_item_id: optional(isText),
	sent_at: optional(isInstant),
	reason: optional(isText),
};
const digest = ({ subject, body }: { subject: string; body: string }) =>
	createHash("sha256")
		.update(JSON.stringify({ subject, body }), "utf8")
		.digest("hex");
const fail = (refusal: Refusal): never => {
	throw new SaveRefusal(refusal);
};

export function changePendingDraft(
	tx: Transaction<DB>,
	draft: { id: string; revision: number; status: string },
	request: { version: number } & (
		| { subject: string; body: string }
		| { reason: string }
	),
) {
	const current = { version: draft.revision };
	if (request.version !== draft.revision)
		fail(new Refusal(409, "version_conflict", current));
	if (draft.status !== "pending")
		fail(new Refusal(409, "draft_changed", current));
	return tx
		.updateTable("reply_draft")
		.set(
			"reason" in request
				? { status: "dismissed", dismiss_reason: request.reason.trim() }
				: { subject: request.subject, body: request.body },
		)
		.where("id", "=", draft.id)
		.returning(["id as draft_id", "revision as version", "status"])
		.executeTakeFirstOrThrow();
}

async function owner(tx: Transaction<DB>, c: Context<NextSaveEnv>) {
	const stamp = c.get("stamp");
	if ("job" in stamp && stamp.job !== "mail_capture")
		fail(new Refusal(403, "unknown_job"));
	const slug = stamp.user !== undefined ? stamp.user : stamp.for_user;
	if (!slug) return fail(new Refusal(403, "not_mailbox_owner"));
	const user = await tx
		.selectFrom("app_user")
		.select("id")
		.where("slug", "=", slug)
		.executeTakeFirst();
	if (!user) return fail(new Refusal(422, "actor_not_provisioned"));
	return { id: user.id, slug };
}
async function locked(
	tx: Transaction<DB>,
	c: Context<NextSaveEnv>,
	draft_id: string,
) {
	const user = await owner(tx, c);
	const draft = await tx
		.selectFrom("reply_draft")
		.selectAll()
		.where("id", "=", draft_id)
		.forUpdate()
		.executeTakeFirst();
	if (!draft) return fail(new Refusal(404, "not_found"));
	if (draft.owner_user_id !== user.id)
		fail(new Refusal(403, "not_mailbox_owner"));
	return draft;
}

type DraftEmail = { activity_id: string; owner_user_id: string };

async function lockDraftConversation(
	tx: Transaction<DB>,
	{ activity_id, owner_user_id }: DraftEmail,
) {
	const {
		rows: [source],
	} = await sql<{ conversation_id: string | null }>`
		select conversation_id, pg_advisory_xact_lock(
			hashtextextended(case when conversation_id is null
				then 'reply draft email ' || ${owner_user_id}::text || ' ' || activity_id::text
				else 'reply draft ' || ${owner_user_id}::text || ' ' || conversation_id end, 0))
		from email where activity_id = ${activity_id}
	`.execute(tx);
	return source?.conversation_id ?? null;
}

export async function storeReplyDraft(
	tx: Transaction<DB>,
	source: DraftEmail,
	reply: { subject: string; body: string } & (
		| { proposed_by_job: "mail_capture"; evidence: string }
		| { confirmed_doc_turn_id: string }
	),
) {
	const { activity_id, owner_user_id } = source;
	const conversation = await lockDraftConversation(tx, source);
	let evidence: string;
	if ("evidence" in reply) evidence = reply.evidence;
	else {
		const {
			rows: [email],
		} = await sql<{ evidence: string }>`
			select case when left(e.body, 2000) ~ '\\S'
				then left(e.body, 2000) else e.sender::text end as evidence
			from email e join email_mailbox m on m.activity_id = e.activity_id
			where e.activity_id = ${activity_id} and m.user_id = ${owner_user_id}
			for key share of e
		`.execute(tx);
		if (!email) return fail(new Refusal(404, "not_found"));
		evidence = email.evidence;
	}
	// Read in a new statement so it sees the previous lock holder's commit.
	const {
		rows: [existing],
	} = await sql<{ id: string; revision: number }>`
		select d.id, d.revision from reply_draft d
		join email e on e.activity_id = d.email_activity_id
		join activity a on a.id = e.activity_id
		where d.owner_user_id = ${owner_user_id}
		and (d.email_activity_id = ${activity_id} or (
			e.conversation_id = ${conversation} and d.status = 'pending'
			and (${"confirmed_doc_turn_id" in reply} or d.confirmed_doc_turn_id is not null)
		))
		order by (d.email_activity_id = ${activity_id}) desc, a.happened_at desc, a.id desc
		limit 1
	`.execute(tx);
	if (existing) return { ...existing, existing: true };
	const draft = await tx
		.insertInto("reply_draft")
		.values({
			email_activity_id: activity_id,
			owner_user_id,
			...reply,
			evidence,
			changed_at: sql<string>`now()`,
		})
		.returning(["id", "revision"])
		.executeTakeFirstOrThrow();
	if ("proposed_by_job" in reply && conversation)
		await dismissOlderDrafts(tx, owner_user_id, conversation);
	return { ...draft, existing: false };
}

async function dismissOlderDrafts(
	tx: Transaction<DB>,
	owner_user_id: string,
	conversation: string,
) {
	await tx
		.updateTable("reply_draft")
		.set({
			status: "dismissed",
			dismiss_reason: replacedDraftReason,
		})
		.where("status", "=", "pending")
		.where("id", "in", (eb) =>
			eb
				.selectFrom("reply_draft as pending")
				.innerJoin("email", "email.activity_id", "pending.email_activity_id")
				.innerJoin("activity", "activity.id", "email.activity_id")
				.select("pending.id")
				.where("email.conversation_id", "=", conversation)
				.where("pending.owner_user_id", "=", owner_user_id)
				.where("pending.status", "=", "pending")
				.orderBy("activity.happened_at", "desc")
				.orderBy("activity.id", "desc")
				.offset(1),
		)
		.execute();
}

function savePendingDraft(
	c: Context<NextSaveEnv>,
	action: "edit" | "dismissal",
) {
	return answerNextSave(
		c,
		`reply-draft-${action}`,
		(body) => {
			const draft_id = c.req.param("id");
			if (!isUuid(draft_id)) return new Refusal(404, "not_found");
			const parsed =
				action === "edit"
					? fit(body, { ...draftVersion, ...text }, [
							"idempotency_key",
							"version",
							"subject",
							"body",
						])
					: fit(
							body,
							{
								...draftVersion,
								reason: (v: unknown): v is string =>
									isText(v) && v.length <= 500,
							},
							["idempotency_key", "version", "reason"],
						);
			return parsed instanceof Refusal ? parsed : { ...parsed, draft_id };
		},
		async (tx, request) =>
			changePendingDraft(tx, await locked(tx, c, request.draft_id), request),
	);
}

export const replyDrafts = new Hono<NextSaveEnv>().post(
	"/reply-drafts/:id/submission",
	(c) =>
		answerNextSave(
			c,
			"reply-submission",
			(body) => {
				const draft_id = c.req.param("id");
				if (!isUuid(draft_id)) return new Refusal(404, "not_found");
				const parsed = fit(body, submission, [
					"idempotency_key",
					"version",
					"to",
					"cc",
					"subject",
					"body",
					"document_ids",
				]);
				return parsed instanceof Refusal ? parsed : { ...parsed, draft_id };
			},
			async (tx, request) => {
				const draft = await locked(tx, c, request.draft_id);
				if (draft.status === "dismissed")
					fail(new Refusal(409, "draft_changed", { version: draft.revision }));
				if (draft.revision !== request.version)
					fail(
						new Refusal(409, "version_conflict", { version: draft.revision }),
					);
				// Attachments must change while the database still sees the editable draft.
				await tx
					.deleteFrom("reply_draft_document")
					.where("reply_draft_id", "=", draft.id)
					.execute();
				if (request.document_ids.length)
					await tx
						.insertInto("reply_draft_document")
						.values(
							[...new Set(request.document_ids)].map((document_id) => ({
								reply_draft_id: draft.id,
								document_id,
								changed_at: sql<string>`now()`,
							})),
						)
						.execute();
				const approved = await tx
					.updateTable("reply_draft")
					.set({
						status: "approved",
						subject: request.subject,
						body: request.body,
						to_address: request.to,
						cc_address: request.cc,
						failure_reason: null,
					})
					.where("id", "=", draft.id)
					.returning("revision")
					.executeTakeFirstOrThrow();
				return {
					draft_id: draft.id,
					version: approved.revision,
					sha256: digest(request),
					status: "approved",
				};
			},
		),
);

replyDrafts
	.get("/reply-drafts/:id", async (c) => {
		const id = c.req.param("id");
		if (!isUuid(id)) return refuse(c, new Refusal(404, "not_found"));
		return answerNextRead(c, "read-reply-draft", async (db, userId) => {
			const draft = await db
				.selectFrom("reply_draft as r")
				.innerJoin("email as e", "e.activity_id", "r.email_activity_id")
				.select([
					"r.id as draft_id",
					"r.owner_user_id",
					"r.email_activity_id",
					"r.status",
					"r.failure_reason",
					"r.revision as version",
					"r.subject",
					"r.body",
					sql<
						string | null
					>`case when r.status = 'pending' then e.sender else r.to_address end`.as(
						"to",
					),
					sql<string | null>`case when r.status = 'pending' then (
						select min(pe.address::text) from app_user u join party_email pe on pe.party_id = u.id
						where u.id <> r.owner_user_id and pe.is_primary and pe.label = 'work'
						having count(*) = 1
					) else r.cc_address end`.as("cc"),
				])
				.select((eb) => [
					sourceInMailbox(eb.ref("e.activity_id"), userId).as("source_visible"),
					jsonObjectFrom(
						eb
							.selectFrom("activity as a")
							.whereRef("a.id", "=", "e.activity_id")
							.select([
								"a.id",
								"a.kind",
								"e.sender",
								"e.sender_name",
								"e.subject",
								"e.body",
							])
							.select((source) =>
								isoMillis(source.ref("a.happened_at")).as("happened_at"),
							),
					).as("source_activity"),
					jsonArrayFrom(
						eb
							.selectFrom("reply_draft_document as attachment")
							.innerJoin("document as d", "d.id", "attachment.document_id")
							.whereRef("attachment.reply_draft_id", "=", "r.id")
							.select(["d.id as document_id", "d.name", "d.content_type"])
							.orderBy("d.id"),
					).as("attachments"),
				])
				.where("r.id", "=", id)
				.executeTakeFirst();
			if (!draft) return new Refusal(404, "not_found");
			const { owner_user_id, email_activity_id, source_visible, ...detail } =
				draft;
			if (owner_user_id !== userId)
				return new Refusal(403, "not_mailbox_owner");
			if (!source_visible) return new Refusal(404, "not_found");
			const { thread, sourceActivity } = await readHomeEmailThread(
				db,
				userId,
				email_activity_id,
			);
			return {
				...detail,
				source_activity: sourceActivity ?? detail.source_activity,
				thread,
			};
		});
	})
	.post("/reply-drafts/:id/edit", (c) => savePendingDraft(c, "edit"))
	.post("/reply-drafts/:id/dismissal", (c) => savePendingDraft(c, "dismissal"));

export const replyJobs = new Hono<NextSaveEnv>()
	.post("/reply-drafts", async (c) => {
		const response = await answerNextSave(
			c,
			"reply-draft",
			(body) =>
				fit(body, create, [
					"idempotency_key",
					"activity_id",
					"subject",
					"body",
					"evidence",
				]),
			async (tx, request) => {
				const user = await owner(tx, c);
				const { activity_id, evidence, subject, body } = request;
				const { id, revision, existing } = await storeReplyDraft(
					tx,
					{ activity_id, owner_user_id: user.id },
					{ proposed_by_job: "mail_capture", evidence, subject, body },
				);
				return {
					draft_id: id,
					version: revision,
					...(existing && { existing }),
				};
			},
		);
		if (!response.ok) return response;
		const body: JsonObject = await response.json();
		return c.json(body, body.existing ? 200 : 201);
	})
	.post("/reply-drafts/:id/delivery", (c) =>
		answerNextSave(
			c,
			"reply-delivery",
			(body) => {
				const draft_id = c.req.param("id");
				if (!isUuid(draft_id)) return new Refusal(404, "not_found");
				const parsed = fit(body, delivery, [
					"idempotency_key",
					"version",
					"sha256",
					"status",
					...(body.status === "sent"
						? (["sent_item_id", "sent_at"] as const)
						: (["reason"] as const)),
				]);
				if (parsed instanceof Refusal) return parsed;
				if (
					parsed.status === "sent"
						? parsed.reason !== undefined
						: parsed.sent_item_id !== undefined || parsed.sent_at !== undefined
				)
					return new Refusal(400, "invalid_field_value");
				return { ...parsed, draft_id };
			},
			async (tx, request) => {
				const draft = await locked(tx, c, request.draft_id);
				if (
					draft.revision !== request.version ||
					digest(draft) !== request.sha256 ||
					!["approved", "failed", "sent"].includes(draft.status)
				)
					fail(new Refusal(409, "draft_changed", { version: draft.revision }));
				if (draft.status === "sent" && request.status === "sent") {
					if (draft.sent_item_id !== request.sent_item_id)
						fail(
							new Refusal(409, "already_sent", {
								sent_item_id: draft.sent_item_id,
							}),
						);
				} else {
					await tx
						.updateTable("reply_draft")
						.set({
							status: request.status,
							sent_item_id: request.sent_item_id ?? null,
							sent_at: request.sent_at ?? null,
							failure_reason: request.reason ?? null,
						})
						.where("id", "=", draft.id)
						.execute();
				}
				return {
					draft_id: draft.id,
					version: draft.revision,
					status: request.status,
				};
			},
		),
	)
	.get("/reply-drafts", async (c) => {
		const { after, limit = "100", unconfirmed } = c.req.query();
		if (
			(after && !isUuid(after)) ||
			!/^\d+$/.test(limit) ||
			Number(limit) < 1 ||
			Number(limit) > 100 ||
			(unconfirmed !== undefined && unconfirmed !== "true")
		)
			return refuse(c, new Refusal(400, "invalid_field_value"));
		const reader = c.env.DATABASE;
		if (!reader) return refuse(c, new Refusal(503, "database_unavailable"));
		try {
			return c.json(
				await nextTransaction(reader.connectionString, "read", async (tx) => {
					const user = await owner(tx, c);
					let query = tx
						.selectFrom("reply_draft")
						.selectAll()
						.select((eb) =>
							jsonArrayFrom(
								eb
									.selectFrom("reply_draft_document")
									.select("document_id")
									.whereRef("reply_draft_id", "=", "reply_draft.id")
									.orderBy("document_id"),
							).as("documents"),
						)
						.where("owner_user_id", "=", user.id)
						.where("status", "=", unconfirmed ? "failed" : "approved");
					if (unconfirmed)
						query = query.where(
							sql<boolean>`failure_reason ~ '^unconfirmed_after_[0-9]+$'`,
						);
					if (after) query = query.where("id", ">", after);
					const rows = await query
						.orderBy("id")
						.limit(Number(limit) + 1)
						.execute();
					const page = rows.slice(0, Number(limit));
					const drafts = page.map((d) => ({
						draft_id: d.id,
						version: d.revision,
						to: d.to_address,
						cc: d.cc_address,
						subject: d.subject,
						body: d.body,
						sha256: digest(d),
						document_ids: d.documents.map((r) => r.document_id),
					}));
					return {
						owner: user.slug,
						drafts,
						next_cursor: rows.length > page.length ? page.at(-1)?.id : null,
					};
				}),
			);
		} catch (error) {
			return refuse(
				c,
				error instanceof SaveRefusal
					? error.refusal
					: new Refusal(503, "database_unavailable"),
			);
		}
	});
