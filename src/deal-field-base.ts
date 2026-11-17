import { sql } from "kysely";
import { Refusal } from "./answer.ts";
import { PARTNERS } from "./clients/read.ts";
import type { JsonObject, JsonValue } from "./database.d.ts";
import { lookupRefusal, resolveDeal } from "./deals/resolve.ts";
import { SaveRefusal, type Saving } from "./save.ts";
import { isArguments } from "./save-door.ts";

const REASONS = ["prospect_never_active", "client_paused", "other"];
const isReason = (value: JsonValue | undefined): value is string =>
	typeof value === "string" && REASONS.includes(value);

export type Patch =
	| { field: "owner"; value: string | null }
	| {
			field: "operating_state";
			value: {
				state: "active" | "parked";
				reason: string | null;
				note: string | null;
			};
	  };

// These handler errors were not in the old public error vocabulary.
function refused(): never {
	throw new SaveRefusal(new Refusal(400, "unhandled_verb_failure"));
}

// The old error named the cell, not an input name, so it fell back to this general answer.
function invalidValue(): never {
	throw new SaveRefusal(new Refusal(400, "database_refused_the_statement"));
}

function validated({ field, value, occurred_on }: JsonObject): Patch {
	if (field === "owner") {
		if (
			value !== null &&
			(typeof value !== "string" || !PARTNERS.some((p) => p === value))
		)
			invalidValue();
		if (occurred_on != null) refused();
		return { field, value };
	}
	if (
		field !== "operating_state" ||
		!isArguments(value) ||
		(value.state !== "active" && value.state !== "parked")
	)
		invalidValue();
	const reason = isReason(value.reason) ? value.reason : null;
	if (value.state === "parked" && reason === null) refused();
	if (value.state === "active" && (value.reason != null || value.note != null))
		refused();
	if (
		value.note != null &&
		(typeof value.note !== "string" || value.note.trim().length > 500)
	)
		refused();
	if (occurred_on != null) refused();
	return {
		field,
		value: {
			state: value.state,
			reason: value.state === "parked" ? reason : null,
			note:
				value.state === "parked" && typeof value.note === "string"
					? value.note.trim() || null
					: null,
		},
	};
}

export async function preparePatch(saving: Saving, args: JsonObject) {
	const change = validated(args);
	const { tx, actor_id } = saving;
	const { field } = change;
	const subject = await resolveDeal(tx, String(args.deal));
	if ("error" in subject) throw new SaveRefusal(lookupRefusal(subject));
	const deal_id = subject.id;
	await sql`select pg_advisory_xact_lock(hashtextextended(${deal_id} || ':' || ${field}, 0))`.execute(
		tx,
	);
	const base = args.base_event_id ?? null;
	if (
		base &&
		!(await tx
			.selectFrom("event")
			.select("id")
			.where("id", "=", String(base))
			.where("subject_type", "=", "deal")
			.where("subject_id", "=", deal_id)
			.where("field", "=", field)
			.executeTakeFirst())
	)
		refused();
	const newer = await tx
		.selectFrom("event as e")
		.innerJoin("actor as a", "a.id", "e.actor_id")
		.select(["e.id", "e.actor_id", "a.slug"])
		.select(sql<JsonValue>`e.new_value -> ${field}`.as("value"))
		.where("e.subject_type", "=", "deal")
		.where("e.subject_id", "=", deal_id)
		.where("e.field", "=", field)
		.where(
			sql<boolean>`(${base}::uuid is null or (e.recorded_at, e.id) > (select b.recorded_at, b.id from event b where b.id=${base}::uuid))`,
		)
		.orderBy("e.recorded_at", "desc")
		.orderBy("e.id", "desc")
		.limit(1)
		.executeTakeFirst();
	if (newer) {
		const made = await tx
			.insertInto("deal_conflict")
			.values({
				deal_id,
				field,
				value_a: sql<JsonValue>`${JSON.stringify(newer.value)}::jsonb`,
				actor_a: newer.actor_id,
				event_a: newer.id,
				value_b: sql<JsonValue>`${JSON.stringify(args.value)}::jsonb`,
				actor_b: actor_id,
			})
			.returning(["id", "status"])
			.executeTakeFirstOrThrow();
		return {
			ok: false,
			conflict: {
				id: made.id,
				status: made.status,
				deal_id,
				field,
				value_a: newer.value,
				actor_a: newer.slug,
				event_a: newer.id,
				value_b: args.value,
				actor_b: saving.partner,
			},
		};
	}
	return { deal_id, change };
}
