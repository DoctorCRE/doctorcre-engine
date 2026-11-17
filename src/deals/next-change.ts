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
	const keys = Object.keys(fields);
	if (!keys.length)
		throw new SaveRefusal(new Refusal(400, "unhandled_verb_failure"));
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
	const unseen = await changes
		.select("id")
		.select(sql<boolean>`new_value ?| ${keys}::text[]`.as("crossed"))
		.where("id", ">", String(seen))
		.orderBy("id")
		.execute();
	const ids = unseen.map((change) => Number(change.id));
	if (unseen.some((change) => change.crossed))
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { current_version: ids.at(-1) }),
		);
	await tx.updateTable("deal").set(fields).where("id", "=", deal_id).execute();
	// An answer's change id would cover the unseen changes, so the app re-reads first.
	if (ids.length)
		return { deal_id, rebased: true, intervening_change_ids: ids };
	const latest = await changes
		.select((eb) => eb.fn.max("id").as("id"))
		.executeTakeFirstOrThrow();
	return { deal_id, change_id: latest.id === null ? seen : Number(latest.id) };
}
