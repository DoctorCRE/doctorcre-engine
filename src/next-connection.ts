import { sql, type Transaction } from "kysely";
import type { DB } from "./next-database.d.ts";
import { connect } from "./reader.ts";

const writerRole = sql`set local role engine`;
const writerPath = sql`set local search_path = next, pg_temp`;

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
		role: writerRole,
		path: writerPath,
	},
	job: {
		isolation: "repeatable read",
		access: "read only",
		role: writerRole,
		path: writerPath,
	},
} as const;

export async function nextTransaction<T>(
	connectionString: string,
	mode: keyof typeof modes,
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
				if (mode === "read") {
					const {
						rows: [schema],
					} = await sql<{ protected: boolean }>`
						select current_schema() = 'next_partner'
							and to_regclass('next_partner.activity') is not null as protected
					`.execute(tx);
					if (!schema?.protected)
						throw new Error("Protected reader schema is unavailable");
				}
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
