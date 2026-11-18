import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
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
	typeof value === "string" && /^\d+:\d+:(inbox|snoozed|settled)$/.test(value);
const actions = [
	"snooze",
	"settle",
	"unsettle",
	"set-waiting",
	"clear-waiting",
] as const;
const isAction = (value: unknown): value is (typeof actions)[number] =>
	actions.some((action) => value === action);
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

	const fields = [
		...((action === "snooze") === (until !== undefined) ? [] : ["until"]),
		...((action === "set-waiting") === (target !== undefined)
			? []
			: ["target"]),
		...((action === "set-waiting") === (reason !== undefined)
			? []
			: ["reason"]),
	];
	if (fields.length) return new Refusal(400, "invalid_field_value", { fields });
	const item = { ...rest, item_id, id: id.toLowerCase(), item_kind };
	if (until !== undefined)
		return { ...item, mark: { disposition: "snoozed", snoozed_until: until } };
	if (target && reason)
		return {
			...item,
			mark: { waiting_on_party_id: target.id, waiting_reason: reason },
		};
	if (action === "clear-waiting")
		return {
			...item,
			mark: { waiting_on_party_id: null, waiting_reason: null },
		};
	return {
		...item,
		mark: {
			disposition: action === "settle" ? "settled" : null,
			snoozed_until: null,
		},
	};
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
	source_version: string;
	mark_version: string | null;
	settled_version: string;
};

async function lockItem(tx: Transaction<DB>, id: string, kind: ItemKind) {
	type LockedItem = { user_id: string; done: boolean; sourceVersion?: string };
	if (kind === "proposal" || kind === "reply_draft") {
		const {
			rows: [actor],
		} = await sql<{ user_id: string | null }>`
			select ${ACTING_USER} as user_id
		`.execute(tx);
		if (!actor?.user_id) return;
		const sourceVersion = await lockHomeReview(tx, kind, id, actor.user_id);
		if (sourceVersion !== undefined)
			return { user_id: actor.user_id, done: false, sourceVersion };
		return;
	}
	const update = kind === "home_update";
	if (update) {
		// Updates have a fixed recipient and no row lock privilege for engine saves.
		await sql`select pg_advisory_xact_lock(hashtextextended(${`home-update:${id}`}, 0))`.execute(
			tx,
		);
	}
	const source = update
		? sql<LockedItem>`select user_id, false as done from home_update where id = ${id} and user_id = ${ACTING_USER}`
		: sql<LockedItem>`select owner_party_id as user_id, status = 'done' as done from next_step
			where ${sql.ref(kind === "next_step" ? "home_step_id" : "home_call_follow_up_id")} = ${id}
				and owner_party_id = ${ACTING_USER} for no key update`;
	const { rows } = await source.execute(tx);
	return rows[0];
}

async function readMarkState(
	tx: Transaction<DB>,
	record: { user_id: string; item_kind: ItemKind; item_id: string },
	snoozedUntil: string | null,
	sourceVersion: string | undefined,
) {
	const { item_kind, item_id: id } = record;
	const sourceTable = item_kind === "home_update" ? "home_update" : "next_step";
	const {
		rows: [state],
	} = await sql<MarkState>`
		select m.created_at, m.disposition, m.waiting_on_party_id, m.waiting_reason,
			to_jsonb(m.snoozed_until)#>>'{}' as snoozed_until,
			coalesce(m.snoozed_until > now(), false) as snoozed,
			coalesce(${snoozedUntil}::timestamptz > now(), true) as valid_snooze,
			coalesce(${sourceVersion ?? null}::bigint, (select coalesce(max(id), 0) from change
				where table_name = ${sourceTable} and record = ${{ id }})) as source_version,
			h.version as mark_version, h.settled_version
		from (
			select max(id) as version,
				coalesce(max(id) filter (where new_value ->> 'disposition' = 'settled'), 0) as settled_version
			from change where table_name = 'home_mark' and record = ${record}
		) h
		left join home_mark m on m.user_id = ${record.user_id}
			and m.item_kind = ${item_kind} and m.item_id = ${id}
	`.execute(tx);
	if (!state) throw new Error("Home mark state was unavailable");
	return state;
}

async function saveMark(tx: Transaction<DB>, request: MarkRequest) {
	const { id, item_kind, item_id } = request;
	const item = await lockItem(tx, id, item_kind);
	if (!item?.user_id)
		throw new SaveRefusal(new Refusal(404, "home_item_not_found"));
	const record = { user_id: item.user_id, item_kind, item_id: id };
	const state = await readMarkState(
		tx,
		record,
		request.mark.snoozed_until ?? null,
		item.sourceVersion,
	);
	const history = tx
		.selectFrom("change")
		.where("table_name", "=", "home_mark")
		.where("record", "=", record);
	const {
		created_at,
		snoozed,
		valid_snooze,
		source_version,
		mark_version,
		settled_version,
		...before
	} = state;
	const staleSettlement =
		before.disposition === "settled" &&
		BigInt(settled_version) < BigInt(source_version);
	const visible = (mark: string | null | undefined, activeSnooze: boolean) =>
		item.done || mark === "settled"
			? "settled"
			: activeSnooze
				? "snoozed"
				: "inbox";
	const version = (markVersion: string | null, disposition: string) =>
		`${source_version}:${markVersion ?? 0}:${disposition}`;
	const currentVersion = version(
		mark_version,
		visible(staleSettlement ? null : before.disposition, snoozed),
	);
	if (request.base_version !== currentVersion)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { current_version: currentVersion }),
		);

	if (!valid_snooze)
		throw new SaveRefusal(new Refusal(422, "invalid_snooze_time"));
	const mark: Mark = { ...before, ...request.mark };
	// An unchanged disposition would leave no new settlement in history.
	const renewSettlement =
		staleSettlement && request.mark.disposition === "settled";
	const empty = mark.disposition === null && mark.waiting_on_party_id === null;
	if (created_at && (empty || renewSettlement))
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
			saved.id,
			visible(
				staleSettlement && !renewSettlement ? null : mark.disposition,
				request.mark.snoozed_until != null ||
					(mark.disposition === "snoozed" && snoozed),
			),
		),
		previous: {
			...before,
			disposition: staleSettlement ? null : before.disposition,
		},
	};
}

export const homeMarks = new Hono<NextSaveEnv>().post("/home/marks", (c) =>
	answerNextSave(c, "save-home-mark", parse, saveMark),
);
