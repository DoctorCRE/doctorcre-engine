import { Hono } from "hono";
import { type RawBuilder, sql, type Transaction } from "kysely";
import { Refusal, refuse } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import { lockFields } from "./deal-field-base.ts";
import { lookupRefusal, resolveDeal } from "./deals/resolve.ts";
import { failureKind } from "./failure.ts";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import type { NextSaveEnv } from "./next-door.ts";
import { stampNextSave } from "./next-save.ts";
import { automaticResolutions } from "./next-steps.ts";
import { dropOverdueWork, notKept } from "./overdue-work.ts";
import {
	answerSave,
	SaveRefusal,
	type Saving,
	type WriterEnv,
} from "./save.ts";

export const nextStep = new Hono<WriterEnv>();

nextStep.post("/set-next-step", (c) =>
	answerSave(
		c,
		{
			verb: "set-next-step",
			fields: {
				idempotency_key: {},
				deal: {},
				text: {},
				base_version: { type: "number" },
				next_date: {},
			},
			required: ["idempotency_key", "deal", "text", "base_version"],
		},
		setNextStep,
	),
);

function refuseSave(refusal: Refusal): never {
	throw new SaveRefusal(refusal);
}

async function setNextStep(saving: Saving, args: JsonObject) {
	const { tx } = saving;
	const subject = await resolveDeal(tx, String(args.deal));
	if ("error" in subject) refuseSave(lookupRefusal(subject));
	const deal_id = subject.id;
	const { text } = args;
	// The old text_required was not a public error.
	if (typeof text !== "string" || !text.trim())
		refuseSave(new Refusal(400, "unhandled_verb_failure"));
	const next_date = args.next_date ?? null;
	if (
		next_date !== null &&
		(typeof next_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(next_date))
	)
		refuseSave(
			new Refusal(400, "invalid_field_value", { fields: ["next_date"] }),
		);
	await lockFields(tx, deal_id, ["next_date", "next_step"]);
	// Strict: a newer version refuses even when it changed another field.
	const { version } = await tx
		.selectFrom("deal")
		.select("version")
		.where("id", "=", deal_id)
		.forUpdate()
		.executeTakeFirstOrThrow();
	if (version !== args.base_version)
		refuseSave(
			new Refusal(409, "version_conflict", { current_version: version }),
		);
	const kept = await awaitingAssessment(saving, deal_id);
	await dropOverdueWork(saving, deal_id, kept);
	return appendNextStep(saving, deal_id, text.trim(), next_date, kept);
}

// Actions a recorded update still has to assess in the last 14 days, as the
// old writer found them; a null id is kept too, and then nothing is dropped.
async function awaitingAssessment(
	{ tx, idempotency_key }: Saving,
	deal_id: string,
) {
	const { rows } = await sql<{ id: string | null }>`
		select distinct (e.new_value#>>'{action,id}')::uuid as id from event e
		where e.subject_type='deal' and e.subject_id=${deal_id} and e.field='overdue_assessment'
			and (e.new_value->>'candidate_id' is null or e.idempotency_key=${idempotency_key})
			and e.new_value->>'resolved'='false' and e.recorded_at >= current_timestamp - interval '14 days'
		union
		select distinct (a->>'id')::uuid from event e
		cross join lateral jsonb_array_elements(e.new_value->'actions') a
		where e.subject_type='deal' and e.subject_id=${deal_id} and e.field='overdue_assessment_pending'
			and (e.new_value->>'candidate_id' is null or e.idempotency_key=${idempotency_key})
			and a->>'source'='next_action' and e.recorded_at >= current_timestamp - interval '14 days'
			and not exists (select 1 from event done where done.field='overdue_assessment_status'
				and done.new_value->>'request_id'=e.id::text and done.new_value->>'status' in ('complete','conflict'))`.execute(
		tx,
	);
	return rows.map((row) => row.id);
}

// The new schema stores the assessment as a proposal and the update as an activity.
const heldSteps = (tx: Transaction<DB>, owner: RawBuilder<string>) =>
	tx
		.selectFrom("proposal as p")
		.innerJoin("next_step as s", "s.id", "p.next_step_id")
		.innerJoin("deal as d", "d.id", "s.deal_id")
		.innerJoin("activity as a", "a.id", "p.activity_id")
		.select([
			"p.id as proposal_id",
			"d.id as deal_id",
			"d.name as deal_name",
			"s.id as next_step_id",
			"s.what",
			"s.due_on",
			"p.evidence",
			"a.id as activity_id",
			"a.kind as activity_kind",
			"a.happened_at",
			"a.summary",
			sql<boolean>`s.changed_at = p.step_seen_at`.as("can_resolve"),
		])
		.where("s.owner_party_id", "=", owner)
		.where("s.status", "=", "open")
		.where("p.kind", "=", "next_step_done")
		.where("p.status", "=", "pending")
		.orderBy("p.created_at")
		.orderBy("p.id");

