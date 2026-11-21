import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import pg from "pg";
import { Refusal, refuse } from "../answer.ts";
import type { JsonObject } from "../database.d.ts";
import { nextTransaction } from "../next-connection.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { stampNextSave } from "../next-save.ts";
import { fit, isInstant, isText, isUuid, optional } from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { isArguments } from "../save-door.ts";

export const nextAgenda = new Hono<NextSaveEnv>();
const isKey = (key: unknown): key is string =>
	typeof key === "string" && /^[a-f0-9]{16}$/.test(key);
const list = (value: unknown): value is JsonObject[] =>
	Array.isArray(value) && value.every(isArguments);

nextAgenda.onError((error, c) => {
	if (error instanceof SaveRefusal) return refuse(c, error.refusal);
	if (error instanceof pg.DatabaseError && error.code?.startsWith("23"))
		return refuse(
			c,
			new Refusal(422, "database_refused_the_statement", {
				rule: error.constraint ?? null,
			}),
		);
	return refuse(c, new Refusal(503, "database_unavailable"));
});

nextAgenda.use("/calendar/agenda", async (c, next) => {
	const stamp = c.get("stamp");
	if (
		!("user" in stamp) &&
		(!stamp.for_user ||
			(c.req.method === "PUT" && stamp.job !== "mail_capture"))
	)
		return refuse(c, new Refusal(403, "unknown_job"));
	await next();
});

nextAgenda.put("/calendar/agenda", async (c) => {
	if (!("job" in c.get("stamp"))) return c.notFound();
	const body: unknown = await c.req.json().catch(() => undefined);
	if (!isArguments(body)) return refuse(c, new Refusal(400, "invalid_json"));
	const request = fit(
		body,
		{
			schema: isText,
			source: optional(isText),
			lifecycle: optional(isText),
			window_start: optional(isInstant),
			window_end: optional(isInstant),
			time_zone: optional(isText),
			observed_at: isInstant,
			items: list,
			follow_up_reviews: (v): v is JsonObject[] =>
				list(v) && v.every((r) => isKey(r.key)),
			warnings: list,
		},
		["schema", "observed_at", "items", "follow_up_reviews", "warnings"],
	);
	if (request instanceof Refusal) return refuse(c, request);
	const snapshot = JSON.stringify(request);
	if (snapshot.length > 262144)
		return refuse(c, new Refusal(422, "agenda_too_large"));
	const writer = c.env.DATABASE_WRITER;
	if (!writer) return refuse(c, new Refusal(503, "database_unavailable"));
	return nextTransaction(writer.connectionString, "save", async (tx) => {
		await stampNextSave(tx, c.get("stamp"));
		const user = sql<string>`current_setting('engine.user_id')::uuid`;
		const saved = await sql<{
			observed_at: string;
		}>`insert into calendar_agenda (user_id, observed_at, snapshot)
			values (${user}, ${request.observed_at}::timestamptz, ${snapshot}::json)
			on conflict (user_id) do update set observed_at = excluded.observed_at, snapshot = excluded.snapshot
			where calendar_agenda.observed_at <= excluded.observed_at
			returning observed_at`.execute(tx);
		if (saved.rows[0]) return c.json(saved.rows[0]);
		const current = await tx
			.selectFrom("calendar_agenda")
			.select("observed_at")
			.where("user_id", "=", user)
			.executeTakeFirstOrThrow();
		return refuse(c, new Refusal(409, "agenda_superseded", current));
	});
});

export async function readStoredAgenda(
	db: Pick<Transaction<DB>, "getExecutor">,
	userId?: string,
) {
	const user = userId
		? sql`${userId}::uuid`
		: sql`current_setting('engine.user_id')::uuid`;
	const result = await sql<{ snapshot: unknown }>`
		select a.snapshot::jsonb || jsonb_build_object(
			'dismissed', (select coalesce(jsonb_agg(d.key order by d.key), '[]')
				from calendar_review_dismissal d where d.user_id = a.user_id
				and a.snapshot::jsonb -> 'follow_up_reviews' @> jsonb_build_array(jsonb_build_object('key', d.key))),
			'confirmed', (select coalesce(jsonb_agg(m.calendar_review_key order by m.calendar_review_key), '[]')
				from activity m where m.calendar_review_user_id = a.user_id
				and a.snapshot::jsonb -> 'follow_up_reviews' @> jsonb_build_array(jsonb_build_object('key', m.calendar_review_key)))) as snapshot
		from calendar_agenda a
		where a.user_id = ${user}`.execute(db);
	return result.rows[0]?.snapshot ?? null;
}

nextAgenda.get("/calendar/agenda", async (c) => {
	const reader = c.env.DATABASE;
	if (!reader) return refuse(c, new Refusal(503, "database_unavailable"));
	return nextTransaction(reader.connectionString, "read", async (tx) => {
		await stampNextSave(tx, c.get("stamp"));
		return c.json(await readStoredAgenda(tx));
	});
});

export const calendarDismissal = new Hono<NextSaveEnv>();
calendarDismissal.post("/calendar/reviews/:key/dismissal", (c) =>
	answerNextSave(
		c,
		"dismiss-calendar-review",
		(body) =>
			fit(
				{ ...body, key: c.req.param("key") },
				{ idempotency_key: isUuid, key: isKey },
				["idempotency_key", "key"],
			),
		async (tx, request) => {
			const user = sql<string>`current_setting('engine.user_id')::uuid`;
			const prior = await tx
				.selectFrom("calendar_review_dismissal")
				.select(["key", "dismissed_at"])
				.where("user_id", "=", user)
				.where("key", "=", request.key)
				.executeTakeFirst();
			if (prior) return prior;
			const agenda = await tx
				.selectFrom("calendar_agenda")
				.select("user_id")
				.where("user_id", "=", user)
				.where(
					sql<boolean>`snapshot::jsonb -> 'follow_up_reviews' @> ${JSON.stringify([{ key: request.key }])}::jsonb`,
				)
				.forShare()
				.executeTakeFirst();
			if (!agenda) throw new SaveRefusal(new Refusal(404, "review_not_found"));
			await sql`insert into calendar_review_dismissal (user_id, key)
				values (${user}, ${request.key}) on conflict (user_id, key) do nothing`.execute(
				tx,
			);
			return tx
				.selectFrom("calendar_review_dismissal")
				.select(["key", "dismissed_at"])
				.where("user_id", "=", user)
				.where("key", "=", request.key)
				.executeTakeFirstOrThrow();
		},
	),
);
