import { type Context, Hono } from "hono";
import { sql, type Transaction } from "kysely";
import pg from "pg";
import { Refusal } from "./answer.ts";
import { isCalendarDate } from "./calendar-date.ts";
import type { JsonObject } from "./database.d.ts";
import type { DB } from "./next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { ACTING_USER, type Stamp, userId } from "./next-save.ts";
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

const SUBJECTS = ["deal_id", "party_id", "old_role"] as const;
const RECORDS = ["deal_id", "party_id", "property_id"] as const;
const OLD_ROLE = {
	kind: (value: unknown): value is "lead" | "client" | "vendor" =>
		value === "lead" || value === "client" || value === "vendor",
	id: isUuid,
};
const STEP_SUBJECT = {
	deal_id: optional(isUuid),
	party_id: optional(isUuid),
	old_role: optional(fitting(OLD_ROLE)),
};
const SUBJECT_COMPLETE = { idempotency_key: isUuid, ...STEP_SUBJECT };
type CurrentSubject = { kind: "deal" | "party"; id: string };

function currentSubject(
	deal_id: string | undefined,
	party_id: string | undefined,
): CurrentSubject | undefined {
	if (deal_id && !party_id) return { kind: "deal", id: deal_id };
	if (party_id && !deal_id) return { kind: "party", id: party_id };
}

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
	...STEP_SUBJECT,
	property_id: optional(isUuid),
	...STEP_FIELDS,
	owner: optional(isText),
	replaces: optional((value): value is "current" => value === "current"),
	what: isText,
	item: optional(
		fitting({ title: isText, bullets: isBullets, source_ref: isText }),
	),
	call: optional(fitting({ activity_id: isUuid, evidence_quote: isText })),
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

const STEP_REOPEN = {
	idempotency_key: isUuid,
	base_version: optional(isChangeId),
};
const STEP_END = {
	...STEP_REOPEN,
	resolution: isResolution,
	done_at: optional(isInstant),
	reason: optional(isText),
};

const STEP_UNDO = { idempotency_key: isUuid, change_id: isChangeId };

type StepRequest<S extends Shape> = Fitted<S> & { next_step_id: string };

export async function resolveStepOwner(
	tx: Transaction<DB>,
	{ owner, owner_party_id }: { owner?: string; owner_party_id?: string | null },
) {
	if (owner === undefined) return owner_party_id;
	if (owner_party_id !== undefined)
		throw new SaveRefusal(
			new Refusal(400, "invalid_field_value", {
				fields: ["owner", "owner_party_id"],
			}),
		);
	return userId(tx, owner);
}

async function resolveOldRole(
	tx: Transaction<DB>,
	{
		old_role,
		deal_id,
		party_id,
		property_id,
	}: Fitted<typeof STEP_SUBJECT> & {
		property_id?: string;
	},
) {
	if (!old_role) return;
	if (deal_id || party_id || property_id)
		throw new SaveRefusal(
			new Refusal(400, "invalid_field_value", { fields: ["old_role"] }),
		);
	const match = await tx
		.selectFrom("outside_id as o")
		.innerJoin("party_role as r", (join) =>
			join
				.onRef("r.party_id", "=", "o.party_id")
				.on("r.role", "=", old_role.kind),
		)
		.select("r.party_id")
		.where("o.source", "=", "old_system")
		.where("o.value", "=", old_role.id.toLowerCase())
		.executeTakeFirst();
	if (!match) throw new SaveRefusal(new Refusal(404, "old_role_not_found"));
	return match.party_id;
}

async function lockSubject(tx: Transaction<DB>, { kind, id }: CurrentSubject) {
	const record = await tx
		.selectFrom(kind)
		.select("id")
		.where("id", "=", id)
		.forNoKeyUpdate()
		.executeTakeFirst();
	if (!record) throw new SaveRefusal(new Refusal(404, "not_found"));
}

