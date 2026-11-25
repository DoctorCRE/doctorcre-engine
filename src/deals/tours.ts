import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import { recordActivity } from "../activity/next-record.ts";
import {
	answerNextRead,
	checkFields,
	isoMillis,
	Refusal,
	refuse,
} from "../answer.ts";
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
	isInstant,
	isStoredText,
	isUuid,
	optional,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";

const existingProperty = { property_id: isUuid };
const newProperty = { address: isStoredText, name: clearable(isStoredText) };
type Stop = Fitted<typeof existingProperty> | Fitted<typeof newProperty>;
const isExistingProperty = fitting(existingProperty);
const isNewProperty = fitting(newProperty);
const changed_at = sql<string>`now()`;
const isStops = (value: unknown): value is Stop[] =>
	Array.isArray(value) &&
	value.length > 0 &&
	value.every((stop) => isExistingProperty(stop) || isNewProperty(stop));

const planFields = {
	idempotency_key: isUuid,
	planned_on: (value: unknown): value is string =>
		isCalendarDate(value) && !value.startsWith("0000-"),
	notes: clearable(isStoredText),
	stops: isStops,
};
const required = ["idempotency_key", "planned_on", "stops"] as const;
const isRevision = (value: unknown): value is number =>
	isChangeId(value) && value > 0;
const revisionFields = { idempotency_key: isUuid, revision: isRevision };
const completionFields = {
	...revisionFields,
	happened_at: (value: unknown): value is string =>
		isInstant(value) && /T(?:[01]\d|2[0-3]):[0-5]\d/.test(value),
	visited_stops: isStops,
	party_ids: optional(
		(value: unknown): value is string[] =>
			Array.isArray(value) && value.every(isUuid),
	),
};

function onTour<T>(params: { deal: string; tour: string }, input: T | Refusal) {
	const { deal, tour } = params;
	if (!isUuid(deal) || !isUuid(tour)) return new Refusal(404, "not_found");
	return input instanceof Refusal
		? input
		: { ...input, deal_id: deal, tour_id: tour };
}

function parsePlan(body: JsonObject, deal_id: string, tour_id?: string) {
	if (!isUuid(deal_id) || (tour_id !== undefined && !isUuid(tour_id)))
		return new Refusal(404, "not_found");
	if (tour_id === undefined) {
		const plan = fit(body, planFields, required);
		return plan instanceof Refusal ? plan : { ...plan, deal_id };
	}
	return onTour(
		{ deal: deal_id, tour: tour_id },
		fit(body, { ...planFields, ...revisionFields }, [...required, "revision"]),
	);
}

type PlanSave = Exclude<ReturnType<typeof parsePlan>, Refusal>;
type Db = Transaction<DB>;

const findDeal = (db: Db, id: string) =>
	db.selectFrom("deal").select("id").where("id", "=", id).executeTakeFirst();

const planOnDeal = (db: Db, deal: string, tour: string) =>
	db.selectFrom("tour_plan").where("deal_id", "=", deal).where("id", "=", tour);

async function lockPlan(db: Db, { deal_id, tour_id }: TourRevision) {
	const plan = await planOnDeal(db, deal_id, tour_id)
		.select(["id", "revision", "completed_activity_id", "cancelled_at"])
		.forUpdate()
		.executeTakeFirst();
	if (!plan) throw new SaveRefusal(new Refusal(404, "not_found"));
	return plan;
}

function requireOpenRevision(
	plan: Awaited<ReturnType<typeof lockPlan>>,
	revision: number,
) {
	const finalized =
		plan.completed_activity_id !== null || plan.cancelled_at !== null;
	if (finalized || plan.revision !== revision)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", {
				current_revision: plan.revision,
				hint: finalized
					? "This tour has already ended."
					: "Reload the tour before saving it.",
			}),
		);
}

