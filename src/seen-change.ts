import { sql, type Transaction } from "kysely";
import { Refusal } from "./answer.ts";
import type { DB } from "./next-database.d.ts";
import { SaveRefusal } from "./save.ts";

type RecordedIds = {
	commission_payment: string;
	deal: string;
	national_account_owner: string;
	next_step: string;
	party_role: { party_id: string; role: "lead" };
};
type Recorded = keyof RecordedIds;

const history = <Table extends Recorded>(
	tx: Transaction<DB>,
	table: Table,
	id: RecordedIds[Table],
) =>
	tx
		.selectFrom("change")
		.where("table_name", "=", table)
		.where("record", "=", typeof id === "string" ? { id } : id);

// A row's changes after `seen`, the latest its caller read (0 for none). Run under the row's
// lock; a later change to one of `keys` refuses the save, and later changes to other fields stand.
export async function unseenChanges<Table extends Recorded>(
	tx: Transaction<DB>,
	table: Table,
	id: RecordedIds[Table],
	seen: number,
	keys: readonly string[],
) {
	const unseen = await history(tx, table, id)
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
	return ids;
}

export async function latestChange<Table extends Recorded>(
	tx: Transaction<DB>,
	table: Table,
	id: RecordedIds[Table],
) {
	const latest = await history(tx, table, id)
		.select((eb) => eb.fn.max("id").as("id"))
		.executeTakeFirstOrThrow();
	return latest.id === null ? null : Number(latest.id);
}

// An answer's change id would cover the unseen changes, so the caller re-reads first.
export const seenAnswer = async <Table extends Recorded>(
	tx: Transaction<DB>,
	table: Table,
	id: RecordedIds[Table],
	seen: number,
	unseen: readonly number[],
) =>
	unseen.length
		? { rebased: true, intervening_change_ids: [...unseen] }
		: { change_id: (await latestChange(tx, table, id)) ?? seen };
