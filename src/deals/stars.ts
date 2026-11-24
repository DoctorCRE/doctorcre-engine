import { type Context, Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { ACTING_USER } from "../next-save.ts";
import { fit, isUuid } from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";

type StarRequest = {
	idempotency_key: string;
	deal_id: string;
	starred: boolean;
};

async function setStar(tx: Transaction<DB>, { deal_id, starred }: StarRequest) {
	const deal = await tx
		.selectFrom("deal")
		.select("id")
		.where("id", "=", deal_id)
		.executeTakeFirst();
	if (!deal) throw new SaveRefusal(new Refusal(404, "not_found"));
	if (starred)
		await tx
			.insertInto("deal_star")
			.values({ user_id: ACTING_USER, deal_id, changed_at: sql`now()` })
			.onConflict((conflict) => conflict.doNothing())
			.execute();
	else
		await tx
			.deleteFrom("deal_star")
			.where("user_id", "=", ACTING_USER)
			.where("deal_id", "=", deal_id)
			.execute();
	return { deal_id, starred };
}

function answerStar(c: Context<NextSaveEnv>, deal: string, starred: boolean) {
	return answerNextSave(
		c,
		starred ? "star-deal" : "unstar-deal",
		(body) => {
			if (!isUuid(deal)) return new Refusal(404, "not_found");
			const args = fit(body, { idempotency_key: isUuid }, ["idempotency_key"]);
			return args instanceof Refusal
				? args
				: { ...args, deal_id: deal.toLowerCase(), starred };
		},
		setStar,
	);
}

// The signed-in partner's own star; a second star or unstar leaves the same state.
export const dealStars = new Hono<NextSaveEnv>()
	.post("/deals/:deal/star", (c) => answerStar(c, c.req.param("deal"), true))
	.post("/deals/:deal/unstar", (c) =>
		answerStar(c, c.req.param("deal"), false),
	);
