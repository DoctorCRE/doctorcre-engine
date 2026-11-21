import { type Context, Hono } from "hono";
import type { Transaction } from "kysely";
import {
	docLinkOwnerTransaction,
	docLinkPresence,
	issueDocLink,
	recordDocLinkPoll,
	revokeDocLink,
	withDocLink,
} from "./doc-link.ts";
import type { DB } from "./next-database.d.ts";
import type { PartnerSessionEnv } from "./partner-session.ts";
import type { WriterEnv } from "./save.ts";

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

export async function claimDocLink(c: Context<WriterEnv>) {
	const credential = docLinkCredential(c);
	if (!credential) return unauthorized();

	const writer = c.env.DATABASE_WRITER;
	if (!writer) return unavailable();
	try {
		const result = await withDocLink(
			writer.connectionString,
			credential,
			recordDocLinkPoll,
		);
		if (result === null) return unauthorized();
		return new Response(null, { status: 204, headers: noStore });
	} catch {
		return unavailable();
	}
}
