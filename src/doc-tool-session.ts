import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sql, type Transaction } from "kysely";
import type { Json } from "./database.d.ts";
import { draftContext } from "./doc-confirmation.ts";
import { type DocClaimState, registerDocTools } from "./doc-tools.ts";
import type { DB } from "./next-database.d.ts";

const available = sql<boolean>`claim_until > clock_timestamp() + interval '15 seconds'`;

export async function withDocTools<T>(
	tx: Transaction<DB>,
	owner: string,
	claim: string,
	readConnection: string,
	run: (server: McpServer, timeout: number) => Promise<T>,
) {
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
	if (!turn || turn.timeout <= 0) return;
	// Load the SDK after Wrangler's bundled Zod constructors have initialized.
	const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
	const server = new McpServer({ name: "doctorcre-doc", version: "1.0.0" });
	const { reads } = turn.state;
	registerDocTools(server, {
		...turn,
		partnerId: owner,
		draft: draftContext.safeParse(turn.context).data,
		readConnection,
	});
	try {
		const result = await run(server, turn.timeout);
		if (turn.state.reads !== reads) {
			const saved = await tx
				.updateTable("doc_turn")
				.set({ claim_state: turn.state })
				.where("claim_id", "=", claim)
				.where("owner_user_id", "=", owner)
				.where(available)
				.executeTakeFirst();
			if (!saved.numUpdatedRows) return;
		}
		return result;
	} finally {
		await server.close();
	}
}
