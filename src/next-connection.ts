import { sql, type Transaction } from "kysely";
import type { DB } from "./next-database.d.ts";
import { connect } from "./reader.ts";

export async function nextTransaction<T>(
	connectionString: string,
	mode: "read" | "save",
	run: (db: Transaction<DB>) => Promise<T>,
): Promise<T> {
	const db = connect<DB>(connectionString);
	try {
		return await db
			.transaction()
			.setIsolationLevel(mode === "read" ? "repeatable read" : "read committed")
			.setAccessMode(mode === "read" ? "read only" : "read write")
			.execute(async (tx) => {
				await (mode === "read"
					? sql`set local role engine_reader`
					: sql`set local role engine`
				).execute(tx);
				await sql`set local search_path = next, pg_temp`.execute(tx);
				await sql`select set_config('TimeZone', 'UTC', true)`.execute(tx);
				return run(tx);
			});
	} finally {
		await db.destroy();
	}
}
