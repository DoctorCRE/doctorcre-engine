import { sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";
import type { Reader } from "../reader.ts";

// A failed query, such as one the login has no grant for, answers null. Its
// savepoint keeps the answer's transaction able to commit.
export async function attempt<T>(
	db: Reader | Transaction<DB>,
	read: () => Promise<T>,
) {
	await sql`savepoint attempt`.execute(db);
	try {
		const value = await read();
		await sql`release savepoint attempt`.execute(db);
		return value;
	} catch {
		await sql`rollback to savepoint attempt`.execute(db);
		return null;
	}
}

// The partner's published Outlook snapshot, or undefined when there is none
// or it could not be read, which every caller answers alike.
export async function storedSnapshot(
	db: Reader | Transaction<DB>,
	partner: string,
) {
	const rows = await attempt(db, () =>
		sql<{ snapshot: unknown }>`
		select a.snapshot::jsonb || jsonb_build_object(
			'dismissed', (select coalesce(jsonb_agg(d.key order by d.key), '[]')
				from next.calendar_review_dismissal d where d.user_id = u.id),
			'confirmed', (select coalesce(jsonb_agg(m.calendar_review_key order by m.calendar_review_key), '[]')
				from next.activity m where m.calendar_review_user_id = u.id)) as snapshot
		from next.calendar_agenda a join next.app_user u on u.id = a.user_id
		where u.slug = ${partner}`.execute(db),
	);
	return rows?.rows[0]?.snapshot;
}