export const heldStepReviews = new Hono<NextSaveEnv>().get(
	"/home/held-steps",
	async (c) => {
		const reader = c.env.DATABASE;
		if (!reader) return refuse(c, new Refusal(503, "database_unavailable"));
		try {
			return c.json(
				await nextTransaction(reader.connectionString, "read", async (tx) => {
					await stampNextSave(tx, c.get("stamp"));
					const owner = sql<string>`current_setting('engine.user_id')::uuid`;
					return {
						proposals: await heldSteps(tx, owner).execute(),
						automatic_resolutions: (
							await automaticResolutions(tx, owner)
								.select([
									"s.id as next_step_id",
									"s.what",
									"s.done_at",
									"h.id as change_id",
									"d.id as deal_id",
									"d.name as deal_name",
								])
								.where(
									"h.changed_at",
									">=",
									sql<string>`now() - interval '7 days'`,
								)
								.orderBy("h.id", "desc")
								.execute()
						).map(({ change_id, ...step }) => ({
							...step,
							change_id: Number(change_id),
						})),
					};
				}),
			);
		} catch (error) {
			if (error instanceof SaveRefusal) return refuse(c, error.refusal);
			console.warn("held steps read failed:", failureKind(error));
			return refuse(c, new Refusal(503, "database_unavailable"));
		}
	},
);

// The prior step stays as history; the partner's other open steps are dropped.
// A deal update's step is recorded under set-next-step too, as the old writer did.
export async function appendNextStep(
	{ tx, actor_id, record }: Saving,
	deal_id: string,
	text: string,
	next_date: string | null,
	kept: readonly (string | null)[],
) {
	const before = await tx
		.selectFrom("deal")
		.select("next_date")
		.where("id", "=", deal_id)
		.executeTakeFirstOrThrow();
	const prior = await tx
		.selectFrom("deal_note")
		.select(["id", "text"])
		.where("deal_id", "=", deal_id)
		.where("kind", "=", "next_step")
		.orderBy("created_at", "desc")
		.orderBy("id", "desc")
		.limit(1)
		.executeTakeFirst();
	const board = await tx
		.selectFrom("v_deal_room_board as b")
		.leftJoin("v_deal_current_action as n", (join) =>
			join.onRef("n.deal_id", "=", "b.id").on("n.status", "=", "open"),
		)
		.select(["b.next_step", "n.id as board_next_action_id"])
		.where("b.id", "=", deal_id)
		.executeTakeFirst();
	const note = await tx
		.insertInto("deal_note")
		.values({
			deal_id,
			kind: "next_step",
			text,
			actor_id,
			created_at: sql<string>`clock_timestamp()`,
		})
		.returning([
			"id",
			sql<string>`to_jsonb(created_at)#>>'{}'`.as("created_at"),
		])
		.executeTakeFirstOrThrow();
	await tx
		.updateTable("deal")
		.set({ next_date, updated_by: actor_id })
		.where("id", "=", deal_id)
		.execute();
	const replaced = await tx
		.updateTable("next_action")
		.set({ status: "dropped", updated_by: actor_id })
		.where("subject_type", "=", "deal")
		.where("subject_id", "=", deal_id)
		.where("owner_id", "=", actor_id)
		.where("status", "=", "open")
		.where("item_title", "is", null)
		.where(notKept(kept))
		.returning("id")
		.execute();
	const action = await tx
		.insertInto("next_action")
		.values({
			subject_type: "deal",
			subject_id: deal_id,
			owner_id: actor_id,
			due_on: next_date,
			description: text,
			created_by: actor_id,
			updated_by: actor_id,
			updated_at: sql<string>`clock_timestamp()`,
			status: "open",
		})
		.returning("id")
		.executeTakeFirstOrThrow();
	const event = {
		verb: "set-next-step",
		subject_type: "deal",
		subject_id: deal_id,
		after_lock: true as const,
	};
	await record({
		...event,
		field: "next_step",
		old: {
			next_step: prior?.text ?? null,
			...(board && {
				board_next_step: board.next_step ?? null,
				board_next_action_id: board.board_next_action_id ?? null,
			}),
		},
		new: {
			next_step: text,
			next_date,
			next_action_id: action.id,
			replaced_action_ids: replaced.map((row) => row.id),
		},
	});
	await record({
		...event,
		field: "next_date",
		old: { next_date: before.next_date },
		new: { next_date },
	});
	return {
		ok: true,
		deal_id,
		next_step_id: note.id,
		next_action_id: action.id,
		supersedes: prior?.id ?? null,
		created_at: note.created_at,
	};
}
