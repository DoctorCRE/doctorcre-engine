import { sql, type Transaction } from "kysely";
import pg from "pg";
import { Refusal } from "./answer.ts";
import type { DB } from "./next-database.d.ts";
import { SaveRefusal } from "./save.ts";

type StepOwner = {
	deal_id?: string | null | undefined;
	party_id?: string | null | undefined;
	owner_party_id?: string | null | undefined;
};

export async function saveOpenStep<T>(
	tx: Transaction<DB>,
	step: StepOwner,
	save: () => Promise<T>,
): Promise<T> {
	await sql`savepoint open_step`.execute(tx);
	try {
		const result = await save();
		await sql`release savepoint open_step`.execute(tx);
		return result;
	} catch (error) {
		if (
			!(error instanceof pg.DatabaseError) ||
			error.code !== "23505" ||
			error.constraint !== "next_step_one_open_per_owner"
		)
			throw error;
		// Clear the failed statement so a new snapshot can see a concurrent winner.
		await sql`rollback to savepoint open_step`.execute(tx);
		const owner =
			step.owner_party_id === undefined
				? sql`nullif(current_setting('engine.user_id', true), '')::uuid`
				: sql`${step.owner_party_id}::uuid`;
		const {
			rows: [existing],
		} = await sql<{ id: string }>`
			select id from next_step
			where status = 'open' and item_title is null and property_id is null
				and owner_party_id = ${owner}
				and deal_id is not distinct from ${step.deal_id ?? null}::uuid
				and party_id is not distinct from ${step.party_id ?? null}::uuid`.execute(
			tx,
		);
		throw new SaveRefusal(
			new Refusal(409, "open_step_exists", {
				next_step_id: existing?.id ?? null,
			}),
		);
	}
}
