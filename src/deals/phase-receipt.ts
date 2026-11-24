import {
	type AliasableExpression,
	type Expression,
	sql,
	type Transaction,
} from "kysely";
import { jsonObjectFrom } from "kysely/helpers/postgres";
import type { DB } from "../next-database.d.ts";
import { asText } from "../reader.ts";

export const phaseReceiptFields = (
	phase: AliasableExpression<string | null>,
	happenedAt: Expression<string | null>,
	changedAt: Expression<string | null>,
) => [
	phase.as("phase"),
	asText(sql`(${happenedAt} at time zone 'America/Chicago')::date`).as(
		"evidence_date",
	),
	asText(changedAt).as("recorded_at"),
	sql.lit(true).as("automatic"),
];

export const withinUndoWindow = (recordedAt: Expression<string | null>) =>
	sql<boolean>`${recordedAt} > now() - interval '7 days'`;

export const automaticPhaseReceipt = (
	db: Transaction<DB>,
	deal: Expression<string>,
	phaseAt: Expression<string | null>,
) =>
	db
		.selectFrom("deal_phase_change as move")
		.leftJoin("imported_automatic_phase_move as copied", (join) =>
			join
				.onRef("copied.deal_id", "=", "move.deal_id")
				.onRef("copied.happened_at", "=", "move.happened_at"),
		)
		.where("move.deal_id", "=", deal)
		.where("move.happened_at", "=", phaseAt)
		.where((eb) =>
			eb.or([
				eb("copied.source_event_id", "is not", null),
				eb("move.call_move_id", "is not", null),
			]),
		)
		.select((eb) => [
			eb.fn
				.coalesce("copied.source_event_id", "move.call_move_id")
				.as("event_id"),
			eb.fn
				.coalesce(
					"copied.prior_phase",
					eb
						.selectFrom("deal_phase_change as prior")
						.select("prior.phase")
						.whereRef("prior.deal_id", "=", "move.deal_id")
						.whereRef("prior.happened_at", "<", "move.happened_at")
						.orderBy("prior.happened_at", "desc")
						.limit(1),
				)
				.as("prior_phase"),
			eb.fn
				.coalesce(
					sql<string | null>`nullif(${eb.ref("copied.reason")}, '')`,
					"move.reason",
				)
				.as("reason"),
			...phaseReceiptFields(
				eb.ref("move.phase"),
				eb.ref("move.happened_at"),
				eb.ref("move.changed_at"),
			),
			eb
				.case()
				.when("copied.source_event_id", "is not", null)
				.then(sql.lit("copied"))
				.else(sql.lit("call_capture"))
				.end()
				.as("source"),
			eb
				.and([
					withinUndoWindow(eb.ref("move.changed_at")),
					eb.not(
						eb.and([
							eb("copied.source_event_id", "is not", null),
							eb("move.phase", "=", "closed"),
							eb.exists(
								eb
									.selectFrom("deal_invoiced as invoice")
									.select("invoice.deal_id")
									.whereRef("invoice.deal_id", "=", "move.deal_id"),
							),
						]),
					),
				])
				.as("undoable"),
			jsonObjectFrom(
				eb
					.selectFrom("activity as call")
					.select(["call.id as activity_id", "call.happened_at"])
					.whereRef("call.id", "=", "move.call_activity_id"),
			).as("call"),
		]);
