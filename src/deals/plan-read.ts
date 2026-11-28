import { type Expression, sql, type Transaction } from "kysely";
import type { DB } from "../next-database.d.ts";
import { asText } from "../reader.ts";
import { selectStepsWithOrigin } from "../step-origin.ts";
import { checklistOf, checklistType, criticalDateLabel } from "./checklist.ts";
import { forecastAttention, planOf } from "./plan.ts";

const chicagoDay = (instant: Expression<unknown>) =>
	asText(sql`(${instant} at time zone 'America/Chicago')::date`);

// An import can seed the phase at the last observed time without move evidence.
export const seededWithoutMove = sql`(p.changed_by_job is not distinct from 'old_system' and p.happened_at = p.changed_at
	and not exists (select from deal_phase_change prior
		where prior.deal_id = p.deal_id and prior.happened_at < p.happened_at))`;

type PhaseSpan = {
	phase: string;
	from_on: string | null;
	to_on: string | null;
};

export const commissionsOf = (db: Transaction<DB>, deal: Expression<string>) =>
	db
		.selectFrom("commission_payment as payment")
		.select((eb) => [
			eb
				.case()
				.when("payment.received_on", "is not", null)
				.then("received")
				.else("unpaid")
				.end()
				.as("status"),
			"payment.id",
			asText(eb.ref("payment.invoiced_on")).as("invoiced_on"),
			asText(eb.ref("payment.received_on")).as("received_on"),
		])
		.where("payment.deal_id", "=", deal)
		.orderBy("payment.invoiced_on")
		.orderBy("payment.created_at")
		.orderBy("payment.id");

export const criticalDatesOf = (
	db: Transaction<DB>,
	deal: Expression<string>,
) =>
	db
		.selectFrom("critical_date as cd")
		.leftJoin("app_user as by", "by.id", "cd.changed_by_user_id")
		.select((eb) => [
			"cd.id",
			"cd.kind",
			eb.fn.coalesce("by.slug", "cd.changed_by_job").as("actor"),
			asText(eb.ref("cd.changed_at")).as("updated_at"),
			asText(eb.ref("cd.due_on")).as("due_on"),
			"cd.note",
			"cd.source",
			eb
				.case()
				.when("cd.status", "=", "done")
				.then("cleared")
				.else(eb.ref("cd.status"))
				.end()
				.as("status"),
		])
		.where("cd.deal_id", "=", deal)
		.orderBy("cd.due_on")
		.orderBy("cd.id");

export const phaseSpansOf = (deal: Expression<string>) => sql<
	PhaseSpan[]
>`(select coalesce(jsonb_agg(jsonb_build_object(
					'phase', phase, 'from_on', from_on, 'to_on', to_on) order by happened_at), '[]')
				from (select p.phase, p.happened_at,
					case when not ${seededWithoutMove} then (p.happened_at at time zone 'America/Chicago')::date end as from_on,
					(lead(p.happened_at) over (order by p.happened_at) at time zone 'America/Chicago')::date as to_on
					from deal_phase_change p where p.deal_id = ${deal}) spans)`;
export const typicalLengthsOf = (kind: Expression<string | null>) => sql<
	Record<string, number>
>`(select coalesce(jsonb_object_agg(t.todo, t.days), '{}')
				from typical_length t where t.deal_kind = ${kind})`;

export const ownDatesOf = (deal: Expression<string>) => sql<
	Record<string, string>
>`
	(select coalesce(jsonb_object_agg(todo, target_on), '{}') from deal_plan_date
	where deal_id = ${deal} and target_on is not null)`;

export const planVersionOf = (deal: Expression<string>) => sql<number>`
	(select coalesce(max(id), 0)::float8 from change where table_name = 'deal_plan_date'
	and record @> jsonb_build_object('deal_id', ${deal}::uuid))`;

export const currentLeaseOf = (db: Transaction<DB>, deal: Expression<string>) =>
	db
		.selectFrom("current_lease as lease")
		.innerJoin("document as file", "file.id", "lease.document_id")
		.select((eb) => [
			"lease.id",
			"lease.version",
			asText(eb.ref("lease.executed_on")).as("executed_on"),
			asText(eb.ref("lease.commencement_on")).as("commencement_on"),
			asText(eb.ref("lease.expiration_on")).as("expiration_on"),
			chicagoDay(
				eb
					.selectFrom("lease_version as first")
					.select((eb) => eb.fn.min("first.created_at").as("at"))
					.whereRef("first.lease_id", "=", "lease.lease_id"),
			).as("recorded_on"),
			"file.name as evidence_ref",
			sql.lit("current").as("status"),
		])
		.where("lease.deal_id", "=", deal);

