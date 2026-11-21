import { Hono } from "hono";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import type { DatabaseEnv } from "../reader.ts";
import { isUuid } from "../uuid.ts";

export const activityDealAttribution = new Hono<DatabaseEnv>().get(
	"/activities/:activity/deal-attribution",
	async (c): Promise<Response> => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);
		const activity = c.req.param("activity");
		if (!isUuid(activity)) return refuse(c, new Refusal(404, "not_found"));

		return answerNextRead(c, "read-activity-deal-attribution", async (db) => {
			const deals = await db
				.selectFrom("activity_about as link")
				.innerJoin("deal as d", "d.id", "link.deal_id")
				.select(["d.id", "d.name"])
				.where("link.activity_id", "=", activity)
				.orderBy("d.name")
				.orderBy("d.id")
				.execute();
			const [deal] = deals;
			if (!deal) return new Refusal(404, "not_found");
			if (deals.length === 1) return { kind: "credited", deal } as const;
			return { kind: "ambiguous", candidates: deals } as const;
		});
	},
);