export async function cancelCurrentStep(
	tx: Transaction<DB>,
	subject: CurrentSubject,
	owner: string | null,
) {
	await lockSubject(tx, subject);
	await tx
		.updateTable("next_step")
		.set({
			resolution: "cancelled",
			resolved_at: sql<string>`clock_timestamp()`,
			resolution_reason: "Replaced by a new next step",
		})
		.where(`${subject.kind}_id`, "=", subject.id)
		.where("status", "=", "open")
		.where("item_title", "is", null)
		.where(
			"owner_party_id",
			"=",
			sql<string>`coalesce(${owner}::uuid, ${ACTING_USER})`,
		)
		.execute();
}

// Written out, because the generated row type asks for the stamp the database sets.
export async function createStep(
	tx: Transaction<DB>,
	request: Omit<Fitted<typeof NEW_STEP>, "idempotency_key">,
) {
	const { deal_id, property_id, what, item, call, replaces } = request;
	const { due_on, hold_until } = request;
	const copiedParty = await resolveOldRole(tx, request);
	const party_id = copiedParty ?? request.party_id;
	const owner_party_id = (await resolveStepOwner(tx, request)) ?? null;
	if (replaces) {
		const subject = currentSubject(deal_id, party_id);
		if (!subject || item || property_id)
			throw new SaveRefusal(
				new Refusal(400, "invalid_field_value", { fields: ["replaces"] }),
			);
		await cancelCurrentStep(tx, subject, owner_party_id);
	}
	const insert = sql<{ id: string }>`
		insert into next_step (created_at, deal_id, party_id, property_id, what, owner_party_id, due_on, hold_until,
			item_title, item_bullets, source_ref, call_activity_id, call_evidence_quote)
		values (now(), ${deal_id ?? null}::uuid, ${party_id ?? null}::uuid, ${property_id ?? null}::uuid, ${what},
			${owner_party_id}::uuid, ${due_on ?? null}::date, ${hold_until ?? null}::date,
			${item?.title ?? null}, ${JSON.stringify(item?.bullets ?? [])}::jsonb, ${item?.source_ref ?? null},
			${call?.activity_id ?? null}::uuid, ${call?.evidence_quote ?? null})
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
		...(copiedParty && { party_id: copiedParty }),
	};
}

// The row lock queues crossed saves, so the later one sees the earlier one's change or end.
async function lockStep(tx: Transaction<DB>, id: string) {
	const step = await tx
		.selectFrom("next_step")
		.select(["status", "deal_id", "party_id", "owner_party_id", "item_title"])
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

async function checkStepVersion(
	tx: Transaction<DB>,
	id: string,
	base_version: number | undefined,
	allowOmitted: boolean,
) {
	if (base_version === undefined) {
		if (allowOmitted) return;
		throw new SaveRefusal(
			new Refusal(400, "missing_required", { fields: ["base_version"] }),
		);
	}
	const current_version = (await latestChange(tx, "next_step", id)) ?? 0;
	if (base_version !== current_version)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", { current_version }),
		);
}

async function endStep(
	tx: Transaction<DB>,
	request: StepRequest<typeof STEP_END>,
	stamp: Stamp,
): Promise<JsonObject> {
	const { next_step_id, resolution, done_at, reason, base_version } = request;
	const { status, item_title } = await lockStep(tx, next_step_id);
	await checkStepVersion(
		tx,
		next_step_id,
		base_version,
		stamp.job !== undefined || item_title !== null,
	);
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
	const change_id = await latestChange(tx, "next_step", next_step_id);
	return { next_step_id, status: resolution, change_id };
}

async function completeCurrentStep(
	tx: Transaction<DB>,
	request: Fitted<typeof SUBJECT_COMPLETE>,
) {
	const copiedParty = await resolveOldRole(tx, request);
	const subject = currentSubject(
		request.deal_id,
		copiedParty ?? request.party_id,
	);
	if (!subject)
		throw new SaveRefusal(
			new Refusal(400, "invalid_field_value", { fields: [...SUBJECTS] }),
		);
	await lockSubject(tx, subject);
	const step = await tx
		.updateTable("next_step")
		.set({ resolution: "done", done_at: sql<string>`clock_timestamp()` })
		.where(`${subject.kind}_id`, "=", subject.id)
		.where("owner_party_id", "=", ACTING_USER)
		.where("status", "=", "open")
		.where("item_title", "is", null)
		.returning(["id as next_step_id", "status"])
		.executeTakeFirst();
	if (!step) throw new SaveRefusal(new Refusal(409, "no_open_step"));
	return { ...step, ...(copiedParty && { party_id: copiedParty }) };
}

export function automaticResolutions(tx: Transaction<DB>) {
	const owner = sql<string>`current_setting('engine.user_id')::uuid`;
	return tx
		.selectFrom("next_step as s")
		.innerJoin("deal as d", "d.id", "s.deal_id")
		.innerJoinLateral(
			(eb) =>
				eb
					.selectFrom("change as c")
					.select([
						"id",
						"action",
						"old_value",
						"new_value",
						"changed_by_job",
						"changed_for_user_id",
						"changed_at",
					])
					.where("table_name", "=", "next_step")
					.where("record", "=", sql<JsonObject>`jsonb_build_object('id', s.id)`)
					.orderBy("id", "desc")
					.limit(1)
					.as("h"),
			(join) => join.onTrue(),
		)
		.where("s.owner_party_id", "=", owner)
		.where("s.item_title", "is", null)
		.where("s.status", "=", "done")
		.where("h.changed_for_user_id", "=", owner)
		.where("h.changed_by_job", "<>", "old_system")
		.where("h.action", "=", "update")
		.where(
			sql<boolean>`h.old_value @> '{"resolution":null}' and h.new_value @> '{"resolution":"done"}'`,
		);
}

async function reopenStep(
	tx: Transaction<DB>,
	request: StepRequest<typeof STEP_REOPEN>,
	stamp: Stamp,
): Promise<JsonObject> {
	const { next_step_id } = request;
	const step = await lockStep(tx, next_step_id);
	await checkStepVersion(
		tx,
		next_step_id,
		request.base_version,
		stamp.job !== undefined,
	);
	if (step.status === "open")
		throw new SaveRefusal(new Refusal(409, "step_open"));
	return reopenLockedStep(tx, next_step_id, step);
}

async function undoAutomaticResolution(
	tx: Transaction<DB>,
	{ next_step_id, change_id }: StepRequest<typeof STEP_UNDO>,
): Promise<JsonObject> {
	const step = await lockStep(tx, next_step_id);
	const completion = await automaticResolutions(tx)
		.select("h.id")
		.where("s.id", "=", next_step_id)
		.where("h.id", "=", String(change_id))
		.executeTakeFirst();
	if (!completion)
		throw new SaveRefusal(new Refusal(409, "automatic_resolution_changed"));
	return reopenLockedStep(tx, next_step_id, step);
}

async function reopenLockedStep(
	tx: Transaction<DB>,
	next_step_id: string,
	step: Awaited<ReturnType<typeof lockStep>>,
): Promise<JsonObject> {
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
			stamp: Stamp,
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
			(tx, request) => change(tx, request, c.get("stamp")),
		);
	};

export const nextSteps = new Hono<NextSaveEnv>()
	.post("/next-steps", (c) =>
		answerNextSave(
			c,
			"next-step-create",
			(body) =>
				fit(
					body,
					NEW_STEP,
					["idempotency_key", "what"],
					[...RECORDS, "old_role"],
				),
			createStep,
			201,
		),
	)
	.post("/next-steps/complete", (c) =>
		answerNextSave(
			c,
			"next-step-complete-current",
			(body) => fit(body, SUBJECT_COMPLETE, ["idempotency_key"], SUBJECTS),
			completeCurrentStep,
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

export const automaticStepUndo = new Hono<NextSaveEnv>().post(
	"/next-steps/:step/undo-automatic-resolution",
	stepSave(
		"next-step-undo-automatic-resolution",
		(body) => fit(body, STEP_UNDO, ["idempotency_key", "change_id"]),
		undoAutomaticResolution,
	),
);
