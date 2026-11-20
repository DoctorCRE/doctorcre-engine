import { Hono } from "hono";
import {
	answer,
	answerNextRead,
	checkFields,
	Refusal,
	refuse,
} from "../answer.ts";
import type { DatabaseEnv } from "../reader.ts";
import { readFind } from "./find.ts";
import { readNextFind } from "./next-find.ts";

export const search = new Hono<
	DatabaseEnv & { Bindings: { SEARCH_READ_SCHEMA?: string } }
>();

search.get("/find", async (c): Promise<Response> => {
	const params = new URL(c.req.url).searchParams;
	const refused = checkFields(params, ["query"]);
	if (refused) return refuse(c, refused);
	// Untrimmed, as the app sends it. A repeated query is the old input's list:
	// present, so only absent or a lone empty value counts as missing.
	const [query, ...more] = params.getAll("query");
	if (query === undefined || (!query && more.length === 0))
		return refuse(
			c,
			new Refusal(400, "missing_required", { fields: ["query"] }),
		);
	if (c.env.SEARCH_READ_SCHEMA === "next")
		return answerNextRead(
			c,
			"find",
			async (db) => await readNextFind(db, query),
		);
	return answer(c, "find", async (db) => await readFind(db, query));
});