async function listPlans(db: Db, deal: string) {
	if (!(await findDeal(db, deal))) return new Refusal(404, "not_found");
	const plans = db.selectFrom("tour_plan").where("deal_id", "=", deal);
	const tours = await plans
		.select(["id", "planned_on"])
		.where("completed_activity_id", "is", null)
		.where("cancelled_at", "is", null)
		.orderBy("planned_on")
		.orderBy("id")
		.execute();
	const past_tours = await plans
		.innerJoin("activity", "activity.id", "completed_activity_id")
		.select((eb) => [
			"tour_plan.id",
			"activity.id as activity_id",
			isoMillis(eb.ref("activity.happened_at")).as("happened_at"),
			jsonArrayFrom(
				eb
					.selectFrom("activity_about")
					.innerJoin("property", "property.id", "property_id")
					.select(["property_id", "address", "name"])
					.whereRef("activity_id", "=", "activity.id")
					.orderBy("address")
					.orderBy("property_id"),
			).as("properties"),
		])
		.orderBy("activity.happened_at", "desc")
		.orderBy("tour_plan.id", "desc")
		.execute();
	return { tours, past_tours };
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

export async function savePlan(db: Db, request: PlanSave) {
	const { deal_id, planned_on, notes, stops } = request;
	const fields = { planned_on, notes: notes ?? null };
	let id: string;
	if ("tour_id" in request) {
		id = request.tour_id;
		requireOpenRevision(await lockPlan(db, request), request.revision);
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
		orderedStops.push({
			tour_plan_id: id,
			property_id: await propertyForStop(db, stop),
			position: index + 1,
			changed_at,
		});
	}
	await db.insertInto("tour_stop").values(orderedStops).execute();
	return planOnDeal(db, deal_id, id)
		.select(["id", "revision"])
		.executeTakeFirstOrThrow();
}

const newPropertyDetails = ({ address, name }: Fitted<typeof newProperty>) => ({
	address: address.trim(),
	name: name?.trim() ?? null,
});

async function propertyForStop(db: Db, stop: Stop) {
	if ("property_id" in stop) return stop.property_id.toLowerCase();
	const { id } = await db
		.insertInto("property")
		.values({ ...newPropertyDetails(stop), changed_at })
		.returning("id")
		.executeTakeFirstOrThrow();
	return id;
}

type TourRevision = Fitted<typeof revisionFields> & {
	deal_id: string;
	tour_id: string;
};

async function completePlan(
	db: Db,
	request: TourRevision & Fitted<typeof completionFields>,
) {
	const {
		deal_id,
		tour_id,
		happened_at,
		visited_stops,
		party_ids = [],
	} = request;
	const plan = await lockPlan(db, request);
	if (plan.completed_activity_id)
		return { id: plan.id, activity_id: plan.completed_activity_id };
	requireOpenRevision(plan, request.revision);

	const visited = new Set<string>();
	const newProperties = new Set<string>();
	for (const stop of visited_stops) {
		if (!("property_id" in stop)) {
			const details = JSON.stringify(newPropertyDetails(stop));
			if (newProperties.has(details)) continue;
			newProperties.add(details);
		}
		visited.add(await propertyForStop(db, stop));
	}
	const client = await db
		.selectFrom("deal_party")
		.select("party_id")
		.where("deal_id", "=", deal_id)
		.where("role", "=", "client")
		.executeTakeFirst();
	const parties = new Set(party_ids.map((id) => id.toLowerCase()));
	if (client) parties.add(client.party_id);
	const { activity_id } = await recordActivity(db, {
		idempotency_key: request.idempotency_key,
		kind: "meeting",
		happened_at,
		summary: "Property tour",
		from_party_id: null,
		reached: null,
		email: null,
		about: [
			{ deal_id },
			...[...visited].map((property_id) => ({ property_id })),
			...[...parties].map((party_id) => ({ party_id })),
		],
	});
	await db
		.updateTable("tour_plan")
		.set({ completed_activity_id: activity_id })
		.where("id", "=", tour_id)
		.execute();
	return { id: plan.id, activity_id };
}

async function cancelPlan(db: Db, request: TourRevision) {
	requireOpenRevision(await lockPlan(db, request), request.revision);
	return db
		.updateTable("tour_plan")
		.set({ cancelled_at: changed_at })
		.where("id", "=", request.tour_id)
		.returning(["id", "revision", "cancelled_at"])
		.executeTakeFirstOrThrow();
}

const stopListDate = new Intl.DateTimeFormat("en-US", {
	dateStyle: "long",
	timeZone: "UTC",
});

async function copyStops(db: Db, deal: string, tour: string) {
	const plan = await readPlan(db, deal, tour);
	if (plan instanceof Refusal) return plan;
	const date = stopListDate.format(new Date(plan.planned_on));
	const stops = plan.stops.map(
		({ position, name, address }) =>
			`${position}. ${name ? `${name}, ` : ""}${address}`,
	);
	return { text: [date, "", ...stops].join("\n") };
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
	.get(`${tourPath}/stop-list`, async (c): Promise<Response> => {
		const { deal, tour } = c.req.param();
		if (!isUuid(deal) || !isUuid(tour))
			return refuse(c, new Refusal(404, "not_found"));
		const refused = checkFields(new URL(c.req.url).searchParams, []);
		return refused
			? refuse(c, refused)
			: answerNextRead(c, "read-tour-stop-list", (db) =>
					copyStops(db, deal, tour),
				);
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
	)
	.post(`${tourPath}/complete`, (c) =>
		answerNextSave(
			c,
			"complete-tour-plan",
			(body) =>
				onTour(
					c.req.param(),
					fit(body, completionFields, [
						"idempotency_key",
						"revision",
						"happened_at",
						"visited_stops",
					]),
				),
			completePlan,
		),
	)
	.post(`${tourPath}/cancel`, (c) =>
		answerNextSave(
			c,
			"cancel-tour-plan",
			(body) =>
				onTour(
					c.req.param(),
					fit(body, revisionFields, ["idempotency_key", "revision"]),
				),
			cancelPlan,
		),
	);
