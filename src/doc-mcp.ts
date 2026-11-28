import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "hono";
import { withDocLink } from "./doc-link.ts";
import { docLinkCredential } from "./doc-link-routes.ts";
import { withDocTools } from "./doc-tool-session.ts";
import type { WriterEnv } from "./save.ts";
import { isUuid } from "./uuid.ts";

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
		const { WebStandardStreamableHTTPServerTransport } = await import(
			"@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
		);
		const response = await withDocLink(
			writer.connectionString,
			credential,
			async (tx, owner) => {
				const claim = c.req.header("Doc-Claim-Id");
				async function reply(server: McpServer) {
					if (request.method !== "POST")
						return c.body(null, 405, { Allow: "POST" });
					const transport = new WebStandardStreamableHTTPServerTransport({
						enableJsonResponse: true,
					});
					await server.connect(transport);
					const response = await transport.handleRequest(request);
					response.headers.set("Cache-Control", "no-store");
					return response;
				}
				if (claim === "readiness") {
					const { McpServer } = await import(
						"@modelcontextprotocol/sdk/server/mcp.js"
					);
					const server = new McpServer(
						{ name: "doctorcre-doc", version: "1.0.0" },
						{ capabilities: { tools: {} } },
					);
					try {
						return await reply(server);
					} finally {
						await server.close();
					}
				}
				if (!isUuid(claim)) return c.body(null, 404);
				return (
					(await withDocTools(
						tx,
						owner,
						claim,
						reader.connectionString,
						reply,
					)) ?? c.body(null, 404)
				);
			},
		);
		return response instanceof Response ? response : unauthorized();
	} catch {
		return c.body(null, 503);
	}
}
