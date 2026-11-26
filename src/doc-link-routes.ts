import { type Context, Hono } from "hono";
import type { Transaction } from "kysely";
import {
	docLinkOwnerTransaction,
	docLinkPresence,
	docLinkReadiness,
	issueDocLink,
	recordDocPoll,
	revokeDocLink,
	withDocLink,
} from "./doc-link.ts";
import { claimDocWork, finishDocJudgment, finishDocTurn } from "./doc-queue.ts";
import type { DB } from "./next-database.d.ts";
import type { PartnerSessionEnv } from "./partner-session.ts";
import type { WriterEnv } from "./save.ts";
import { isArguments } from "./save-door.ts";
import { isUuid } from "./uuid.ts";

type DocLinkEnv = PartnerSessionEnv & WriterEnv;

const noStore = { "Cache-Control": "no-store" };
const unavailable = () =>
	Response.json(
		{ error: "doc_link_unavailable" },
		{ status: 503, headers: noStore },
	);
const unauthorized = () =>
	Response.json({ error: "unauthorized" }, { status: 401, headers: noStore });

function manageLink<T>(
	c: Context<DocLinkEnv>,
	run: (tx: Transaction<DB>, owner: string) => Promise<T>,
) {
	const writer = c.env.DATABASE_WRITER;
	if (!writer) throw new Error("Doc link database unavailable");
	const owner = c.get("partnerSession").appUserId;
	return docLinkOwnerTransaction(writer.connectionString, owner, (tx) =>
		run(tx, owner),
	);
}

export const docLinkRoutes = new Hono<DocLinkEnv>()
	.onError(unavailable)
	.get("/link", async (c) => c.json(await manageLink(c, docLinkPresence)))
	.post("/link", async (c) => c.json(await manageLink(c, issueDocLink), 201))
	.post("/link/revoke", async (c) => {
		await manageLink(c, revokeDocLink);
		return c.body(null, 204);
	});

export function docLinkCredential(c: Context<WriterEnv>) {
	if (c.req.header("Cookie") !== undefined) return undefined;
	return c.req
		.header("Authorization")
		?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
}

async function withMac(
	c: Context<WriterEnv>,
	run: (tx: Transaction<DB>, owner: string) => Promise<Response>,
) {
	const credential = docLinkCredential(c);
	if (!credential) return unauthorized();
	const writer = c.env.DATABASE_WRITER;
	if (!writer) return unavailable();
	try {
		return (
			(await withDocLink(writer.connectionString, credential, run)) ??
			unauthorized()
		);
	} catch {
		return unavailable();
	}
}

export function claimDocLink(c: Context<WriterEnv>) {
	return withMac(c, async (tx, owner) => {
		const header = c.req.header("Doc-Link-Readiness");
		const readiness = docLinkReadiness.find((value) => value === header);
		if (header !== undefined && !readiness)
			return Response.json(
				{ error: "invalid_readiness" },
				{ status: 400, headers: noStore },
			);

		await recordDocPoll(tx, owner, readiness);
		const asked = new Set(
			c.req
				.header("Doc-Link-Work")
				?.split(",")
				.map((token) => token.trim()),
		);
		const work =
			readiness === "ready"
				? await claimDocWork(
						tx,
						owner,
						asked.has("judgment")
							? asked.has("email_split")
								? "mac_with_split"
								: "mac_with_judgment"
							: "mac",
					)
				: null;
		return work
			? Response.json(work, { headers: noStore })
			: new Response(null, { status: 204, headers: noStore });
	});
}

export async function completeDocLink(c: Context<WriterEnv>) {
	const body: unknown = await c.req.json().catch(() => null);
	return withMac(c, async (tx, owner) => {
		if (!isArguments(body) || !isUuid(body.claim_id))
			return new Response(null, { status: 400, headers: noStore });

		const { claim_id, kind } = body;
		const fields = Object.keys(body).length;
		if (kind === "judgment" && fields === 3 && Object.hasOwn(body, "outcome")) {
			const status = await finishDocJudgment(tx, owner, claim_id, body.outcome);
			return new Response(null, { status, headers: noStore });
		}
		const result: Parameters<typeof finishDocTurn>[2] | null =
			kind === "answered" && fields === 3 && Object.hasOwn(body, "answer")
				? { claim_id, kind, answer: body.answer }
				: (kind === "failed" ||
							kind === "signed_out" ||
							kind === "plan_limited") &&
						fields === 2
					? { claim_id, kind }
					: null;
		const status = result ? await finishDocTurn(tx, owner, result) : 400;
		return new Response(null, { status, headers: noStore });
	});
}
