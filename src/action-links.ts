import { Buffer } from "node:buffer";
import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "./answer.ts";
import { sourceInMailbox } from "./home-email-thread.ts";
import { visibleProposalDetail } from "./home-inbox-review.ts";
import { copiedLeadIdentity } from "./leads/follow-up-reads.ts";
import type { DB } from "./next-database.d.ts";
import type { DatabaseEnv } from "./reader.ts";
import { replacedDraftReason } from "./reply-drafts.ts";

const legacyId =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type ActionRef =
	| { kind: "rd"; id: string; owner: "joe" | "dell" }
	| { kind: "ld" | "cr"; id: string };

type ActionTarget =
	| { kind: "reply_draft" | "lead"; path: string }
	| { kind: "call_review"; path: string; deal_id: string; activity_id: string };

function parseRef(ref: string): ActionRef | null {
	const encoded = /^al1_([A-Za-z0-9_-]{1,120})$/.exec(ref)?.[1];
	if (!encoded) return null;
	const identity = Buffer.from(encoded, "base64url").toString("utf8");
	if (`al1_${Buffer.from(identity).toString("base64url")}` !== ref) return null;
	const [kind, id = "", ...fields] = identity.split(":");
	if (!legacyId.test(id)) return null;
	if (kind === "ld" && fields.length === 0) return { kind, id };
	if (
		kind === "cr" &&
		fields.length === 1 &&
		/^[A-Za-z0-9_-]{1,32}$/.test(fields[0] ?? "")
	)
		return { kind, id };
	if (kind === "rd" && fields.length === 2) {
		const [owner, version = ""] = fields;
		if (
			(owner === "joe" || owner === "dell") &&
			/^[1-9][0-9]{0,9}$/.test(version) &&
			Number(version) <= 2_147_483_647
		)
			return { kind, id, owner };
	}
	return null;
}

async function replyTarget(
	db: Transaction<DB>,
	userId: string,
	id: string,
): Promise<ActionTarget | undefined> {
	const drafts = db
		.selectFrom("reply_draft as r")
		.innerJoin("email as e", "e.activity_id", "r.email_activity_id")
		.innerJoin("activity as a", "a.id", "e.activity_id")
		.where("r.owner_user_id", "=", userId)
		.where(sourceInMailbox(sql.ref("r.email_activity_id"), userId));
	const source = await drafts
		.select([
			"r.status",
			"r.dismiss_reason",
			"e.conversation_id",
			"a.id",
			"a.happened_at",
		])
		.where("r.id", "=", id)
		.executeTakeFirst();
	if (!source) return;
	if (source.status === "pending")
		return {
			kind: "reply_draft",
			path: `/api/engine/home/cards/reply_draft:${id}`,
		};
	if (
		source.status !== "dismissed" ||
		source.dismiss_reason !== replacedDraftReason ||
		!source.conversation_id
	)
		return;

	const successor = await drafts
		.select("r.id")
		.where("r.status", "=", "pending")
		.where("e.conversation_id", "=", source.conversation_id)
		.where(
			sql<boolean>`(a.happened_at, a.id) > (${source.happened_at}::timestamptz, ${source.id}::uuid)`,
		)
		.orderBy("a.happened_at", "desc")
		.orderBy("a.id", "desc")
		.limit(1)
		.executeTakeFirst();
	if (successor)
		return {
			kind: "reply_draft",
			path: `/api/engine/home/cards/reply_draft:${successor.id}`,
		};
}

async function leadTarget(
	db: Transaction<DB>,
	id: string,
): Promise<ActionTarget | undefined> {
	const {
		rows: [lead],
	} = await sql<{ id: string }>`
		select coalesce(legacy.value, l.party_id::text) as id
		from lead_contact_draft d
		join party_role l on l.party_id = d.party_id and l.role = 'lead'
		left join lateral (${copiedLeadIdentity(sql.ref("l.party_id"))}) legacy on true
		where d.id = ${id} and l.lead_client_id is null
			and not exists (select from client c where c.party_id = l.party_id)
			and not exists (select from deal_party dp where dp.party_id = l.party_id
				and dp.role in ('client', 'client_contact'))
	`.execute(db);
	if (lead)
		return { kind: "lead", path: `/leads?lead=${encodeURIComponent(lead.id)}` };
}

async function callTarget(
	db: Transaction<DB>,
	userId: string,
	id: string,
): Promise<ActionTarget | undefined> {
	const proposal = await db
		.selectFrom("proposal as p")
		.innerJoin("activity as a", "a.id", "p.activity_id")
		.innerJoin("activity_about as link", (join) =>
			join
				.onRef("link.activity_id", "=", "a.id")
				.onRef("link.deal_id", "=", "p.deal_id"),
		)
		.innerJoin("deal as d", "d.id", "link.deal_id")
		.leftJoin("next_step as step", "step.id", "p.next_step_id")
		.select(["p.id", "d.id as deal_id"])
		.where("a.id", "=", id)
		.where("a.kind", "=", "call")
		.where("p.kind", "!=", "next_step_done")
		.where(visibleProposalDetail(userId))
		.orderBy("p.created_at")
		.orderBy("p.id")
		.limit(1)
		.executeTakeFirst();
	if (proposal)
		return {
			kind: "call_review",
			path: `/api/engine/home/cards/suggestion:${proposal.id}`,
			deal_id: proposal.deal_id,
			activity_id: id,
		};
}

const unavailable = () => new Refusal(404, "action_link_unavailable");

export const actionLinks = new Hono<DatabaseEnv>().get(
	"/action-links/:ref",
	async (c): Promise<Response> => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);
		const ref = parseRef(c.req.param("ref"));
		if (!ref || (ref.kind === "rd" && ref.owner !== c.get("partner").slug))
			return refuse(c, unavailable());
		return answerNextRead(c, "resolve-action-link", async (db, userId) => {
			switch (ref.kind) {
				case "rd":
					return (await replyTarget(db, userId, ref.id)) ?? unavailable();
				case "ld":
					return (await leadTarget(db, ref.id)) ?? unavailable();
				case "cr":
					return (await callTarget(db, userId, ref.id)) ?? unavailable();
			}
		});
	},
);
