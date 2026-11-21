import { Hono } from "hono";
import { type RawBuilder, sql, type Transaction } from "kysely";
import { answerNextRead, Refusal } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import {
	homeUpdateAvailable,
	readHomeUpdates,
} from "./home-inbox-reviews-updates.ts";
import type { DB } from "./next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { ACTING_USER } from "./next-save.ts";
import type { DatabaseEnv } from "./reader.ts";
import { fit, isUuid } from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";

const LIMIT = 100;

const unreadCount = async (db: Transaction<DB>, user: RawBuilder<string>) => {
	const {
		rows: [count],
	} = await sql<{ unread_count: number }>`
		select count(*)::int as unread_count from home_update u
		where u.user_id = ${user} and u.read_at is null
			and ${homeUpdateAvailable}
			and not exists (select from home_mark m
				where (m.user_id, m.item_kind, m.item_id) = (u.user_id, 'home_update', u.id)
					and m.disposition = 'dropped')
	`.execute(db);
	if (!count) throw new Error("Unread updates were uncounted");
	return count;
};

async function readUpdates(db: Transaction<DB>, userId: string) {
	const updates = await readHomeUpdates(db, userId, LIMIT, "updates");
	return { ...(await unreadCount(db, sql`${userId}::uuid`)), updates };
}

const isUpdateIds = (value: unknown): value is string[] =>
	Array.isArray(value) &&
	value.length > 0 &&
	value.length <= LIMIT &&
	value.every(isUuid);

function parseRead(body: JsonObject) {
	const request = fit(
		body,
		{ idempotency_key: isUuid, update_ids: isUpdateIds },
		["idempotency_key", "update_ids"],
	);
	if (request instanceof Refusal) return request;
	const ids = [...new Set(request.update_ids.map((id) => id.toLowerCase()))];
	return { ...request, update_ids: ids.sort() };
}

// Reading is one-way: an update already read keeps its first read time.
async function markRead(
	tx: Transaction<DB>,
	{ update_ids }: { update_ids: string[] },
) {
	const { rows } = await sql<{ id: string; read_at: string }>`
		with mine as (
			select id from home_update u
			where id = any(${update_ids}::uuid[]) and user_id = ${ACTING_USER}
				and ${homeUpdateAvailable}
			for no key update
		), marked as (
			update home_update u set read_at = now()
			from mine where u.id = mine.id and u.read_at is null
			returning u.id, u.read_at
		)
		select u.id, coalesce(marked.read_at, u.read_at) as read_at
		from home_update u join mine on mine.id = u.id
		left join marked on marked.id = u.id
		order by u.id
	`.execute(tx);
	if (rows.length !== update_ids.length)
		throw new SaveRefusal(new Refusal(404, "not_found"));
	return {
		ok: true,
		updates: rows.map(({ id, read_at }) => ({
			id,
			read_at: new Date(read_at).toISOString(),
		})),
		...(await unreadCount(tx, ACTING_USER)),
	};
}

export const updates = new Hono<DatabaseEnv>().get("/updates", (c) =>
	answerNextRead(c, "read-updates", readUpdates),
);

export const updateReads = new Hono<NextSaveEnv>().post("/updates/read", (c) =>
	answerNextSave(c, "mark-updates-read", parseRead, markRead),
);
