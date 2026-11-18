import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { clearable, fit, isText, isUuid } from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";

const resolutions = ["done", "dropped", "passed"] as const;
type Resolution = (typeof resolutions)[number];
const isResolution = (value: unknown): value is Resolution =>
	resolutions.some((resolution) => resolution === value);
const isDueDate = (value: unknown): value is string =>
	isCalendarDate(value) && !value.startsWith("0000-");

function parseDate(deal_id: string, body: JsonObject) {
	if (!isUuid(deal_id)) return new Refusal(404, "not_found");
	const args = fit(
		body,
		{
			idempotency_key: isUuid,
			kind: isText,
			due_on: isDueDate,
			source: isText,
			note: clearable(isText),
		},
		["idempotency_key", "kind", "due_on", "source"],
	);
	return args instanceof Refusal ? args : { ...args, deal_id };
}

async function decideDate(
	tx: Transaction<DB>,
	id: string,
	decision: { status: "open" } | { status: Resolution; reason: string },
) {
	const { status } = decision;
	const saved = await tx
		.updateTable("critical_date")
		.set({
			status,
			resolution_reason: "reason" in decision ? decision.reason : null,
		})
		.where("id", "=", id)
		.where("status", "!=", status)
		.returning(["id as critical_date_id", "status"])
		.executeTakeFirst();
	if (saved) return saved;
	const current = await tx
		.selectFrom("critical_date")
		.select("status")
		.where("id", "=", id)
		.executeTakeFirst();
	if (!current) throw new SaveRefusal(new Refusal(404, "not_found"));
	throw new SaveRefusal(new Refusal(409, "version_conflict", current));
}

export const criticalDates = new Hono<NextSaveEnv>()
	.post("/deals/:deal/critical-dates", (c) =>
		answerNextSave(
			c,
			"add_critical_date",
			(body) => parseDate(c.req.param("deal"), body),
			async (tx, { idempotency_key: _key, ...date }) =>
				tx
					.insertInto("critical_date")
					.values({ ...date, changed_at: sql<string>`now()` })
					.returning(["id as critical_date_id", "status"])
					.executeTakeFirstOrThrow(),
			201,
		),
	)
	.post("/critical-dates/:id/confirm", (c) =>
		answerNextSave(
			c,
			"confirm_critical_date",
			(body) => {
				const critical_date_id = c.req.param("id");
				if (!isUuid(critical_date_id)) return new Refusal(404, "not_found");
				const args = fit(body, { idempotency_key: isUuid }, [
					"idempotency_key",
				]);
				return args instanceof Refusal ? args : { ...args, critical_date_id };
			},
			(tx, { critical_date_id }) =>
				decideDate(tx, critical_date_id, { status: "open" }),
		),
	)
	.post("/critical-dates/:id/resolve", (c) =>
		answerNextSave(
			c,
			"resolve_critical_date",
			(body) => {
				const critical_date_id = c.req.param("id");
				if (!isUuid(critical_date_id)) return new Refusal(404, "not_found");
				const args = fit(
					body,
					{ idempotency_key: isUuid, resolution: isResolution, reason: isText },
					["idempotency_key", "resolution", "reason"],
				);
				return args instanceof Refusal ? args : { ...args, critical_date_id };
			},
			(tx, { critical_date_id, resolution, reason }) =>
				decideDate(tx, critical_date_id, { status: resolution, reason }),
		),
	);
