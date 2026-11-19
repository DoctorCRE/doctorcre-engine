import { Hono } from "hono";
import { jsonObjectFrom } from "kysely/helpers/postgres";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import type { DatabaseEnv } from "../reader.ts";
import { isUuid } from "../uuid.ts";

export const clientLeases = new Hono<DatabaseEnv>().get(
	"/clients/:client/leases",
	async (c): Promise<Response> => {
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		if (refused) return refuse(c, refused);
		const client = c.req.param("client");
		if (!isUuid(client)) return refuse(c, new Refusal(404, "not_found"));

		return answerNextRead(c, "read-client-leases", (db) =>
			db
				.selectFrom("lease as l")
				.innerJoin("party_role as r", (join) =>
					join
						.onRef("r.party_id", "=", "l.party_id")
						.on("r.role", "=", "client"),
				)
				.innerJoin("property as p", "p.id", "l.property_id")
				.leftJoin("current_lease as v", "v.lease_id", "l.id")
				.select(["l.id as lease_id", "p.address", "v.expiration_on"])
				.select((eb) =>
					jsonObjectFrom(
						eb
							.selectFrom("deal")
							.leftJoin(
								"imported_deal_board as imported",
								"imported.deal_id",
								"deal.id",
							)
							.leftJoinLateral(
								(renewal) =>
									renewal
										.selectFrom("deal_phase_change")
										.select(["phase", "happened_at"])
										.whereRef("deal_id", "=", "deal.id")
										.orderBy("happened_at", "desc")
										.limit(1)
										.as("current_phase"),
								(join) => join.onTrue(),
							)
							.select(["deal.id as deal_id", "deal.name"])
							.whereRef("renews_lease_id", "=", "l.id")
							.where("current_phase.phase", "is distinct from", "dead")
							.where((renewal) =>
								renewal.or([
									renewal("imported.outcome", "is distinct from", "lost"),
									renewal(
										"imported.phase_at",
										"is distinct from",
										renewal.ref("current_phase.happened_at"),
									),
								]),
							)
							.orderBy("deal.created_at", "desc")
							.orderBy("deal.id", "desc")
							.limit(1),
					).as("renewed_by"),
				)
				.where("l.party_id", "=", client)
				.orderBy("p.address")
				.orderBy("v.expiration_on", (order) => order.desc().nullsLast())
				.orderBy("l.id")
				.execute(),
		);
	},
);
