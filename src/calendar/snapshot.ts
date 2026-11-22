import { sql } from "kysely";
import type { Reader } from "../reader.ts";

// A failed query, such as one the login has no grant for, answers null. Its
// savepoint keeps the answer's transaction able to commit.
export async function attempt<T>(
	db: Pick<Reader, "getExecutor">,
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
