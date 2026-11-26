import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal, refuse } from "../answer.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { fit, isUuid } from "../request-shape.ts";
import { checklistOf, nextChecklistStep } from "./checklist.ts";
import { isOpenBoardDeal, selectNextDealsWithFacts } from "./next-board.ts";

const JOB = "workflow_suggestions";

function candidates(db: Transaction<DB>) {
	return db
		.selectFrom(selectNextDealsWithFacts(db).as("board"))
		.select([
			"id",
			"phase",
			"kind",
			"reason",
			"type",
			"owner",
			"renewal_lease_unrecorded",
		])
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

async function leaseOf(db: Transaction<DB>, dealId: string) {
	const { rows } = await sql<{
		evidence_ref: string | null;
		executed_on: string | null;
		expiration_on: string | null;
		recorded_on: string | null;
	}>`
		select file.name as evidence_ref, lease.executed_on::text, lease.expiration_on::text,
			(select (min(first.created_at) at time zone 'America/Chicago')::date::text
				from lease_version first where first.lease_id = lease.lease_id) as recorded_on
		from current_lease lease
		join document file on file.id = lease.document_id
		where lease.deal_id = ${dealId}::uuid
	`.execute(db);
	const lease = rows[0];
	return lease ? { status: "current" as const, ...lease } : null;
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

function checklistDeal(deal: {
	reason: string | null;
	type: string | null;
	kind: string | null;
	renewal_lease_unrecorded: boolean;
}) {
	const named = deal.reason === "renewal" ? deal.reason : deal.type;
	return deal.renewal_lease_unrecorded ? deal.kind : named;
}

async function propose(db: Transaction<DB>) {
	const open = await candidates(db).execute();
	if (open.length === 0) return { proposed: 0, already_proposed: 0 };
	const ids = open.map((deal) => deal.id);
	await sql`select id from deal where id = any(${ids}::uuid[]) order by id for update`.execute(
		db,
	);
	const deals = await candidates(db).where("id", "in", ids).execute();
	const {
		rows: [clock],
	} = await sql<{ today: string }>`
		select (now() at time zone 'America/Chicago')::date::text as today
	`.execute(db);
	if (!clock) throw new Error("Chicago today was not read");
	let proposed = 0;
	let already_proposed = 0;
	for (const deal of deals) {
		const pending = await sql<{ id: string }>`
			select id from proposal
			where deal_id = ${deal.id}::uuid and kind = 'workflow_step' and status = 'pending'
		`.execute(db);
		if (pending.rows.length > 0) {
			already_proposed += 1;
			continue;
		}
		const checklist = checklistOf({
			deal: {
				id: deal.id,
				owner: deal.owner,
				type: checklistDeal(deal),
				invoiced_on: null,
			},
			lease: await leaseOf(db, deal.id),
			criticalDates: [],
			templateCurrent: true,
			commissions: [],
			requests: [],
			today: clock.today,
		});
		const step = nextChecklistStep(checklist.phases, deal.phase);
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
