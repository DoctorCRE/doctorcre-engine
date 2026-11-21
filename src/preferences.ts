import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, Refusal } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import type { DB } from "./next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { ACTING_USER } from "./next-save.ts";
import type { DatabaseEnv } from "./reader.ts";
import {
	fit,
	isBoolean,
	isChangeId,
	isText,
	isUuid,
	orNull,
} from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";
import { latestChange } from "./seen-change.ts";

// A user with no row has chosen nothing and gets the engine's Central day.
const DEFAULTS = {
	time_zone: "America/Chicago",
	quiet_from: null,
	quiet_until: null,
	push_to_device: false,
};

const isClock = (value: unknown): value is string =>
	typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

async function readPreferences(db: Transaction<DB>, userId: string) {
	const { rows } = await sql<typeof DEFAULTS>`
		select time_zone, to_char(quiet_from, 'HH24:MI') as quiet_from,
			to_char(quiet_until, 'HH24:MI') as quiet_until, push_to_device
		from user_preference where user_id = ${userId}::uuid
	`.execute(db);
	const version = await latestChange(db, "user_preference", {
		user_id: userId,
	});
	return { ...(rows[0] ?? DEFAULTS), base_version: version ?? 0 };
}

const shape = {
	idempotency_key: isUuid,
	base_version: isChangeId,
	time_zone: isText,
	quiet_from: orNull(isClock),
	quiet_until: orNull(isClock),
	push_to_device: isBoolean,
};
function parse(body: JsonObject) {
	const request = fit(body, shape, [
		"idempotency_key",
		"base_version",
		"time_zone",
		"quiet_from",
		"quiet_until",
		"push_to_device",
	]);
	if (request instanceof Refusal) return request;
	const { quiet_from, quiet_until } = request;
	// Quiet hours may run past midnight, but they cannot start and end together.
	if (
		(quiet_from === null) !== (quiet_until === null) ||
		(quiet_from !== null && quiet_from === quiet_until)
	)
		return new Refusal(400, "invalid_field_value", {
			fields: ["quiet_from", "quiet_until"],
		});
	return request;
}

type PreferenceSave = Exclude<ReturnType<typeof parse>, Refusal>;

async function savePreferences(tx: Transaction<DB>, request: PreferenceSave) {
	const { idempotency_key: _key, base_version, ...preference } = request;
	const {
		rows: [user],
	} = await sql<{ id: string; known_zone: boolean }>`
		select ${ACTING_USER} as id, is_time_zone(${preference.time_zone}) as known_zone
	`.execute(tx);
	if (!user) throw new Error("The acting user was unavailable");
	if (!user.known_zone)
		throw new SaveRefusal(
			new Refusal(400, "invalid_field_value", { fields: ["time_zone"] }),
		);
	// A user's first save has no row to lock.
	await sql`select pg_advisory_xact_lock(hashtextextended(${`user_preference:${user.id}`}, 0))`.execute(
		tx,
	);
	const current_version =
		(await latestChange(tx, "user_preference", { user_id: user.id })) ?? 0;
	if (base_version !== current_version)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { current_version }),
		);
	const { time_zone, quiet_from, quiet_until, push_to_device } = preference;
	await sql`
		insert into user_preference (user_id, time_zone, quiet_from, quiet_until, push_to_device)
		values (${user.id}, ${time_zone}, ${quiet_from}, ${quiet_until}, ${push_to_device})
		on conflict (user_id) do update set (time_zone, quiet_from, quiet_until, push_to_device) =
			(excluded.time_zone, excluded.quiet_from, excluded.quiet_until, excluded.push_to_device)
	`.execute(tx);
	return {
		ok: true,
		...preference,
		base_version:
			(await latestChange(tx, "user_preference", { user_id: user.id })) ?? 0,
	};
}

export const preferences = new Hono<DatabaseEnv>().get("/preferences", (c) =>
	answerNextRead(c, "read-preferences", readPreferences),
);

export const preferenceSaves = new Hono<NextSaveEnv>().post(
	"/preferences",
	(c) => answerNextSave(c, "save-preferences", parse, savePreferences),
);
