import type { Context } from "hono";
import { sql } from "kysely";
import type { Json } from "./database.d.ts";
import { draftContext } from "./doc-draft.ts";
import { withDocLink } from "./doc-link.ts";
import { docLinkCredential } from "./doc-link-routes.ts";
import { type DocClaimState, registerDocTools } from "./doc-tools.ts";
import type { WriterEnv } from "./save.ts";
import { isUuid } from "./uuid.ts";

const available = sql<boolean>`claim_until > clock_timestamp() + interval '15 seconds'`;

export async function docMcp(c: Context<WriterEnv>) {
	c.header("Cache-Control", "no-store");
	if (c.req.header("Origin") !== undefined) return c.body(null, 403);
	const unauthorized = () =>
		c.body(null, 401, { "WWW-Authenticate": "Bearer" });
	const credential = docLinkCredential(c);
	if (!credential) return unauthorized();
	const { DATABASE: reader, DATABASE_WRITER: writer } = c.env;
	if (!reader || !writer) return c.body(null, 503);

	try {
		const request =
			c.req.method === "POST"
				? new Request(c.req.raw, { body: await c.req.arrayBuffer() })
				: c.req.raw;
		// Load the SDK after Wrangler's bundled Zod constructors have initialized.
		const { McpServer } = await import(
			"@modelcontextprotocol/sdk/server/mcp.js"
		);
		const { WebStandardStreamableHTTPServerTransport } = await import(
			"@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
		);
		const response = await withDocLink(
			writer.connectionString,
			credential,
			async (tx, owner) => {
				const claim = c.req.header("Doc-Claim-Id");
				if (!isUuid(claim)) return c.body(null, 404);
				const {
					rows: [turn],
				} = await sql<{
					state: DocClaimState;
					partner: string;
					timeout: number;
					context: Json;
				}>`
				with locked as (
					select claim_state, claim_until, t.context, u.slug
					from doc_turn t join app_user u on u.id = t.owner_user_id
					where t.owner_user_id = ${owner} and t.claim_id = ${claim} and t.state = 'working'
					for update of t
				)
				select claim_state as state, slug as partner, context,
					least(45000, ceil(extract(epoch from claim_until - clock_timestamp()) * 1000) - 15000)::int as timeout
				from locked where ${available}
			`.execute(tx);
				if (!turn || turn.timeout <= 0) return c.body(null, 404);
				if (request.method !== "POST")
					return c.body(null, 405, { Allow: "POST" });

				const { reads } = turn.state;
				const server = new McpServer({
					name: "doctorcre-doc",
					version: "1.0.0",
				});
				const transport = new WebStandardStreamableHTTPServerTransport({
					enableJsonResponse: true,
				});
				registerDocTools(server, {
					...turn,
					owner,
					draft: draftContext.safeParse(turn.context).data,
					readConnection: reader.connectionString,
				});
				await server.connect(transport);
				try {
					const reply = await transport.handleRequest(request);
					reply.headers.set("Cache-Control", "no-store");
					if (turn.state.reads !== reads) {
						const saved = await tx
							.updateTable("doc_turn")
							.set({ claim_state: turn.state })
							.where("claim_id", "=", claim)
							.where("owner_user_id", "=", owner)
							.where(available)
							.executeTakeFirst();
						if (!saved.numUpdatedRows) return c.body(null, 404);
					}
					return reply;
				} finally {
					await server.close();
				}
			},
		);
		return response instanceof Response ? response : unauthorized();
	} catch {
		return c.body(null, 503);
	}
}
