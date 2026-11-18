import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal, refuse } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { ACTING_USER } from "../next-save.ts";
import { createStep } from "../next-steps.ts";
import {
	type Fitted,
	fit,
	fitting,
	isText,
	optional,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { isUuid } from "../uuid.ts";
import { recordActivity } from "./next-record.ts";

const DEAL_NOTE = {
	idempotency_key: isUuid,
	deal_id: isUuid,
	text: isText,
	plan: optional(fitting({ what: isText, due_on: isCalendarDate })),
};

async function recordDealNote(
	tx: Transaction<DB>,
	{ idempotency_key, deal_id, text, plan }: Fitted<typeof DEAL_NOTE>,
) {
	const deal = await tx
		.selectFrom("deal")
		.select("id")
		.where("id", "=", deal_id)
		.forNoKeyUpdate()
		.executeTakeFirst();
	if (!deal) throw new SaveRefusal(new Refusal(404, "not_found"));
	const summary = text.trim();
	const { activity_id } = await recordActivity(tx, {
		idempotency_key,
		kind: "note",
		about: [{ deal_id }],
		summary,
		from_party_id: null,
		reached: null,
		email: null,
	});
	if (plan) {
		const { next_step_id } = await createStep(tx, {
			deal_id,
			what: plan.what.trim(),
			due_on: plan.due_on,
			replaces: "current",
		});
		return { activity_id, next_step_id, next_step_required: false };
	}
	const overdue = await tx
		.selectFrom("next_step")
		.select("id")
		.where("deal_id", "=", deal_id)
		.where("owner_party_id", "=", ACTING_USER)
		.where("status", "=", "open")
		.where("item_title", "is", null)
		.where(
			"due_on",
			"<",
			sql<string>`(now() at time zone 'America/Chicago')::date`,
		)
		.forNoKeyUpdate()
		.executeTakeFirst();
	const proposal =
		overdue &&
		(await tx
			.insertInto("proposal")
			.values({
				kind: "next_step_done",
				activity_id,
				activity_kind: "note",
				evidence: summary,
				proposed_by_job: "agent",
				deal_id,
				next_step_id: overdue.id,
				changed_at: sql<string>`now()`,
			})
			.returning("id")
			.executeTakeFirstOrThrow());
	const current = await tx
		.selectFrom("deal_next_date")
		.select("due_on")
		.where("deal_id", "=", deal_id)
		.executeTakeFirst();
	return {
		activity_id,
		proposal_id: proposal?.id ?? null,
		next_step_required: !current?.due_on,
	};
}

export const dealNoteDoor = new Hono<NextSaveEnv>().post(
	"/activities/deal-note",
	async (c) => {
		const stamp = c.get("stamp");
		if (stamp.job !== "agent" || !stamp.for_user)
			return refuse(c, new Refusal(403, "AUTHORIZATION_REFUSED"));
		return answerNextSave(
			c,
			"add-deal-note",
			(body) => fit(body, DEAL_NOTE, ["idempotency_key", "deal_id", "text"]),
			recordDealNote,
			201,
		);
	},
);
