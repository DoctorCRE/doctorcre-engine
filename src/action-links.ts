import { Buffer } from "node:buffer";
import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "./answer.ts";
import { sourceInMailbox } from "./home-email-thread.ts";
import { copiedLeadIdentity } from "./leads/follow-up-reads.ts";
import type { DB } from "./next-database.d.ts";
import type { DatabaseEnv } from "./reader.ts";
import { replacedDraftReason } from "./reply-drafts.ts";

const legacyId =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type ActionRef =
	| { kind: "rd"; id: string; owner: "joe" | "dell" }
	| { kind: "ld" | "cr"; id: string };

type ActionTarget = { kind: "reply_draft" | "lead" | "deal"; path: string };

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
	ref: Extract<ActionRef, { kind: "rd" }>,
): Promise<ActionTarget | undefined> {
	const {
		rows: [draft],
	} = await sql<{ id: string | null }>`
		select case when r.status = 'pending' then r.id else successor.id end as id
		from reply_draft r
		join app_user owner on owner.id = r.owner_user_id
		join email e on e.activity_id = r.email_activity_id
		join activity a on a.id = e.activity_id
		left join lateral (
			select newer.id from reply_draft newer
			join email ne on ne.activity_id = newer.email_activity_id
			join activity na on na.id = ne.activity_id
			where r.status = 'dismissed' and r.dismiss_reason = ${replacedDraftReason}
				and newer.owner_user_id = r.owner_user_id and newer.status = 'pending'
				and ne.conversation_id = e.conversation_id
				and (na.happened_at, na.id) > (a.happened_at, a.id)
				and ${sourceInMailbox(sql.ref("newer.email_activity_id"), userId)}
			order by na.happened_at desc, na.id desc
			limit 1
		) successor on true
		where r.id = ${ref.id} and r.owner_user_id = ${userId} and owner.slug = ${ref.owner}
			and ${sourceInMailbox(sql.ref("r.email_activity_id"), userId)}
	`.execute(db);
	if (draft?.id)
		return {
			kind: "reply_draft",
			path: `/api/engine/home/cards/reply_draft:${draft.id}`,
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
	id: string,
): Promise<ActionTarget | undefined> {
	const [deal, other] = await db
		.selectFrom("activity_about as link")
		.innerJoin("activity as a", "a.id", "link.activity_id")
		.innerJoin("deal as d", "d.id", "link.deal_id")
		.select("d.id")
		.where("a.id", "=", id)
		.where("a.kind", "=", "call")
		.limit(2)
		.execute();
	if (deal && !other)
		return { kind: "deal", path: `/deals?deal=${deal.id}&focus=call-review` };
}

const unavailable = () => new Refusal(404, "action_link_unavailable");

export const actionLinks = new Hono<DatabaseEnv>().get(
	"/action-links/:ref",
	async (c): Promise<Response> => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);
		const ref = parseRef(c.req.param("ref"));
		if (!ref) return refuse(c, unavailable());
		return answerNextRead(
			c,
			"resolve-action-link",
			async (db, userId) => {
				switch (ref.kind) {
					case "rd":
						return (await replyTarget(db, userId, ref)) ?? unavailable();
					case "ld":
						return (await leadTarget(db, ref.id)) ?? unavailable();
					case "cr":
						return (await callTarget(db, ref.id)) ?? unavailable();
				}
			},
			{ timing: false },
		);
	},
);
