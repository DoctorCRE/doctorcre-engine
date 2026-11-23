import { Hono } from "hono";
import {
	BusinessRefusal,
	isOneOf,
	PARTNERS,
	refusalOf,
} from "../clients/read.ts";
import { nextPartnerRead } from "../next-connection.ts";
import { type DatabaseEnv, readSnapshot } from "../reader.ts";
import { isUuid } from "../request-shape.ts";
import { selectStepsWithOrigin } from "../step-origin.ts";
import { projectNetwork, readNetwork } from "./network.ts";
import { readNextNetwork } from "./next-network.ts";

const CONTRACT = "relationship-network.v1";

export const relationships = new Hono<
	DatabaseEnv & { Bindings: { RELATIONSHIPS_READ_SCHEMA?: string } }
>();

// The old door checks the partner before the query.
relationships.get("/relationships", async (c) => {
	const database = c.env.DATABASE;
	const params = new URL(c.req.url).searchParams;
	try {
		if (!database)
			throw new BusinessRefusal({ error: "DEPENDENCY_UNAVAILABLE" });
		const partner = c.get("partner").slug;
		if (!isOneOf(PARTNERS, partner))
			throw new BusinessRefusal({ error: "AUTHORIZATION_REFUSED" });
		const fromNext = c.env.RELATIONSHIPS_READ_SCHEMA === "next";
		const step = params.get("step");
		if (
			params.get("contract") !== CONTRACT ||
			[...params].length !== (step === null ? 1 : 2) ||
			(step !== null && (!fromNext || !isUuid(step)))
		)
			throw new BusinessRefusal({ error: "QUERY_INVALID" });
		if (fromNext) {
			return await nextPartnerRead(
				database.connectionString,
				partner,
				async (db) => {
					const snapshot = await readNextNetwork(db);
					const focusedStep =
						step === null
							? undefined
							: await selectStepsWithOrigin(db)
									.innerJoin(
										"app_user as owner",
										"owner.id",
										"s.owner_party_id",
									)
									.select(["s.id", "s.party_id", "s.what", "s.status"])
									.where("s.id", "=", step)
									.where("owner.slug", "=", partner)
									.where("s.party_id", "is not", null)
									.where("s.status", "in", ["open", "done"])
									.executeTakeFirst();
					return c.json({
						...projectNetwork(snapshot, new Date()),
						can_request_introductions: false,
						...(step !== null && { focused_step: focusedStep ?? null }),
					});
				},
			);
		}
		const snapshot = await readSnapshot(database.connectionString, readNetwork);
		// The old clock is read after the query.
		return c.json(projectNetwork(snapshot, new Date()));
	} catch (error) {
		const refusal = refusalOf(error);
		return c.json(refusal.body, refusal.status);
	}
});
