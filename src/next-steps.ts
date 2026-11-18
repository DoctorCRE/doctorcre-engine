import { type Context, Hono } from "hono";
import { sql, type Transaction } from "kysely";
import pg from "pg";
import { Refusal } from "./answer.ts";
import { isCalendarDate } from "./calendar-date.ts";
import type { JsonObject } from "./database.d.ts";
import type { DB } from "./next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { saveOpenStep } from "./open-step.ts";
import {
	type Check,
	clearable,
	type Fitted,
	fit,
	fitting,
	isChangeId,
	isInstant,
	isText,
	isUuid,
	optional,
	orNull,
	type Shape,
} from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";
import { latestChange, seenAnswer, unseenChanges } from "./seen-change.ts";

const RECORDS = ["deal_id", "party_id", "property_id"] as const;

const BULLET_KINDS = ["promised", "call", "suggestion", "status"] as const;
// A bullet is text, or the dated fact the old system writes and the copy keeps.
const FACT = {
	date: orNull(isCalendarDate),
	kind: (value: unknown): value is (typeof BULLET_KINDS)[number] =>
		BULLET_KINDS.some((kind) => kind === value),
	text: isText,
};
type Bullet = string | Fitted<typeof FACT>;
const isBullets: Check<Bullet[]> = (value): value is Bullet[] =>
	Array.isArray(value) &&
	value.every((bullet) => isText(bullet) || fitting(FACT)(bullet));

// The database checks the rest: an item only on a deal, a reason only for a cancel.
const STEP_FIELDS = {
	what: optional(isText),
	owner_party_id: clearable(isUuid),
	due_on: clearable(isCalendarDate),
	hold_until: clearable(isCalendarDate),
};

const NEW_STEP = {
	idempotency_key: isUuid,
	deal_id: optional(isUuid),
	party_id: optional(isUuid),
	property_id: optional(isUuid),
	...STEP_FIELDS,
	what: isText,
	item: optional(
		fitting({ title: isText, bullets: isBullets, source_ref: isText }),
	),
};

const STEP_CHANGES = {
	idempotency_key: isUuid,
	seen_change_id: isChangeId,
	...STEP_FIELDS,
	item_bullets: optional(isBullets),
};
const STEP_CHANGED = [
	"what",
	"owner_party_id",
	"due_on",
	"hold_until",
	"item_bullets",
] as const;

const isResolution: Check<"done" | "cancelled"> = (
	value,
): value is "done" | "cancelled" => value === "done" || value === "cancelled";

const STEP_END = {
	idempotency_key: isUuid,
	resolution: isResolution,
	done_at: optional(isInstant),
	reason: optional(isText),
};

const STEP_REOPEN = { idempotency_key: isUuid };

type StepRequest<S extends Shape> = Fitted<S> & { next_step_id: string };

// Written out, because the generated row type asks for the stamp the database sets.
async function createStep(
	tx: Transaction<DB>,
	request: Fitted<typeof NEW_STEP>,
): Promise<JsonObject> {
	const { deal_id, party_id, property_id, what, item } = request;
	const { owner_party_id = null, due_on, hold_until } = request;
	const insert = sql<{ id: string }>`
		insert into next_step (deal_id, party_id, property_id, what, owner_party_id, due_on, hold_until,
			item_title, item_bullets, source_ref)
		values (${deal_id ?? null}::uuid, ${party_id ?? null}::uuid, ${property_id ?? null}::uuid, ${what},
			${owner_party_id}::uuid, ${due_on ?? null}::date, ${hold_until ?? null}::date,
			${item?.title ?? null}, ${JSON.stringify(item?.bullets ?? [])}::jsonb, ${item?.source_ref ?? null})
		returning id`;
	const { rows } = await saveOpenStep(
		tx,
		{ deal_id, party_id, owner_party_id },
		() => insert.execute(tx),
	).catch((error: unknown) => {
		const named = RECORDS.map((name) => `next_step_${name}_fkey`);
		if (
			error instanceof pg.DatabaseError &&
			named.includes(error.constraint ?? "")
		)
			throw new SaveRefusal(new Refusal(404, "not_found"));
		throw error;
	});
	const { id } = rows[0] ?? {};
	if (!id) throw new Error("next step insert returned no row");
	return {
		next_step_id: id,
		change_id: await latestChange(tx, "next_step", id),
	};
}