export const stepsOf = (db: Transaction<DB>, deal: Expression<string>) =>
	selectStepsWithOrigin(db)
		.leftJoin("app_user as o", "o.id", "s.owner_party_id")
		.leftJoin("app_user as by", "by.id", "s.changed_by_user_id")
		.select((eb) => [
			"s.id",
			"o.slug as owner",
			eb.fn.coalesce("by.slug", "s.changed_by_job").as("actor"),
			"s.what as description",
			"s.item_title as title",
			"s.item_bullets as bullets",
			"s.source_ref",
			asText(eb.ref("s.due_on")).as("due_on"),
			chicagoDay(eb.ref("s.created_at")).$notNull().as("set_on"),
			chicagoDay(eb.ref("s.done_at")).as("done_on"),
			"s.status",
			sql<number | null>`case when s.status = 'open' then (
				select coalesce(max(c.id), 0) from change c
				where c.table_name = 'next_step' and c.record = jsonb_build_object('id', s.id)
			) end`.as("change_id"),
			asText(eb.ref("s.hold_until")).as("hold_until"),
			asText(eb.ref("s.changed_at")).as("updated_at"),
		])
		.where("s.deal_id", "=", deal)
		.orderBy("s.created_at")
		.orderBy("s.id");

type ChecklistFacts = Parameters<typeof checklistType>[0] & {
	id: string;
	owner: Parameters<typeof checklistOf>[0]["deal"]["owner"];
	lease: Parameters<typeof checklistOf>[0]["lease"];
	invoiced_on: string | null;
	commissions: Parameters<typeof checklistOf>[0]["commissions"];
	critical_dates: (Parameters<typeof checklistOf>[0]["criticalDates"][number] &
		Omit<Parameters<typeof planOf>[0]["critical_dates"][number], "label">)[];
	today: string;
};

export const planChecklist = (facts: ChecklistFacts) =>
	checklistOf({
		deal: {
			id: facts.id,
			owner: facts.owner,
			type: checklistType(facts),
			invoiced_on: facts.invoiced_on,
		},
		lease: facts.lease,
		criticalDates: facts.critical_dates,
		templateCurrent: true,
		commissions: facts.commissions,
		requests: [],
		today: facts.today,
	});

export function boardTimeline({
	phase,
	outcome,
	phase_spans,
	steps,
	lengths,
	own_dates,
	attention,
	...facts
}: ChecklistFacts &
	Pick<
		Parameters<typeof planOf>[0],
		"phase" | "outcome" | "phase_spans" | "lengths" | "own_dates"
	> & {
		attention: Parameters<typeof forecastAttention>[0];
		steps: (Parameters<typeof planOf>[0]["steps"][number] & {
			label: string;
			change_id: number | null;
		})[];
	}) {
	const input = {
		phase,
		outcome,
		phase_spans,
		steps,
		lengths,
		own_dates: own_dates ?? {},
		today: facts.today,
		checklist: planChecklist(facts),
		critical_dates: facts.critical_dates.map((date) => ({
			...date,
			label: criticalDateLabel(date.kind),
		})),
	};
	const plan = planOf(input);
	const sourceSteps = new Map(steps.map((step) => [`step:${step.id}`, step]));
	const dates = plan.rows
		.filter((row) => row.kind === "critical_date")
		.filter((row) => row.status !== "cleared");
	const rows = plan.rows
		.filter((row) => row.phase === phase || row.phase === null)
		.map((row) => {
			const step = sourceSteps.get(row.id);
			return row.kind === "step" && step
				? {
						...row,
						label: step.label,
						change_id: step.change_id,
					}
				: row;
		});
	const ids = new Set(rows.map((row) => row.id));
	return {
		attention: forecastAttention(attention, input, plan),
		timeline: {
			phase_spans: plan.phases,
			expected_signing_on: plan.expected_signing_on,
			signing_recorded: plan.rows.some(
				(row) =>
					row.kind === "todo" &&
					row.id === "executed_lease" &&
					row.state === "finished",
			),
			stale: plan.stale,
			at_risk_count: dates.filter((date) => date.at_risk).length,
			dates,
			rows,
			arrows: plan.arrows.filter(
				(arrow) => ids.has(arrow.from) && ids.has(arrow.to),
			),
		},
	};
}
