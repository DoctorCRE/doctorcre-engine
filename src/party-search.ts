import { Hono } from "hono";
import { sql } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "./answer.ts";
import type { DatabaseEnv } from "./reader.ts";

export const partySearch = new Hono<DatabaseEnv>().get(
	"/parties/search",
	async (c): Promise<Response> => {
		const params = new URL(c.req.url).searchParams;
		const refused = checkFields(params, ["query", "kind", "role"], {
			vocabularies: { kind: ["person", "company"], role: ["client"] },
		});
		if (refused) return refuse(c, refused);

		const [query = "", ...extraQueries] = params.getAll("query");
		const prefix = query.trim();
		if (
			!prefix ||
			[...query].length > 100 ||
			extraQueries.length ||
			query.includes("\0")
		)
			return refuse(
				c,
				new Refusal(400, "invalid_field_value", { fields: ["query"] }),
			);

		const kind = params.get("kind");
		const clientOnly = params.get("role") === "client";
		return answerNextRead(c, "search-parties-v1", async (db) => {
			const sortName = sql<string>`lower(name) collate "C"`;
			let matches = db
				.selectFrom("party")
				.select(["id", "name as display_name", "kind"])
				.where(sql<boolean>`starts_with(${sortName}, lower(${prefix}))`);
			if (kind !== null) matches = matches.where("kind", "=", kind);
			if (clientOnly)
				matches = matches.where(({ exists, selectFrom }) =>
					exists(
						selectFrom("party_role")
							.select("party_id")
							.whereRef("party_id", "=", "party.id")
							.where("role", "=", "client"),
					),
				);

			const parties = await matches
				.orderBy(sortName)
				.orderBy("id")
				.limit(25)
				.execute();
			return { ok: true, schema_version: "party-search.v1", parties };
		});
	},
);
