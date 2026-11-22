import { Hono } from "hono";
import { type Expression, sql, type Transaction } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import { failureKind } from "../failure.ts";
import { nextTransaction } from "../next-connection.ts";
import type { DB } from "../next-database.d.ts";
import type { NextSaveEnv } from "../next-door.ts";
import { ACTING_USER, stampNextSave } from "../next-save.ts";
import type { DatabaseEnv } from "../reader.ts";
import { SaveRefusal } from "../save.ts";
import { isUuid } from "../uuid.ts";
import { isOpenBoardDeal, selectNextDeals } from "./next-board.ts";
import { selectDealParties } from "./next-detail.ts";

const MAX_DEALS = 50;

function callContextIds(url: string) {
	const params = new URL(url).searchParams;
	const refused = checkFields(params, ["deal_id"]);
	if (refused) return refused;
	const ids = params.getAll("deal_id");
	if (
		ids.length === 0 ||
		ids.length > MAX_DEALS ||
		!ids.every(isUuid) ||
		new Set(ids.map((id) => id.toLowerCase())).size !== ids.length
	) {
		return new Refusal(400, "invalid_field_value", { fields: ["deal_id"] });
	}
	return ids;
}

async function readCallContext(
	db: Transaction<DB>,
	userId: string | Expression<string>,
	dealIds: string[],
) {
	const partner = await db
		.selectFrom("app_user")
		.select("id")
		.where("id", "=", userId)
		.where("is_account_partner", "=", true)
		.executeTakeFirst();
	if (!partner) return new Refusal(403, "AUTHORIZATION_REFUSED");

	const candidates = selectNextDeals(db).where("d.id", "in", dealIds);
	const rows = await db
		.selectFrom(candidates.as("board"))
		.where(isOpenBoardDeal)
		.where("board.operating_state", "=", "active")
		.select((eb) => [
			"board.id",
			"board.name",
			"board.owner",
			"board.operating_state",
			jsonArrayFrom(
				selectDealParties(db, eb.ref("board.id"))
					.where("u.id", "is", null)
					.select(({ selectFrom }) => [
						"dp.party_id",
						"p.name",
						"dp.role",
						sql<string>`coalesce((select min(value) from outside_id
							where party_id = p.id and source = 'old_system_ref' and value like 'P-%'
							having count(*) = 1), p.id::text)`.as("ref"),
						selectFrom("party_email")
							.select("address")
							.whereRef("party_email.party_id", "=", "p.id")
							.where("is_primary", "=", true)
							.as("email"),
					])
					.orderBy("dp.party_id"),
			).as("participants"),
		])
		.execute();

	const byId = new Map(rows.map((deal) => [deal.id, deal]));
	const deals: typeof rows = [];
	const unavailable_deal_ids: string[] = [];
	for (const id of dealIds) {
		const deal = byId.get(id.toLowerCase());
		if (deal) deals.push({ ...deal, id });
		else unavailable_deal_ids.push(id);
	}
	return { deals, unavailable_deal_ids };
}

export const dealCallContext = new Hono<DatabaseEnv>().get(
	"/call-context",
	async (c): Promise<Response> => {
		const ids = callContextIds(c.req.url);
		if (ids instanceof Refusal) return refuse(c, ids);
		return answerNextRead(c, "get-call-context", (db, userId) =>
			readCallContext(db, userId, ids),
		);
	},
);

export const callContextJobs = new Hono<NextSaveEnv>().get(
	"/call-context",
	async (c) => {
		const stamp = c.get("stamp");
		if (stamp.job !== "call_capture" || !stamp.for_user)
			return refuse(c, new Refusal(403, "AUTHORIZATION_REFUSED"));
		const ids = callContextIds(c.req.url);
		if (ids instanceof Refusal) return refuse(c, ids);
		const database = c.env.DATABASE;
		if (!database) return refuse(c, new Refusal(503, "database_unavailable"));
		try {
			const result = await nextTransaction(
				database.connectionString,
				"read",
				async (db) => {
					await stampNextSave(db, stamp);
					return readCallContext(db, ACTING_USER, ids);
				},
			);
			return result instanceof Refusal ? refuse(c, result) : c.json(result);
		} catch (error) {
			if (error instanceof SaveRefusal) return refuse(c, error.refusal);
			console.warn("call context read failed:", failureKind(error));
			return refuse(c, new Refusal(503, "database_unavailable"));
		}
	},
);
