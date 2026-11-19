import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { recordActivity } from "../activity/next-record.ts";
import { Refusal } from "../answer.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { fit, isStoredText, isUuid, optional } from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { latestChange } from "../seen-change.ts";

const attribution = (value: unknown): value is string =>
	isStoredText(value) && value !== "not_recorded";
const isPartyKind = (value: unknown): value is "person" | "company" =>
	value === "person" || value === "company";

const COMMON = {
	idempotency_key: isUuid,
	note: optional(isStoredText),
};

function parseProspect(body: JsonObject) {
	return "party_id" in body
		? fit(
				body,
				{ ...COMMON, party_id: isUuid, how_found: optional(attribution) },
				["idempotency_key", "party_id"],
			)
		: fit(
				body,
				{
					...COMMON,
					name: isStoredText,
					kind: isPartyKind,
					how_found: attribution,
				},
				["idempotency_key", "name", "kind", "how_found"],
			);
}

type ProspectRequest = Exclude<ReturnType<typeof parseProspect>, Refusal>;

async function prepareParty(tx: Transaction<DB>, request: ProspectRequest) {
	if (!("party_id" in request)) {
		const party = await tx
			.insertInto("party")
			.values({
				name: request.name.trim(),
				kind: request.kind,
				how_found: request.how_found,
				changed_at: sql<string>`now()`,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		return { id: party.id, existing: false };
	}

	const { party_id, how_found } = request;
	// A deal link needs key-share on the party, so this lock holds lane membership during the save.
	const party = await tx
		.selectFrom("party")
		.select("how_found")
		.where("id", "=", party_id)
		.forUpdate()
		.executeTakeFirst();
	if (!party) throw new SaveRefusal(new Refusal(404, "not_found"));

	const deals = await tx
		.selectFrom("deal_party")
		.select("deal_id")
		.distinct()
		.where("party_id", "=", party_id)
		.orderBy("deal_id")
		.execute();
	if (deals.length)
		throw new SaveRefusal(
			new Refusal(409, "not_a_prospect", {
				party_id,
				deal_ids: deals.map(({ deal_id }) => deal_id),
			}),
		);
	const roles = await tx
		.selectFrom("party_role")
		.select(["role", "stage"])
		.where("party_id", "=", party_id)
		.where("role", "in", ["lead", "client"])
		.forNoKeyUpdate()
		.execute();
	if (roles.some(({ role }) => role === "client"))
		throw new SaveRefusal(new Refusal(409, "already_client", { party_id }));

	if (party.how_found === null || party.how_found === "not_recorded") {
		if (!how_found)
			throw new SaveRefusal(
				new Refusal(400, "missing_required", { fields: ["how_found"] }),
			);
		await tx
			.updateTable("party")
			.set({ how_found })
			.where("id", "=", party_id)
			.execute();
	}
	return {
		id: party_id,
		existing: roles.some(({ stage }) => stage === "opportunity"),
	};
}

async function addProspect(tx: Transaction<DB>, request: ProspectRequest) {
	const { id: party_id, existing } = await prepareParty(tx, request);
	if (!existing) {
		await tx
			.insertInto("party_role")
			.values({
				party_id,
				role: "lead",
				stage: "opportunity",
				changed_at: sql<string>`now()`,
			})
			.onConflict((conflict) =>
				conflict
					.columns(["party_id", "role"])
					.doUpdateSet({ stage: "opportunity" }),
			)
			.execute();
	}
	const note =
		request.note &&
		(await recordActivity(tx, {
			idempotency_key: request.idempotency_key,
			kind: "note",
			summary: request.note,
			from_party_id: null,
			reached: null,
			about: [{ party_id }],
			email: null,
		}));
	return {
		party_id,
		activity_id: note ? note.activity_id : null,
		change_id:
			(await latestChange(tx, "party_role", { party_id, role: "lead" })) ?? 0,
		existing,
	};
}

export const prospectAdd = new Hono<NextSaveEnv>().post("/prospects", (c) =>
	answerNextSave(c, "add-prospect", parseProspect, addProspect, 201),
);
