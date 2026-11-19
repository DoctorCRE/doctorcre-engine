import type { Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import type { DB } from "../next-database.d.ts";
import { SaveRefusal } from "../save.ts";

export async function lockLead(
	tx: Transaction<DB>,
	partyId: string,
	clientId?: string,
) {
	// Deal links need key-share. Lock both parties in ID order for crossed conversions.
	await tx
		.selectFrom("party")
		.select("id")
		.where("id", "in", clientId ? [partyId, clientId] : [partyId])
		.orderBy("id")
		.forUpdate()
		.execute();
	return tx
		.selectFrom("party_role")
		.select("stage")
		.where("party_id", "=", partyId)
		.where("role", "=", "lead")
		.forNoKeyUpdate()
		.executeTakeFirst();
}

export async function requireProspect(
	tx: Transaction<DB>,
	partyId: string,
	stage: string | null | undefined,
) {
	const deal = await tx
		.selectFrom("deal_party")
		.select("deal_id")
		.where("party_id", "=", partyId)
		.executeTakeFirst();
	if (stage !== "opportunity" || deal)
		throw new SaveRefusal(
			new Refusal(409, "not_a_prospect", { party_id: partyId }),
		);
}
