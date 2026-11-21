import type { Context } from "hono";
import { type Expression, sql, type Transaction } from "kysely";
import { z } from "zod";
import { Refusal } from "./answer.ts";
import type { Json } from "./database.d.ts";
import type { DB } from "./next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { ACTING_USER } from "./next-save.ts";
import { changePendingDraft } from "./reply-drafts.ts";
import { fit, isStoredText } from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";
import { isUuid } from "./uuid.ts";

const uuid = z.string().refine(isUuid);
const version = z.int().positive();
const ref = z.object({ kind: z.literal("reply_draft"), id: uuid });
export const draftReference = ref.strict().extend({ version });
export const draftContext = draftReference.extend({
	activity_id: uuid,
	mailbox_user_id: uuid,
});
type DraftTarget =
	| { id: string; version: number | undefined }
	| z.infer<typeof draftContext>;
const draftText = z
	.string()
	.refine((value) => isStoredText(value) && value.isWellFormed());
export const revisionEdits = z.strictObject({
	subject: draftText.refine((value) => [...value].length <= 998).optional(),
	body: draftText.optional(),
});
const revisionAnswer = z.object({
	proposal: revisionEdits.extend({
		kind: z.literal("reply_revision"),
		target: z.object({ ref, version }),
	}),
});
export const draftHref = (id: string) =>
	`/inbox/card/${encodeURIComponent(`reply_draft:${id}`)}`;

type Draft = {
	id: string;
	activity_id: string;
	mailbox_user_id: string;
	revision: number;
	status: string;
	subject: string;
	body: string;
	email: { subject: string; body: string; sender_name: string | null };
};
export async function readDocDraft(
	tx: Transaction<DB>,
	target: DraftTarget,
	owner: string | Expression<string>,
	lock = false,
) {
	const {
		rows: [draft],
	} = await sql<Draft>`
		select d.id, m.activity_id, m.user_id as mailbox_user_id, d.revision, d.status, d.subject, d.body,
			jsonb_build_object('subject', e.subject, 'body', left(e.body, 2000), 'sender_name', e.sender_name) as email
		from reply_draft d join email_mailbox m on (m.activity_id, m.user_id) = (d.email_activity_id, d.owner_user_id)
		join email e on e.activity_id = m.activity_id
		where d.id = ${target.id} and m.user_id = ${owner}
		${lock ? sql`for update of d` : sql``}
	`.execute(tx);
	if (
		"activity_id" in target &&
		(draft?.activity_id !== target.activity_id ||
			draft.mailbox_user_id !== target.mailbox_user_id)
	)
		return undefined;
	return draft;
}

export async function requirePendingDocDraft(
	tx: Transaction<DB>,
	target: DraftTarget,
) {
	const draft = await readDocDraft(tx, target, ACTING_USER, true);
	if (!draft) throw new SaveRefusal(new Refusal(404, "not_found"));
	const current = { version: draft.revision };
	if (draft.status !== "pending")
		throw new SaveRefusal(new Refusal(409, "draft_changed", current));
	if (target.version !== undefined && target.version !== draft.revision)
		throw new SaveRefusal(new Refusal(409, "version_conflict", current));
	return draft;
}

const fail = (status: 404 | 409, error: Refusal["error"]): never => {
	throw new SaveRefusal(new Refusal(status, error));
};

const confirmation = {
	idempotency_key: isUuid,
	edits: (value: unknown): value is z.infer<typeof revisionEdits> =>
		revisionEdits.safeParse(value).success,
};

export function confirmDocRevision(c: Context<NextSaveEnv>) {
	return answerNextSave(
		c,
		"doc-confirmation",
		(body) => {
			const id = c.req.param("id");
			if (!isUuid(id)) return new Refusal(404, "not_found");
			const args = fit(body, confirmation, ["idempotency_key", "edits"]);
			if (args instanceof Refusal) return args;
			return {
				...args,
				turn_id: id.toLowerCase(),
				idempotency_key: args.idempotency_key.toLowerCase(),
			};
		},
		async (tx, { turn_id, idempotency_key, edits }) => {
			const {
				rows: [turn],
			} = await sql<{
				answer: Json;
				context: Json;
				confirmation_key: string | null;
			}>`
				select answer, context, confirmation_key from doc_turn
				where id = ${turn_id} and owner_user_id = ${ACTING_USER} for update
			`.execute(tx);
			if (!turn) return fail(404, "not_found");
			if (turn.confirmation_key) return fail(409, "already_confirmed");
			const context = draftContext.safeParse(turn.context).data;
			const proposal = revisionAnswer.safeParse(turn.answer).data?.proposal;
			if (
				!context ||
				!proposal ||
				proposal.target.ref.id !== context.id ||
				proposal.target.version !== context.version
			)
				return fail(409, "no_proposal");
			const { id, version } = context;
			const draft = await readDocDraft(tx, context, ACTING_USER, true);
			if (!draft) return fail(404, "not_found");
			const saved = await changePendingDraft(tx, draft, {
				version,
				subject: edits.subject ?? proposal.subject ?? draft.subject,
				body: edits.body ?? proposal.body ?? draft.body,
			});
			await sql`update doc_turn set confirmation_key = ${idempotency_key}
			where id = ${turn_id} and owner_user_id = ${ACTING_USER}`.execute(tx);
			return {
				result: {
					kind: "reply_revision",
					id,
					version: saved.version,
					href: draftHref(id),
				},
			};
		},
	);
}
