import { Hono } from "hono";
import { sql, type Transaction, type Updateable } from "kysely";
import { Refusal } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import {
	clearable,
	type Fitted,
	fit,
	fitting,
	isAmount,
	isBoolean,
	isChangeId,
	isText,
	isUuid,
	optional,
	orNull,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { seenAnswer, unseenChanges } from "../seen-change.ts";
import { UUID } from "../uuid.ts";

// The database checks each value against its own rules, such as a known kind.
const DEAL_FIELDS = {
	name: optional(isText),
	kind: clearable(isText),
	reason: clearable(isText),
	owner: optional(isText),
	market_id: clearable(isUuid),
	closed_value: clearable(isAmount),
	parking_reason: clearable(isText),
	parking_note: clearable(isText),
	needs_attention: optional(isBoolean),
};

// `from` is the phase the caller saw, none for a deal with no phase yet.
const PHASE_MOVE = {
	from: orNull(isText),
	to: isText,
	on: clearable(isCalendarDate),
	reason: clearable(isText),
};

const DEAL_CHANGES = {
	idempotency_key: isUuid,
	seen_change_id: isChangeId,
	fields: optional(fitting(DEAL_FIELDS)),
	phase: optional(fitting(PHASE_MOVE)),
};

type DealFields = Partial<Fitted<typeof DEAL_FIELDS>>;
type PhaseMove = NonNullable<DealChanges["phase"]>;
type DealChanges = Exclude<ReturnType<typeof parseDealChanges>, Refusal>;

function parseDealChanges(deal_id: string, body: JsonObject) {
	if (!UUID.test(deal_id)) return new Refusal(404, "not_found");
	const request = fit(
		body,
		DEAL_CHANGES,
		["idempotency_key", "seen_change_id"],
		["fields", "phase"],
	);
	if (request instanceof Refusal) return request;
	const { idempotency_key, seen_change_id, phase } = request;
	const fields: DealFields = request.fields ?? {};
	return {
		idempotency_key,
		deal_id,
		seen_change_id,
		fields,
		phase: phase
			? {
					from: phase.from,
					to: phase.to,
					on: phase.on ?? null,
					reason: phase.reason ?? null,
				}
			: null,
	};
}

async function saveDealChanges(
	tx: Transaction<DB>,
	{ deal_id, seen_change_id, fields, phase }: DealChanges,
): Promise<JsonObject> {
	const { owner, ...rest } = fields;
	const changes = owner
		? { ...rest, owner_user_id: await userId(tx, owner) }
		: rest;
	const answer = await changeDeal(tx, deal_id, seen_change_id, changes);
	return phase
		? { ...answer, phase_changed_at: await movePhase(tx, deal_id, phase) }
		: answer;
}

async function userId(tx: Transaction<DB>, slug: string) {
	const user = await tx
		.selectFrom("app_user")
		.select("id")
		.where("slug", "=", slug)
		.executeTakeFirst();
	if (!user) throw new SaveRefusal(new Refusal(400, "unknown_owner"));
	return user.id;
}

// Changes a deal's fields unless another save changed one of them after `seen`, the
// deal's latest change the partner's answer showed (0 for none). Other fields' changes
// stand, so two partners editing different fields both keep theirs.
export async function changeDeal(
	tx: Transaction<DB>,
	deal_id: string,
	seen: number,
	fields: Updateable<DB["deal"]>,
) {
	const keys = Object.keys(fields);
	// The row lock queues crossed saves, so the later one sees the earlier one's change.
	const deal = await tx
		.selectFrom("deal")
		.select("id")
		.where("id", "=", deal_id)
		.forUpdate()
		.executeTakeFirst();
	if (!deal) throw new SaveRefusal(new Refusal(404, "not_found"));
	const unseen = await unseenChanges(tx, "deal", deal_id, seen, keys);
	if (keys.length)
		await tx
			.updateTable("deal")
			.set(fields)
			.where("id", "=", deal_id)
			.execute();
	return { deal_id, ...(await seenAnswer(tx, "deal", deal_id, seen, unseen)) };
}

// Called under changeDeal's row lock, so two moves from one phase cannot both pass.
// A move lands after the deal's latest, on its day in Central time, never before that day or after today.
async function movePhase(
	tx: Transaction<DB>,
	deal_id: string,
	{ from, to, on, reason }: PhaseMove,
): Promise<string> {
	const latest = await tx
		.selectFrom("deal_phase_change")
		.select(["phase", "happened_at"])
		.where("deal_id", "=", deal_id)
		.orderBy("happened_at", "desc")
		.limit(1)
		.executeTakeFirst();
	const current = latest?.phase ?? null;
	if (current !== from)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { current_phase: current }),
		);
	const after = latest?.happened_at ?? null;
	const { rows } = await sql<{ happened_at: string }>`
		insert into deal_phase_change (deal_id, happened_at, phase, reason)
		select ${deal_id}::uuid, greatest(${after}::timestamptz + interval '1 microsecond',
			case when day is null or day = today then clock_timestamp() else day::timestamp at time zone 'America/Chicago' end),
			${to}::text, ${reason}::text
		from (select ${on}::date as day, (now() at time zone 'America/Chicago')::date as today) days
		where day is null or day between coalesce((${after}::timestamptz at time zone 'America/Chicago')::date, day) and today
		returning to_jsonb(happened_at) #>> '{}' as happened_at`.execute(tx);
	const moved = rows[0];
	if (!moved)
		throw new SaveRefusal(
			new Refusal(400, "invalid_field_value", { fields: ["phase"] }),
		);
	return moved.happened_at;
}

export const nextDeals = new Hono<NextSaveEnv>().post(
	"/deals/:deal/changes",
	(c) =>
		answerNextSave(
			c,
			"deal-changes",
			(body) => parseDealChanges(c.req.param("deal"), body),
			saveDealChanges,
		),
);
