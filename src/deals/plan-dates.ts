import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { Refusal, refuse } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import { clearable, fit, isChangeId, optional } from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { isUuid } from "../uuid.ts";
import { readNextDealDetail } from "./next-detail.ts";
import { planVersionOf } from "./plan-read.ts";

const todoSlug = (value: unknown): value is string =>
	typeof value === "string" && /^[a-z][a-z0-9_]*$/.test(value);
const bad = (field: string) =>
	new Refusal(400, "invalid_field_value", { fields: [field] });
const parse = (body: JsonObject) =>
	fit(
		body,
		{
			idempotency_key: isUuid,
			deal_id: isUuid,
			base_version: isChangeId,
			todo: optional(todoSlug),
			target_on: clearable(isCalendarDate),
		},
		["idempotency_key", "deal_id", "base_version"],
	);
type Request = Exclude<ReturnType<typeof parse>, Refusal>;

async function save(tx: Transaction<DB>, request: Request) {
	const { deal_id, base_version, todo, target_on } = request;
	if ((todo === undefined) !== (target_on === undefined))
		throw new SaveRefusal(bad(todo === undefined ? "todo" : "target_on"));
	const deal = await tx
		.selectFrom("deal")
		.select("id")
		.where("id", "=", deal_id)
		.forUpdate()
		.executeTakeFirst();
	if (!deal) throw new SaveRefusal(new Refusal(404, "not_found"));
	const detail = await readNextDealDetail(tx, deal_id);
	if ("error" in detail) throw new SaveRefusal(new Refusal(404, "not_found"));
	const { plan } = detail;
	if (base_version !== plan.base_version)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", {
				current_version: plan.base_version,
			}),
		);
	const previous_on =
		todo && Object.hasOwn(plan.own_dates, todo)
			? (plan.own_dates[todo] ?? null)
			: null;
	if (todo && target_on) {
		const { today, undo } = await tx
			.selectNoFrom([
				sql<string>`(now() at time zone 'America/Chicago')::date::text`.as(
					"today",
				),
				// Undo may restore the exact value replaced by the version being edited.
				sql<boolean>`exists (select from change where id = ${base_version}
					and table_name = 'deal_plan_date' and action = 'update'
					and record = jsonb_build_object('deal_id', ${deal_id}::uuid, 'todo', ${todo}::text)
					and old_value ->> 'target_on' = ${target_on})`.as("undo"),
			])
			.executeTakeFirstOrThrow();
		const row = plan.rows.find((item) => item.id === todo);
		if (
			!undo &&
			(target_on < today ||
				row?.kind !== "todo" ||
				row.state !== "expected" ||
				!row.expected_from_on ||
				target_on < row.expected_from_on ||
				!row.expected_to_on)
		)
			throw new SaveRefusal(bad("target_on"));
	}
	if (!todo) {
		await tx
			.updateTable("deal_plan_date")
			.set({ target_on: null })
			.where("deal_id", "=", deal_id)
			.where("target_on", "is not", null)
			.execute();
	} else if (target_on !== undefined && target_on !== previous_on) {
		await sql`insert into deal_plan_date (deal_id, todo, target_on)
			values (${deal_id}, ${todo}, ${target_on})
			on conflict (deal_id, todo) do update set target_on = excluded.target_on`.execute(
			tx,
		);
	}
	const version = await tx
		.selectNoFrom(planVersionOf(sql.val(deal_id)).as("version"))
		.executeTakeFirstOrThrow();
	return { base_version: version.version, previous_on };
}

export const dealPlanDates = new Hono<NextSaveEnv>().post(
	"/deals/:deal/plan-dates",
	async (c): Promise<Response> => {
		const deal = c.req.param("deal");
		if (!isUuid(deal)) return refuse(c, new Refusal(404, "not_found"));
		return answerNextSave(
			c,
			"save-deal-plan-date",
			(body) =>
				Object.hasOwn(body, "deal_id")
					? bad("deal_id")
					: parse({ ...body, deal_id: deal }),
			save,
		);
	},
);
