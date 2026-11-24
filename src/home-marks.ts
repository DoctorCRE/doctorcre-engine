import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import pg from "pg";
import { Refusal } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import { lockHomeReview } from "./home-inbox-review.ts";
import type { DB } from "./next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { ACTING_USER } from "./next-save.ts";
import {
	fit,
	fitting,
	isInstant,
	isText,
	isUuid,
	optional,
} from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";

type ItemKind =
	| "next_step"
	| "call_follow_up"
	| "home_update"
	| "proposal"
	| "reply_draft";
const itemKinds = new Map<string, ItemKind>([
	["next_action", "next_step"],
	["capture_post_call_action", "call_follow_up"],
	["notification", "home_update"],
	["suggestion", "proposal"],
	["reply_draft", "reply_draft"],
]);

const isVersion = (value: unknown): value is string =>
	typeof value === "string" && /^\d+:\d+:(inbox|snoozed|done)$/.test(value);
const actions = [
	"snooze",
	"unsnooze",
	"drop",
	"done",
	"undo_done",
	"set-waiting",
	"clear-waiting",
] as const;
const isAction = (value: unknown): value is (typeof actions)[number] =>
	actions.some((action) => value === action);
const droppableKinds = new Set<ItemKind>([
	"call_follow_up",
	"home_update",
	"reply_draft",
]);
const isParty = (value: unknown): value is "party" => value === "party";
const shape = {
	idempotency_key: isUuid,
	item_id: isText,
	base_version: isVersion,
	action: isAction,
	until: optional(isInstant),
	target: optional(fitting({ kind: isParty, id: isUuid })),
	reason: optional(isText),
};

function parse(body: JsonObject) {
	const request = fit(body, shape, [
		"idempotency_key",
		"item_id",
		"base_version",
		"action",
	]);
	if (request instanceof Refusal) return request;
	const { item_id, action, until, target, reason, ...rest } = request;
	const [prefix, id, extra] = item_id.split(":");
	const item_kind = itemKinds.get(prefix ?? "");
	if (!item_kind || !isUuid(id) || extra !== undefined)
		return new Refusal(400, "invalid_field_value", { fields: ["item_id"] });

	const needsReason = action === "set-waiting" || action === "drop";
	const invalidAction =
		(action === "drop" && !droppableKinds.has(item_kind)) ||
		((action === "done" || action === "undo_done") &&
			item_kind !== "home_update");
	const fields = [
		...(invalidAction ? ["action"] : []),
		...((action === "snooze") === (until !== undefined) ? [] : ["until"]),
		...((action === "set-waiting") === (target !== undefined)
			? []
			: ["target"]),
		...(needsReason === (reason !== undefined) ? [] : ["reason"]),
	];
	if (fields.length) return new Refusal(400, "invalid_field_value", { fields });
	const item = { ...rest, item_id, id: id.toLowerCase(), item_kind };
	if (action === "drop" && reason !== undefined)
		return {
			...item,
			change: { kind: "drop", reason: reason.trim() } as const,
		};
	if (action === "done" || action === "undo_done")
		return {
			...item,
			change: { kind: "completion", done: action === "done" } as const,
		};
	const mark =
		until !== undefined
			? { disposition: "snoozed", snoozed_until: until }
			: target && reason
				? { waiting_on_party_id: target.id, waiting_reason: reason }
				: action === "clear-waiting"
					? { waiting_on_party_id: null, waiting_reason: null }
					: { disposition: null, snoozed_until: null };
	return { ...item, change: { kind: "mark", mark } as const };
}

type MarkRequest = Exclude<ReturnType<typeof parse>, Refusal>;
type Mark = Pick<
	DB["home_mark"],
	"disposition" | "snoozed_until" | "waiting_on_party_id" | "waiting_reason"
>;
type MarkState = Mark & {
	created_at: string | null;
	snoozed: boolean;
	valid_snooze: boolean;
	mark_version: string | null;
};