// The row lock queues crossed saves, so the later one sees the earlier one's change or end.
async function lockStep(tx: Transaction<DB>, id: string) {
	const step = await tx
		.selectFrom("next_step")
		.select(["status", "deal_id", "party_id", "owner_party_id"])
		.where("id", "=", id)
		.forUpdate()
		.executeTakeFirst();
	if (!step) throw new SaveRefusal(new Refusal(404, "not_found"));
	return step;
}

async function changeStep(
	tx: Transaction<DB>,
	request: StepRequest<typeof STEP_CHANGES>,
): Promise<JsonObject> {
	const {
		idempotency_key: _,
		next_step_id,
		seen_change_id,
		item_bullets,
		...fields
	} = request;
	const changes =
		item_bullets === undefined
			? fields
			: { ...fields, item_bullets: JSON.stringify(item_bullets) };
	const step = await lockStep(tx, next_step_id);
	const keys = Object.keys(changes);
	const unseen = await unseenChanges(
		tx,
		"next_step",
		next_step_id,
		seen_change_id,
		keys,
	);
	await saveOpenStep(
		tx,
		{
			...step,
			owner_party_id:
				fields.owner_party_id === undefined
					? step.owner_party_id
					: fields.owner_party_id,
		},
		() =>
			tx
				.updateTable("next_step")
				.set(changes)
				.where("id", "=", next_step_id)
				.execute(),
	);
	return {
		next_step_id,
		...(await seenAnswer(
			tx,
			"next_step",
			next_step_id,
			seen_change_id,
			unseen,
		)),
	};
}

async function endStep(
	tx: Transaction<DB>,
	{ next_step_id, resolution, done_at, reason }: StepRequest<typeof STEP_END>,
): Promise<JsonObject> {
	const { status } = await lockStep(tx, next_step_id);
	if (status !== "open")
		throw new SaveRefusal(new Refusal(409, "step_ended", { status }));
	const now = sql<string>`now()`;
	await tx
		.updateTable("next_step")
		.set({
			resolution,
			resolution_reason: reason ?? null,
			done_at: done_at ?? (resolution === "done" ? now : null),
			resolved_at: resolution === "cancelled" ? now : null,
		})
		.where("id", "=", next_step_id)
		.execute();
	return { next_step_id, status: resolution };
}

async function reopenStep(
	tx: Transaction<DB>,
	{ next_step_id }: StepRequest<typeof STEP_REOPEN>,
): Promise<JsonObject> {
	const step = await lockStep(tx, next_step_id);
	if (step.status === "open")
		throw new SaveRefusal(new Refusal(409, "step_open"));
	await saveOpenStep(tx, step, () =>
		tx
			.updateTable("next_step")
			.set({
				resolution: null,
				resolution_reason: null,
				done_at: null,
				resolved_at: null,
			})
			.where("id", "=", next_step_id)
			.execute(),
	);
	return { next_step_id, status: "open" };
}

// A save on one step, which its request names so its receipt does too.
const stepSave =
	<Request extends JsonObject>(
		verb: string,
		parse: (body: JsonObject) => Refusal | Request,
		change: (
			tx: Transaction<DB>,
			request: Request & { next_step_id: string },
		) => Promise<JsonObject>,
	) =>
	(c: Context<NextSaveEnv>) => {
		const next_step_id = c.req.param("step") ?? "";
		return answerNextSave(
			c,
			verb,
			(body) => {
				if (!isUuid(next_step_id)) return new Refusal(404, "not_found");
				const request = parse(body);
				return request instanceof Refusal
					? request
					: { ...request, next_step_id };
			},
			change,
		);
	};

export const nextSteps = new Hono<NextSaveEnv>()
	.post("/next-steps", (c) =>
		answerNextSave(
			c,
			"next-step-create",
			(body) => fit(body, NEW_STEP, ["idempotency_key", "what"], RECORDS),
			createStep,
			201,
		),
	)
	.post(
		"/next-steps/:step/changes",
		stepSave(
			"next-step-changes",
			(body) =>
				fit(
					body,
					STEP_CHANGES,
					["idempotency_key", "seen_change_id"],
					STEP_CHANGED,
				),
			changeStep,
		),
	)
	.post(
		"/next-steps/:step/end",
		stepSave(
			"next-step-end",
			(body) => fit(body, STEP_END, ["idempotency_key", "resolution"]),
			endStep,
		),
	)
	.post(
		"/next-steps/:step/reopen",
		stepSave(
			"next-step-reopen",
			(body) => fit(body, STEP_REOPEN, ["idempotency_key"]),
			reopenStep,
		),
	);
