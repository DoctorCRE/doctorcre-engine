import { sql, type Transaction } from "kysely";
import type { DB } from "./next-database.d.ts";
import { connect } from "./reader.ts";

const modes = {
	read: {
		isolation: "repeatable read",
		access: "read only",
		role: sql`set local role engine_reader`,
	},
	save: {
		isolation: "read committed",
		access: "read write",
		role: sql`set local role engine`,
	},
} as const;

export async function nextTransaction<T>(
	connectionString: string,
	mode: "read" | "save",
	run: (db: Transaction<DB>) => Promise<T>,
): Promise<T> {
	const db = connect<DB>(connectionString);
	const settings = modes[mode];
	try {
		return await db
			.transaction()
			.setIsolationLevel(settings.isolation)
			.setAccessMode(settings.access)
			.execute(async (tx) => {
				await settings.role.execute(tx);
				await sql`set local search_path = next, pg_temp`.execute(tx);
				await sql`select set_config('TimeZone', 'UTC', true)`.execute(tx);
				return run(tx);
			});
	} finally {
		await db.destroy();
	}
}
