import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import { asText } from "./reader.ts";

function credentialHash(credential: string) {
	return createHash("sha256").update(credential).digest("hex");
}

function stampOwner(tx: Transaction<DB>, owner: string) {
	return sql`select set_config('engine.user_id', ${owner}, true)`.execute(tx);
}

export function docLinkOwnerTransaction<T>(
	connection: string,
	owner: string,
	run: (tx: Transaction<DB>) => Promise<T>,
) {
	return nextTransaction(connection, "save", async (tx) => {
		await stampOwner(tx, owner);
		return run(tx);
	});
}

export async function issueDocLink(tx: Transaction<DB>, owner: string) {
	const credential = randomBytes(32).toString("base64url");
	const hash = credentialHash(credential);
	await tx
		.insertInto("doc_link")
		.values({ owner_user_id: owner, credential_hash: hash })
		.onConflict((conflict) =>
			conflict.column("owner_user_id").doUpdateSet({
				credential_hash: hash,
				issued_at: sql`now()`,
				last_seen_at: null,
			}),
		)
		.execute();
	return { credential };
}

export async function docLinkPresence(tx: Transaction<DB>, owner: string) {
	const link = await tx
		.selectFrom("doc_link")
		.select([
			asText(sql.ref("issued_at")).as("issued_at"),
			sql<boolean>`coalesce(last_seen_at >= clock_timestamp() - interval '30 seconds', false)`.as(
				"connected",
			),
		])
		.where("owner_user_id", "=", owner)
		.executeTakeFirst();
	return link ?? { connected: false, issued_at: null };
}

export async function revokeDocLink(tx: Transaction<DB>, owner: string) {
	await tx.deleteFrom("doc_link").where("owner_user_id", "=", owner).execute();
}

export function withDocLink<T>(
	connection: string,
	credential: string,
	run: (tx: Transaction<DB>, owner: string) => Promise<T>,
) {
	const hash = credentialHash(credential);
	return nextTransaction(connection, "save", async (tx) => {
		await sql`select set_config('engine.doc_link_hash', ${hash}, true)`.execute(
			tx,
		);
		const link = await tx
			.selectFrom("doc_link")
			.select("owner_user_id")
			.where("credential_hash", "=", hash)
			.executeTakeFirst();
		if (!link) return null;

		const owner = link.owner_user_id;
		await stampOwner(tx, owner);
		// Re-read under the row lock in case the credential changed after lookup.
		const current = await tx
			.selectFrom("doc_link")
			.select("credential_hash")
			.where("owner_user_id", "=", owner)
			.forUpdate()
			.executeTakeFirst();
		if (
			!current ||
			!timingSafeEqual(
				Buffer.from(current.credential_hash, "hex"),
				Buffer.from(hash, "hex"),
			)
		)
			return null;

		return run(tx, owner);
	});
}

export async function recordDocLinkPoll(tx: Transaction<DB>, owner: string) {
	await tx
		.updateTable("doc_link")
		.set({ last_seen_at: sql`clock_timestamp()` })
		.where("owner_user_id", "=", owner)
		.where((eb) =>
			eb.or([
				eb("last_seen_at", "is", null),
				eb(
					"last_seen_at",
					"<=",
					sql<string>`clock_timestamp() - interval '15 seconds'`,
				),
			]),
		)
		.execute();
}
