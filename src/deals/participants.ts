import { Hono } from "hono";
import { sql } from "kysely";
import { Refusal } from "../answer.ts";
import type { JsonObject } from "../database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { fit, isText, isUuid } from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";

function parseParticipant(deal_id: string, body: JsonObject) {
	if (!isUuid(deal_id)) return new Refusal(404, "not_found");
	const args = fit(
		body,
		{ idempotency_key: isUuid, party_id: isUuid, role: isText },
		["idempotency_key", "party_id", "role"],
	);
	return args instanceof Refusal ? args : { ...args, deal_id };
}

export const dealParticipants = new Hono<NextSaveEnv>()
	.post("/deals/:deal/parties", (c) =>
		answerNextSave(
			c,
			"add_deal_party",
			(body) => parseParticipant(c.req.param("deal"), body),
			(tx, { deal_id, party_id, role }) =>
				tx
					.insertInto("deal_party")
					.values({ deal_id, party_id, role, changed_at: sql<string>`now()` })
					.returning(["deal_id", "party_id", "role"])
					.executeTakeFirstOrThrow(),
			201,
		),
	)
	.post("/deals/:deal/parties/remove", (c) =>
		answerNextSave(
			c,
			"remove_deal_party",
			(body) => parseParticipant(c.req.param("deal"), body),
			async (tx, { deal_id, party_id, role }) => {
				const removed = await tx
					.deleteFrom("deal_party")
					.where("deal_id", "=", deal_id)
					.where("party_id", "=", party_id)
					.where("role", "=", role)
					.returning(["deal_id", "party_id", "role"])
					.executeTakeFirst();
				if (!removed) throw new SaveRefusal(new Refusal(404, "not_found"));
				return removed;
			},
		),
	);
