import { Hono } from "hono";
import { Refusal, refuse } from "../answer.ts";
import { nextTransaction } from "../next-connection.ts";
import type { NextSaveEnv } from "../next-door.ts";

export const leadSourceSenders = new Hono<NextSaveEnv>().get(
	"/leads/sources",
	async (c) => {
		const { job } = c.get("stamp");
		if (!job) return refuse(c, new Refusal(403, "unknown_job"));
		const database = c.env.DATABASE;
		if (!database) return refuse(c, new Refusal(503, "database_unavailable"));
		try {
			const result = await nextTransaction(
				database.connectionString,
				"read",
				async (tx) => {
					const registered = await tx
						.selectFrom("job")
						.select("slug")
						.where("slug", "=", job)
						.executeTakeFirst();
					if (!registered) return new Refusal(403, "unknown_job");
					const senders = await tx
						.selectFrom("lead_source_sender")
						.select(["address", "domain", "name", "fields"])
						.orderBy("name")
						.execute();
					return { senders };
				},
			);
			return result instanceof Refusal ? refuse(c, result) : c.json(result);
		} catch {
			return refuse(c, new Refusal(503, "database_unavailable"));
		}
	},
);
