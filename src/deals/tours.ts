import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { answerNextRead, checkFields, Refusal, refuse } from "../answer.ts";
import { isCalendarDate } from "../calendar-date.ts";
import type { JsonObject } from "../database.d.ts";
import type { DB } from "../next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "../next-door.ts";
import type { DatabaseEnv } from "../reader.ts";
import {
	clearable,
	type Fitted,
	fit,
	fitting,
	isChangeId,
	isStoredText,
	isUuid,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";

const existingProperty = { property_id: isUuid };
const newProperty = { address: isStoredText, name: clearable(isStoredText) };
type Stop = Fitted<typeof existingProperty> | Fitted<typeof newProperty>;
const isExistingProperty = fitting(existingProperty);
const isNewProperty = fitting(newProperty);
const changed_at = sql<string>`now()`;

const planFields = {
	idempotency_key: isUuid,
	planned_on: (value: unknown): value is string =>
		isCalendarDate(value) && !value.startsWith("0000-"),
	notes: clearable(isStoredText),
	stops: (value: unknown): value is Stop[] =>
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((stop) => isExistingProperty(stop) || isNewProperty(stop)),
};
const required = ["idempotency_key", "planned_on", "stops"] as const;
const isRevision = (value: unknown): value is number =>
	isChangeId(value) && value > 0;

function parsePlan(body: JsonObject, deal_id: string, tour_id?: string) {
	if (!isUuid(deal_id) || (tour_id !== undefined && !isUuid(tour_id)))
		return new Refusal(404, "not_found");
	if (tour_id === undefined) {
		const plan = fit(body, planFields, required);
		return plan instanceof Refusal ? plan : { ...plan, deal_id };
	}
	const plan = fit(body, { ...planFields, revision: isRevision }, [
		...required,
		"revision",
	]);
	return plan instanceof Refusal ? plan : { ...plan, deal_id, tour_id };
}

type PlanSave = Exclude<ReturnType<typeof parsePlan>, Refusal>;
type Db = Transaction<DB>;

const findDeal = (db: Db, id: string) =>
	db.selectFrom("deal").select("id").where("id", "=", id).executeTakeFirst();

const planOnDeal = (db: Db, deal: string, tour: string) =>
	db.selectFrom("tour_plan").where("deal_id", "=", deal).where("id", "=", tour);

async function listPlans(db: Db, deal: string) {
	if (!(await findDeal(db, deal))) return new Refusal(404, "not_found");
	const tours = await db
		.selectFrom("tour_plan")
		.select(["id", "planned_on"])
		.where("deal_id", "=", deal)
		.where("completed_activity_id", "is", null)
		.where("cancelled_at", "is", null)
		.orderBy("planned_on")
		.orderBy("id")
		.execute();
	return { tours };
}

async function readPlan(db: Db, deal: string, tour: string) {
	const plan = await planOnDeal(db, deal, tour)
		.select([
			"id",
			"deal_id",
			"planned_on",
			"notes",
			"revision",
			"completed_activity_id",
			"cancelled_at",
		])
		.executeTakeFirst();
	if (!plan) return new Refusal(404, "not_found");
	const stops = await db
		.selectFrom("tour_stop")
		.innerJoin("property", "property.id", "tour_stop.property_id")
		.select(["property_id", "position", "address", "name"])
		.where("tour_plan_id", "=", tour)
		.orderBy("position")
		.execute();
	return { ...plan, stops };
}

async function savePlan(db: Db, request: PlanSave) {
	const { deal_id, planned_on, notes, stops } = request;
	const fields = { planned_on, notes: notes ?? null };
	let id: string;
	if ("tour_id" in request) {
		id = request.tour_id;
		const current = await planOnDeal(db, deal_id, id)
			.select(["revision", "completed_activity_id", "cancelled_at"])
			.forUpdate()
			.executeTakeFirst();
		if (!current) throw new SaveRefusal(new Refusal(404, "not_found"));
		const finalized =
			current.completed_activity_id !== null || current.cancelled_at !== null;
		if (finalized || current.revision !== request.revision)
			throw new SaveRefusal(
				new Refusal(409, "version_conflict", {
					current_revision: current.revision,
					hint: finalized
						? "This tour has already ended."
						: "Reload the tour before editing it.",
				}),
			);
		await db
			.updateTable("tour_plan")
			.set(fields)
			.where("id", "=", id)
			.execute();
		await db.deleteFrom("tour_stop").where("tour_plan_id", "=", id).execute();
	} else {
		if (!(await findDeal(db, deal_id)))
			throw new SaveRefusal(new Refusal(404, "not_found"));
		({ id } = await db
			.insertInto("tour_plan")
			.values({ deal_id, ...fields, changed_at })
			.returning("id")
			.executeTakeFirstOrThrow());
	}

	const orderedStops = [];
	for (const [index, stop] of stops.entries()) {
		const property =
			"property_id" in stop
				? { id: stop.property_id }
				: await db
						.insertInto("property")
						.values({
							address: stop.address.trim(),
							name: stop.name?.trim() ?? null,
							changed_at,
						})
						.returning("id")
						.executeTakeFirstOrThrow();
		orderedStops.push({
			tour_plan_id: id,
			property_id: property.id,
			position: index + 1,
			changed_at,
		});
	}
	await db.insertInto("tour_stop").values(orderedStops).execute();
	return planOnDeal(db, deal_id, id)
		.select(["id", "revision"])
		.executeTakeFirstOrThrow();
}

const toursPath = "/deals/:deal/tours";
const tourPath = `${toursPath}/:tour` as const;

export const dealTours = new Hono<DatabaseEnv & NextSaveEnv>()
	.get(toursPath, async (c): Promise<Response> => {
		const deal = c.req.param("deal");
		if (!isUuid(deal)) return refuse(c, new Refusal(404, "not_found"));
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		return refused
			? refuse(c, refused)
			: answerNextRead(c, "list-deal-tours", (db) => listPlans(db, deal));
	})
	.get(tourPath, async (c): Promise<Response> => {
		const { deal, tour } = c.req.param();
		if (!isUuid(deal) || !isUuid(tour))
			return refuse(c, new Refusal(404, "not_found"));
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		return refused
			? refuse(c, refused)
			: answerNextRead(c, "read-deal-tour", (db) => readPlan(db, deal, tour));
	})
	.post(toursPath, (c) =>
		answerNextSave(
			c,
			"create-tour-plan",
			(body) => parsePlan(body, c.req.param("deal")),
			savePlan,
			201,
		),
	)
	.post(tourPath, (c) =>
		answerNextSave(
			c,
			"edit-tour-plan",
			(body) => parsePlan(body, c.req.param("deal"), c.req.param("tour")),
			savePlan,
		),
	);
