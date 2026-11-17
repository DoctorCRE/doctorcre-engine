import { Hono } from "hono";
import { sql } from "kysely";
import { Refusal } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import { preparePatch } from "./deal-field-base.ts";
import {
	answerSave,
	SaveRefusal,
	type Saving,
	type WriterEnv,
} from "./save.ts";

export const dealField = new Hono<WriterEnv>();
const FIELDS = ["owner", "operating_state"];

dealField.post("/patch-deal-field", (c) =>
	answerSave(
		c,
		{
			verb: "patch-deal-field",
			fields: {
				idempotency_key: {},
				deal: {},
				field: { allowed: FIELDS },
				value: { nullable: true },
				base_event_id: { nullable: true },
				change_reason: {},
				human_quote: {},
				occurred_on: {},
			},
			required: ["idempotency_key", "deal", "field", "value", "base_event_id"],
		},
		patch,
	),
);

async function patch(saving: Saving, args: JsonObject) {
	const result = await preparePatch(saving, args);
	if ("conflict" in result) return result;
	const { deal_id, change } = result;
	const { field } = change;
	const { tx, actor_id, record } = saving;
	const old = await tx
		.selectFrom("deal")
		.select("owner")
		.select(
			sql<JsonObject>`jsonb_build_object('state',operating_state,'reason',parking_reason,'note',parking_note)`.as(
				"parking",
			),
		)
		.where("id", "=", deal_id)
		.executeTakeFirstOrThrow();
	const old_value = field === "owner" ? old.owner : old.parking;
	if (change.field === "owner") {
		await tx
			.updateTable("deal_participant")
			.set({ to_at: sql<string>`now()` })
			.where("deal_id", "=", deal_id)
			.where("role", "=", "lead")
			.where("to_at", "is", null)
			.execute();
		if (change.value) {
			const next = await tx
				.selectFrom("actor")
				.select("id")
				.where("slug", "=", change.value)
				.where("active", "=", true)
				.executeTakeFirst();
			if (!next) throw new SaveRefusal(new Refusal(400, "unknown_owner"));
			await tx
				.insertInto("deal_participant")
				.values({ deal_id, actor_id: next.id, role: "lead", set_by: actor_id })
				.execute();
		}
		await tx
			.updateTable("deal")
			.set({ owner: change.value, updated_by: actor_id })
			.where("id", "=", deal_id)
			.execute();
	} else {
		const { state, reason, note } = change.value;
		await tx
			.updateTable("deal")
			.set({
				operating_state: state,
				parking_reason: reason,
				parking_note: note,
				parked_at: state === "parked" ? sql<string>`now()` : null,
				parked_by: state === "parked" ? actor_id : null,
				updated_by: actor_id,
			})
			.where("id", "=", deal_id)
			.execute();
	}
	await record({
		subject_type: "deal",
		subject_id: deal_id,
		field,
		old: { [field]: old_value },
		new: { [field]: change.value },
		after_lock: true,
		...(typeof args.human_quote === "string" && {
			human_quote: args.human_quote,
		}),
		...(typeof args.change_reason === "string" && {
			agent_rationale: args.change_reason,
		}),
	});
	const committed = await tx
		.selectFrom("event")
		.select("id")
		.select(sql<string>`to_jsonb(recorded_at)#>>'{}'`.as("recorded_at"))
		.where("subject_type", "=", "deal")
		.where("subject_id", "=", deal_id)
		.where("field", "=", field)
		.where("idempotency_key", "=", String(args.idempotency_key))
		.orderBy("recorded_at", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
	return {
		ok: true,
		deal_id,
		field,
		old_value,
		new_value: change.value,
		event_id: committed?.id ?? null,
		event_recorded_at: committed?.recorded_at ?? null,
	};
}