async function lockItem(tx: Transaction<DB>, id: string, kind: ItemKind) {
	type LockedItem = {
		user_id: string;
		done: boolean;
		update_kind: string | null;
	};
	if (kind === "proposal" || kind === "reply_draft") {
		const {
			rows: [actor],
		} = await sql<{ user_id: string | null }>`
			select ${ACTING_USER} as user_id
		`.execute(tx);
		if (!actor?.user_id) return;
		const review = await lockHomeReview(tx, kind, id, actor.user_id);
		return (
			review && {
				user_id: actor.user_id,
				done: false,
				update_kind: null,
				...review,
			}
		);
	}
	const update = kind === "home_update";
	const source = update
		? sql<LockedItem>`select user_id, read_at is not null as done, kind as update_kind
			from home_update where id = ${id} and user_id = ${ACTING_USER} for no key update`
		: sql<LockedItem>`select owner_party_id as user_id, status = 'done' as done, null::text as update_kind
			from next_step
			where ${sql.ref(kind === "next_step" ? "home_step_id" : "home_call_follow_up_id")} = ${id}
				and owner_party_id = ${ACTING_USER} for no key update`;
	const {
		rows: [item],
	} = await source.execute(tx);
	if (!item) return;
	const {
		rows: [version],
	} = await sql<{ source_version: string }>`
		select coalesce(max(id), 0) as source_version from change
		where table_name = ${update ? "home_update" : "next_step"} and record = ${{ id }}
	`.execute(tx);
	if (!version) throw new Error("Home source history was unavailable");
	return { ...item, ...version, mark_item_id: id };
}

async function readMarkState(
	tx: Transaction<DB>,
	record: { user_id: string; item_kind: ItemKind; item_id: string },
	snoozedUntil: string | null,
) {
	const { item_kind, item_id: id } = record;
	const {
		rows: [state],
	} = await sql<MarkState>`
		select m.created_at, m.disposition, m.waiting_on_party_id, m.waiting_reason,
			to_jsonb(m.snoozed_until)#>>'{}' as snoozed_until,
			coalesce(m.snoozed_until > now(), false) as snoozed,
			coalesce(${snoozedUntil}::timestamptz > now(), true) as valid_snooze,
			h.version as mark_version
		from (
			select max(id) as version
			from change where table_name = 'home_mark' and record = ${record}
		) h
		left join home_mark m on m.user_id = ${record.user_id}
			and m.item_kind = ${item_kind} and m.item_id = ${id}
	`.execute(tx);
	if (!state) throw new Error("Home mark state was unavailable");
	return state;
}

