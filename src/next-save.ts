import { sql, type Transaction } from "kysely";
import { Refusal } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import { idempotencyKey, SaveRefusal, sortedHash } from "./save.ts";

// A partner by the name they sign in under, or a job and the partner it works for.
export type Stamp =
	| { user: string; job?: never }
	| { job: string; for_user?: string; user?: never };

export type NextSave = { stamp: Stamp; verb: string; args: JsonObject };

export type NextChange = (
	tx: Transaction<DB>,
	args: JsonObject,
) => Promise<JsonObject>;

// One new-section save: stamped with who made it, and landing once however often it is retried.
export function runNextSave(
	connectionString: string,
	save: NextSave,
	change: NextChange,
): Promise<JsonObject> {
	const key = idempotencyKey(save.args);
	const { idempotency_key: _key, ...args } = save.args;
	const request_hash = sortedHash({ verb: save.verb, stamp: save.stamp, args });
	return nextTransaction(connectionString, "save", async (tx) => {
		await sign(tx, save.stamp);
		await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(
			tx,
		);
		const prior = await tx
			.selectFrom("save_receipt")
			.select(["request_hash", "answer"])
			.where("idempotency_key", "=", key)
			.$narrowType<{ answer: JsonObject }>()
			.executeTakeFirst();
		if (prior) {
			if (prior.request_hash !== request_hash)
				throw new SaveRefusal(new Refusal(409, "key_reuse"));
			return { replayed: true, ...prior.answer };
		}
		const answer = await change(tx, save.args);
		await tx
			.insertInto("save_receipt")
			.values({ idempotency_key: key, verb: save.verb, request_hash, answer })
			.execute();
		return answer;
	});
}

async function sign(tx: Transaction<DB>, stamp: Stamp) {
	const slug = "user" in stamp ? stamp.user : stamp.for_user;
	if (slug !== undefined) {
		const user = await tx
			.selectFrom("app_user")
			.select("id")
			.where("slug", "=", slug)
			.executeTakeFirst();
		if (!user) throw new SaveRefusal(new Refusal(422, "actor_not_provisioned"));
		await sql`select set_config('engine.user_id', ${user.id}, true)`.execute(
			tx,
		);
	}
	if ("job" in stamp) {
		const job = await tx
			.selectFrom("job")
			.select("slug")
			.where("slug", "=", stamp.job)
			.executeTakeFirst();
		if (!job) throw new SaveRefusal(new Refusal(403, "unknown_job"));
		await sql`select set_config('engine.job', ${stamp.job}, true)`.execute(tx);
	}
}
