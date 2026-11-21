import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Context } from "hono";
import { sql } from "kysely";
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
	const writer = c.env.DATABASE_WRITER;
	if (!writer) return c.body(null, 503);

	try {
		const body = c.req.method === "POST" ? await c.req.arrayBuffer() : null;
		const request = new Request(c.req.url, {
			method: c.req.method,
			headers: c.req.raw.headers,
			body,
		});
		const connection = writer.connectionString;
		const response = await withDocLink(
			connection,
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
				}>`
				with locked as (
					select claim_state, claim_until, u.slug
					from doc_turn t join app_user u on u.id = t.owner_user_id
					where t.owner_user_id = ${owner} and t.claim_id = ${claim} and t.state = 'working'
					for update of t
				)
				select claim_state as state, slug as partner,
					least(45000, ceil(extract(epoch from claim_until - clock_timestamp()) * 1000) - 15000)::int as timeout
				from locked where ${available}
			`.execute(tx);
				if (!turn || turn.timeout <= 0) return c.body(null, 404);
				if (request.method !== "POST")
					return c.body(null, 405, { Allow: "POST" });

				const { reads, failed } = turn.state;
				const server = new McpServer({
					name: "doctorcre-doc",
					version: "1.0.0",
				});
				const transport = new WebStandardStreamableHTTPServerTransport({
					enableJsonResponse: true,
				});
				registerDocTools(server, { ...turn, connection });
				await server.connect(transport);
				try {
					const reply = await transport.handleRequest(request);
					reply.headers.set("Cache-Control", "no-store");
					if (turn.state.reads !== reads || turn.state.failed !== failed) {
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
		return response ?? unauthorized();
	} catch {
		return c.body(null, 503);
	}
}
