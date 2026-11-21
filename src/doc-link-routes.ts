import type { Context } from "hono";
import { Hono } from "hono";
import {
	docLinkRefusal,
	findDocLinkOwner,
	readDocLinkHash,
} from "./doc-link.ts";
import type { DocLink } from "./doc-link-object.ts";
import type { PartnerSessionEnv } from "./partner-session.ts";
import type { WriterEnv } from "./save.ts";

export type DocLinkEnv = PartnerSessionEnv &
	WriterEnv & {
		Bindings: { DOC_LINK?: DurableObjectNamespace<DocLink> };
	};

const partnerLink = (c: Context<DocLinkEnv>) =>
	c.env.DOC_LINK?.getByName(c.get("partnerSession").appUserId);

export const docLinkRoutes = new Hono<DocLinkEnv>()
	.onError(() => docLinkRefusal(503))
	.get("/link", async (c) => {
		const link = partnerLink(c);
		return link ? c.json(await link.presence()) : docLinkRefusal(503);
	})
	.post("/link", async (c) => {
		const link = partnerLink(c);
		return link ? c.json(await link.issue(), 201) : docLinkRefusal(503);
	})
	.post("/link/revoke", async (c) => {
		const link = partnerLink(c);
		if (!link) return docLinkRefusal(503);
		await link.revoke();
		return c.body(null, 204);
	});

export async function connectDocLink(c: Context<DocLinkEnv>) {
	const hash = readDocLinkHash(c.req.header("Authorization"));
	if (!hash || c.req.header("Cookie") !== undefined) return docLinkRefusal(401);
	if (c.req.header("Upgrade")?.toLowerCase() !== "websocket")
		return docLinkRefusal(426);

	const { DOC_LINK, DATABASE_WRITER } = c.env;
	if (!DOC_LINK || !DATABASE_WRITER) return docLinkRefusal(503);
	try {
		const owner = await findDocLinkOwner(
			DATABASE_WRITER.connectionString,
			hash,
		);
		if (!owner) return docLinkRefusal(401);
		return await DOC_LINK.getByName(owner).fetch("https://doc-link/connect", {
			headers: { Upgrade: "websocket", "Doc-Link-Hash": hash },
		});
	} catch {
		return docLinkRefusal(503);
	}
}
