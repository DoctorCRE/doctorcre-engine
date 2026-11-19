import type { ExpressionBuilder } from "kysely";
import type { DB } from "./next-database.d.ts";

export function partyMatchFields(eb: ExpressionBuilder<DB, "party">) {
	return [
		eb.ref("party.city").as("city"),
		eb
			.selectFrom("deal_party")
			.select((eb) =>
				eb
					.cast<number>(eb.fn.count("deal_id").distinct(), "integer")
					.as("count"),
			)
			.whereRef("party_id", "=", "party.id")
			.$asScalar()
			.$notNull()
			.as("deal_count"),
		eb
			.exists(
				eb
					.selectFrom("national_account")
					.select("party_id")
					.whereRef("party_id", "=", "party.id"),
			)
			.as("is_national_account"),
	];
}
