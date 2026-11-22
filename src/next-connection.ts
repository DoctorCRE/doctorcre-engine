import { sql, type Transaction } from "kysely";
import type { DB } from "./next-database.d.ts";
import { connect } from "./reader.ts";

const modes = {
	read: {
		isolation: "repeatable read",
		access: "read only",
		role: sql`set local role engine_reader`,
		path: sql`set local search_path = next_partner, next, pg_temp`,
	},
	save: {
		isolation: "read committed",
		access: "read write",
		role: sql`set local role engine`,
		path: sql`set local search_path = next, pg_temp`,
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
				await settings.path.execute(tx);
				await sql`select set_config('TimeZone', 'UTC', true)`.execute(tx);
				return run(tx);
			});
	} finally {
		await db.destroy();
	}
}

export function setNextReadViewer(tx: Transaction<DB>, id: string) {
	return sql`select set_config('engine.user_id', ${id}, true)`.execute(tx);
}

export function nextPartnerRead<T>(
	connectionString: string,
	slug: string,
	run: (db: Transaction<DB>, userId: string | undefined) => Promise<T>,
): Promise<T> {
	return nextTransaction(connectionString, "read", async (tx) => {
		const user = await tx
			.selectFrom("app_user")
			.select("id")
			.where("slug", "=", slug)
			.executeTakeFirst();
		await setNextReadViewer(tx, user?.id ?? "");
		return run(tx, user?.id);
	});
}
