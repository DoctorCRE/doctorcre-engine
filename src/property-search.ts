import { Hono } from "hono";
import { sql } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "./answer.ts";
import type { DatabaseEnv } from "./reader.ts";
import { isStoredText } from "./request-shape.ts";

export const propertySearch = new Hono<DatabaseEnv>().get(
	"/properties/search",
	async (c): Promise<Response> => {
		const params = new URL(c.req.url).searchParams;
		const refused = checkFields(params, ["query"]);
		if (refused) return refuse(c, refused);
		const [query = "", ...extra] = params.getAll("query");
		const term = query.trim();
		if (extra.length || !isStoredText(term) || [...query].length > 100)
			return refuse(
				c,
				new Refusal(400, "invalid_field_value", { fields: ["query"] }),
			);
		return answerNextRead(c, "search-properties", async (db) => ({
			properties: await db
				.selectFrom("property")
				.select(["id", "name", "address"])
				.where(sql<boolean>`strpos(lower(name), lower(${term})) > 0
					or strpos(lower(address), lower(${term})) > 0`)
				.orderBy(sql`lower(coalesce(name, address)) collate "C"`)
				.orderBy("id")
				.limit(25)
				.execute(),
		}));
	},
);
