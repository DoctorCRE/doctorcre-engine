import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { jsonObjectFrom } from "kysely/helpers/postgres";
import { Refusal, refuse } from "../answer.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { fit, isUuid } from "../request-shape.ts";
import { checklistOf, checklistType, nextChecklistStep } from "./checklist.ts";
import { isOpenBoardDeal, selectNextDealsWithFacts } from "./next-board.ts";
import { currentLeaseOf } from "./plan-read.ts";

const JOB = "workflow_suggestions";

function openDeals(db: Transaction<DB>, ids?: string[]) {
	const board = selectNextDealsWithFacts(db);
	return db
		.selectFrom((ids ? board.where("d.id", "in", ids) : board).as("board"))
		.where(isOpenBoardDeal)
		.where("operating_state", "=", "active")
		.where(
			sql<boolean>`not exists (
				select from next_step s
				where s.deal_id = board.id and s.status = 'open' and s.item_title is null
			)`,
		)
		.where(
			sql<boolean>`not exists (
				select from proposal p
				where p.deal_id = board.id and p.status = 'pending' and p.kind = 'next_step'
			)`,
		)
		.orderBy("id");
}

async function dueOn(
	db: Transaction<DB>,
	today: string,
	kind: string | null,
	todo: string,
) {
	if (!kind) return null;
	const { rows } = await sql<{ due_on: string }>`
		select (${today}::date + days)::text as due_on
		from typical_length where deal_kind = ${kind} and todo = ${todo}
	`.execute(db);
	return rows[0]?.due_on ?? null;
}

async function propose(db: Transaction<DB>) {
	const ids = (await openDeals(db).select("id").execute()).map(({ id }) => id);
	if (ids.length === 0) return { proposed: 0, already_proposed: 0 };
	await sql`select id from deal where id = any(${ids}::uuid[]) order by id for update`.execute(
		db,
	);
	const deals = await openDeals(db, ids)
		.select((eb) => [
			"id",
			"phase",
			"kind",
			"reason",
			"type",
			"owner",
			"renewal_lease_unrecorded",
			jsonObjectFrom(currentLeaseOf(db, eb.ref("board.id"))).as("lease"),
			// A decided suggestion settles its to-do: the checklist keeps no per-deal done state.
			sql<string[]>`array(
				select what from proposal
				where deal_id = board.id and kind = 'workflow_step' and status <> 'pending'
			)`.as("settled"),
		])
		.execute();
	const {
		rows: [clock],
	} = await sql<{ today: string }>`
		select (now() at time zone 'America/Chicago')::date::text as today
	`.execute(db);
	if (!clock) throw new Error("Chicago today was not read");
	let proposed = 0;
	let already_proposed = 0;
	for (const deal of deals) {
		const checklist = checklistOf({
			deal: {
				id: deal.id,
				owner: deal.owner,
				type: checklistType(deal),
				invoiced_on: null,
			},
			lease: deal.lease,
			criticalDates: [],
			templateCurrent: true,
			commissions: [],
			requests: [],
			today: clock.today,
		});
		const step = nextChecklistStep(
			checklist.phases,
			deal.phase,
			new Set(deal.settled),
		);
		if (!step) continue;
		const evidence = `From the checklist · ${step.label} is next in ${step.phaseLabel}`;
		const inserted = await sql<{ id: string }>`
			insert into proposal (kind, evidence, proposed_by_job, deal_id, what, due_on)
			values ('workflow_step', ${evidence}, ${JOB}, ${deal.id}::uuid, ${step.label},
				${await dueOn(db, clock.today, deal.kind, step.todo)}::date)
			on conflict (deal_id) where kind = 'workflow_step' and status = 'pending' do nothing
			returning id
		`.execute(db);
		if (inserted.rows.length > 0) proposed += 1;
		else already_proposed += 1;
	}
	return { proposed, already_proposed };
}

export const workflowSuggestions = new Hono<NextSaveEnv>().post(
	"/deals/workflow-suggestions",
	async (c) => {
		if (c.get("stamp").job !== JOB)
			return refuse(c, new Refusal(403, "unknown_job"));
		return answerNextSave(
			c,
			"propose-workflow-suggestions",
			(body) => fit(body, { idempotency_key: isUuid }, ["idempotency_key"]),
			propose,
		);
	},
);