async function saveMark(tx: Transaction<DB>, request: MarkRequest) {
	const { item_kind, item_id, change } = request;
	const item = await lockItem(tx, request.id, item_kind);
	if (!item?.user_id)
		throw new SaveRefusal(new Refusal(404, "home_item_not_found"));
	if (change.kind === "completion" && item.update_kind !== "tour_feedback")
		throw new SaveRefusal(new Refusal(422, "invalid_field_value"));
	const { mark_item_id: id, source_version } = item;
	const record = { user_id: item.user_id, item_kind, item_id: id };
	const snoozedUntil =
		change.kind === "mark" ? (change.mark.snoozed_until ?? null) : null;
	const state = await readMarkState(tx, record, snoozedUntil);
	if (state.disposition === "dropped")
		throw new SaveRefusal(new Refusal(404, "home_item_not_found"));
	const history = tx
		.selectFrom("change")
		.where("table_name", "=", "home_mark")
		.where("record", "=", record);
	const { created_at, snoozed, valid_snooze, mark_version, ...before } = state;
	const visible = (activeSnooze: boolean, done = item.done) =>
		item_kind === "home_update" && done
			? "done"
			: !done && activeSnooze
				? "snoozed"
				: "inbox";
	const version = (
		srcVersion: string,
		markVersion: string | null,
		disposition: string,
	) => `${srcVersion}:${markVersion ?? 0}:${disposition}`;
	const currentVersion = version(
		source_version,
		mark_version,
		visible(snoozed),
	);
	if (request.base_version !== currentVersion)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { current_version: currentVersion }),
		);

	if (change.kind === "drop") {
		await sql`
			insert into home_mark as m
				(user_id, ${sql.ref(`${item_kind}_id`)}, created_at, disposition,
				 snoozed_until, drop_reason, waiting_on_party_id, waiting_reason)
			values (${record.user_id}, ${id}, coalesce(${created_at}::timestamptz, now()), 'dropped',
				null, ${change.reason}, null, null)
			on conflict (user_id, item_kind, item_id) do update set
				(disposition, snoozed_until, drop_reason, waiting_on_party_id, waiting_reason) =
				('dropped', null, excluded.drop_reason, null, null)
		`
			.execute(tx)
			.catch((error: unknown) => {
				if (
					error instanceof pg.DatabaseError &&
					error.constraint === "home_mark_drops_failed_reply"
				)
					throw new SaveRefusal(
						new Refusal(422, "invalid_field_value", { fields: ["action"] }),
					);
				throw error;
			});
		return { ok: true, item_id };
	}

	if (change.kind === "completion") {
		await (change.done
			? sql`update home_update set read_at = now()
				where id = ${id} and user_id = ${record.user_id} and read_at is null`
			: sql`update home_update set read_at = null
				where id = ${id} and user_id = ${record.user_id} and read_at is not null`
		).execute(tx);
		const {
			rows: [updated],
		} = await sql<{ source_version: string }>`
			select coalesce(max(id), 0) as source_version from change
			where table_name = 'home_update' and record = ${{ id }}
		`.execute(tx);
		if (!updated) throw new Error("Home source history was unavailable");
		return {
			ok: true,
			item_id,
			base_version: version(
				updated.source_version,
				mark_version,
				visible(snoozed, change.done),
			),
			previous: before,
		};
	}

	if (!valid_snooze)
		throw new SaveRefusal(new Refusal(422, "invalid_snooze_time"));
	const mark: Mark = { ...before, ...change.mark };
	const empty = mark.disposition === null && mark.waiting_on_party_id === null;
	if (created_at && empty)
		await tx
			.deleteFrom("home_mark")
			.where((eb) => eb.and(record))
			.execute();
	if (!empty)
		await sql`
			insert into home_mark as m
				(user_id, ${sql.ref(`${item_kind}_id`)}, created_at, disposition,
				 snoozed_until, waiting_on_party_id, waiting_reason)
			values (${record.user_id}, ${id}, coalesce(${created_at}::timestamptz, now()), ${mark.disposition},
				${mark.snoozed_until}, ${mark.waiting_on_party_id}, ${mark.waiting_reason})
			on conflict (user_id, item_kind, item_id) do update set
				(disposition, snoozed_until, waiting_on_party_id, waiting_reason) =
				(excluded.disposition, excluded.snoozed_until, excluded.waiting_on_party_id, excluded.waiting_reason)
			where (m.disposition, m.snoozed_until, m.waiting_on_party_id, m.waiting_reason)
				is distinct from (excluded.disposition, excluded.snoozed_until, excluded.waiting_on_party_id, excluded.waiting_reason)
		`.execute(tx);
	const saved = await history
		.select((eb) => eb.fn.max("id").as("id"))
		.executeTakeFirstOrThrow();
	return {
		ok: true,
		item_id,
		base_version: version(
			source_version,
			saved.id,
			visible(
				change.mark.snoozed_until != null ||
					(mark.disposition === "snoozed" && snoozed),
			),
		),
		previous: before,
	};
}

export const homeMarks = new Hono<NextSaveEnv>().post("/home/marks", (c) =>
	answerNextSave(c, "save-home-mark", parse, saveMark),
);
