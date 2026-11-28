import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { type RawBuilder, sql, type Transaction } from "kysely";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import { asText } from "./reader.ts";

export const docLinkReadiness = [
	"ready",
	"signed_out",
	"plan_limited",
] as const;
export type DocLinkReadiness = (typeof docLinkReadiness)[number];

type DocLinkStatus = DocLinkReadiness | "not_set_up" | "mac_off";

export const docLinkBackends = ["claude", "codex"] as const;
export type DocLinkBackend = (typeof docLinkBackends)[number];
export type DocReadinessCode =
	| "doc_not_set_up"
	| "doc_mac_off"
	| "doc_signed_out"
	| "doc_plan_limit"
	| "doc_ready";
type DocLinkState = {
	issued_at: string | null;
	status: DocLinkStatus;
	backend: DocLinkBackend | null;
	readiness_code: DocReadinessCode;
};

export function docLinkState(owner: string | RawBuilder<string>) {
	return sql<DocLinkState>`(select link.*, case status
		when 'not_set_up' then 'doc_not_set_up'
		when 'mac_off' then 'doc_mac_off'
		when 'signed_out' then 'doc_signed_out'
		when 'plan_limited' then 'doc_plan_limit'
		when 'ready' then 'doc_ready'
	end as readiness_code from (
	select ${asText(sql.ref("issued_at"))} as issued_at, backend,
		case
			when owner_user_id is null then 'not_set_up'
			when last_seen_at is null or last_seen_at < statement_timestamp() - interval '30 seconds' then 'mac_off'
			else coalesce(readiness, 'ready')
		end as status
		from (select ${owner}::uuid as id) partner
		left join doc_link on owner_user_id = partner.id) link)`;
}

const presenceDue = sql<boolean>`last_seen_at is null or last_seen_at <= clock_timestamp() - interval '15 seconds'`;

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
				readiness: null,
				backend: null,
			}),
		)
		.execute();
	return { credential };
}

export async function docLinkPresence(tx: Transaction<DB>, owner: string) {
	const link = await tx
		.selectFrom(docLinkState(owner).as("link"))
		.selectAll()
		.executeTakeFirstOrThrow();
	return {
		...link,
		connected: link.status !== "not_set_up" && link.status !== "mac_off",
	};
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

export async function recordDocPoll(
	tx: Transaction<DB>,
	owner: string,
	readiness?: DocLinkReadiness,
	backend?: DocLinkBackend,
) {
	const nextReadiness = sql<DocLinkReadiness | null>`coalesce(${readiness ?? null}, readiness)`;
	const nextBackend = sql<DocLinkBackend | null>`coalesce(${backend ?? null}, backend)`;
	await tx
		.updateTable("doc_link")
		.set({
			last_seen_at: sql`case when ${presenceDue} then clock_timestamp() else last_seen_at end`,
			readiness: nextReadiness,
			backend: nextBackend,
		})
		.where("owner_user_id", "=", owner)
		.where(
			sql<boolean>`(${presenceDue} or readiness is distinct from ${nextReadiness}
				or backend is distinct from ${nextBackend})`,
		)
		.execute();
}
