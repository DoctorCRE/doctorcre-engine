import { sql, type Transaction, type Updateable } from "kysely";
import { Refusal } from "../answer.ts";
import type { DB } from "../next-database.d.ts";
import { SaveRefusal } from "../save.ts";

// Changes a deal's fields unless another save changed one of them after `seen`, the
// deal's latest change the partner's answer showed (0 for none). Other fields' changes
// stand, so two partners editing different fields both keep theirs.
export async function changeDeal(
	tx: Transaction<DB>,
	deal_id: string,
	seen: number,
	fields: Updateable<DB["deal"]>,
) {
	// The row lock queues crossed saves, so the later one sees the earlier one's change.
	const deal = await tx
		.selectFrom("deal")
		.select("id")
		.where("id", "=", deal_id)
		.forUpdate()
		.executeTakeFirst();
	if (!deal) throw new SaveRefusal(new Refusal(404, "unhandled_verb_failure"));
	const changes = tx
		.selectFrom("change")
		.where("table_name", "=", "deal")
		.where("record", "=", { id: deal_id });
	const crossed = await changes
		.select("id")
		.orderBy("id", "desc")
		.where("id", ">", String(seen))
		.where(sql<boolean>`new_value ?| ${Object.keys(fields)}::text[]`)
		.executeTakeFirst();
	if (crossed)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", {
				current_change_id: Number(crossed.id),
			}),
		);
	await tx.updateTable("deal").set(fields).where("id", "=", deal_id).execute();
	const latest = await changes
		.select((eb) => eb.fn.max("id").as("id"))
		.executeTakeFirstOrThrow();
	return { deal_id, change_id: latest.id === null ? seen : Number(latest.id) };
}
