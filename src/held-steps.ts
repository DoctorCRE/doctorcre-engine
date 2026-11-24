import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal, refuse } from "./answer.ts";
import { failureKind } from "./failure.ts";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import type { NextSaveEnv } from "./next-door.ts";
import { ACTING_USER, stampNextSave } from "./next-save.ts";
import { automaticResolutions } from "./next-steps.ts";
import { SaveRefusal } from "./save.ts";

const heldSteps = (tx: Transaction<DB>) =>
	tx
		.selectFrom("proposal as p")
		.innerJoin("next_step as s", "s.id", "p.next_step_id")
		.innerJoin("deal as d", "d.id", "s.deal_id")
		.leftJoin("activity as a", "a.id", "p.activity_id")
		.select([
			"p.id as proposal_id",
			"d.id as deal_id",
			"d.name as deal_name",
			"s.id as next_step_id",
			"s.what",
			"s.due_on",
			sql<string | null>`case when a.id is not null then p.evidence end`.as(
				"evidence",
			),
			"a.id as activity_id",
			"a.kind as activity_kind",
			"a.happened_at",
			"a.summary",
			sql<boolean>`s.changed_at = p.step_seen_at`.as("can_resolve"),
		])
		.where("s.owner_party_id", "=", ACTING_USER)
		.where("s.status", "=", "open")
		.where("p.kind", "=", "next_step_done")
		.where("p.status", "=", "pending")
		.orderBy("p.created_at")
		.orderBy("p.id");

async function recentAutomaticResolutions(tx: Transaction<DB>) {
	return (
		await automaticResolutions(tx)
			.select([
				"s.id as next_step_id",
				"s.what",
				"s.done_at",
				"h.id as change_id",
				"h.changed_by_job",
				"d.id as deal_id",
				"d.name as deal_name",
			])
			.where("h.changed_at", ">=", sql<string>`now() - interval '7 days'`)
			.where(({ not, exists, selectFrom }) =>
				not(
					exists(
						selectFrom("next_step as open_step")
							.select("open_step.id")
							.whereRef("open_step.deal_id", "=", "s.deal_id")
							.whereRef("open_step.owner_party_id", "=", "s.owner_party_id")
							.where("open_step.status", "=", "open")
							.where("open_step.item_title", "is", null)
							.where("open_step.property_id", "is", null),
					),
				),
			)
			.orderBy("h.id", "desc")
			.execute()
	).map(({ change_id, ...step }) => ({
		...step,
		change_id: Number(change_id),
	}));
}

export const heldStepReviews = new Hono<NextSaveEnv>().get(
	"/home/held-steps",
	async (c) => {
		const reader = c.env.DATABASE;
		if (!reader) return refuse(c, new Refusal(503, "database_unavailable"));
		try {
			return c.json(
				await nextTransaction(reader.connectionString, "read", async (tx) => {
					await stampNextSave(tx, c.get("stamp"));
					return {
						proposals: await heldSteps(tx).execute(),
						automatic_resolutions: await recentAutomaticResolutions(tx),
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
