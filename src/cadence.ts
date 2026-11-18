import { Hono } from "hono";
import { type Kysely, sql } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import { Refusal, refuse } from "./answer.ts";
import { failureKind } from "./failure.ts";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import type { NextSaveEnv } from "./next-door.ts";
import { isUuid } from "./request-shape.ts";

const subjectRoles = {
	clients: { role: "client", prefix: "C-%" },
	leads: { role: "lead", prefix: "L-%" },
	vendors: { role: "vendor", prefix: "V-%" },
};

type SubjectCollection = keyof typeof subjectRoles;
const isSubjectCollection = (
	value: string | undefined,
): value is SubjectCollection =>
	value !== undefined && Object.hasOwn(subjectRoles, value);

async function subjects(
	db: Kysely<DB>,
	collection: SubjectCollection,
	after: string | undefined,
	limit: number,
) {
	const { role, prefix } = subjectRoles[collection];
	const query = db
		.selectFrom("party as p")
		.innerJoin("party_role as r", (join) =>
			join.onRef("r.party_id", "=", "p.id").on("r.role", "=", role),
		)
		.select((eb) => [
			"p.id",
			"p.name",
			eb
				.selectFrom("outside_id as o")
				.select("o.value")
				.whereRef("o.party_id", "=", "p.id")
				.where("o.source", "=", "old_system_ref")
				.where("o.value", "like", prefix)
				.orderBy("o.value")
				.limit(1)
				.as("ref"),
			jsonArrayFrom(
				eb
					.selectFrom("outside_id as o")
					.select("o.value")
					.whereRef("o.party_id", "=", "p.id")
					.where("o.source", "=", "old_system")
					.orderBy("o.value"),
			).as("old_ids"),
		])
		.where((eb) => (after ? eb("p.id", ">", after) : eb.val(true)))
		.orderBy("p.id")
		.limit(limit + 1);
	if (collection === "vendors")
		return query
			.leftJoin("app_user as u", "u.id", "r.owner_user_id")
			.select([
				sql<null>`null`.as("client_status"),
				"u.slug as owner",
				"u.id as owner_party_id",
			])
			.execute();
	const owner = collection === "leads" ? "r.owner_user_id" : "c.owner_user_id";
	return query
		.leftJoin("client as c", "c.party_id", "p.id")
		.leftJoin("client_status as cs", "cs.party_id", "p.id")
		.leftJoin("app_user as u", "u.id", owner)
		.$if(collection === "leads", (q) => q.select("r.estimated_lease_on"))
		.select((eb) => [
			eb
				.case()
				.when("c.status", "in", ["cold", "paused"])
				.then(eb.ref("c.status"))
				.else(eb.ref("cs.status"))
				.end()
				.as("client_status"),
			"u.slug as owner",
			"u.id as owner_party_id",
		])
		.execute();
}

export const cadence = new Hono<NextSaveEnv>().get("/cadence", async (c) => {
	const { collection, after, limit: rawLimit = "100", status } = c.req.query();
	const limit = Number(rawLimit);
	if (
		(collection !== "next_steps" && !isSubjectCollection(collection)) ||
		(after !== undefined && !isUuid(after)) ||
		!/^\d+$/.test(rawLimit) ||
		limit < 1 ||
		limit > 500 ||
		(collection === "next_steps"
			? status !== "open" && status !== "done"
			: status !== undefined)
	)
		return refuse(c, new Refusal(400, "invalid_field_value"));
	if (c.get("stamp").job !== "cadence")
		return refuse(c, new Refusal(403, "unknown_job"));
	const reader = c.env.DATABASE;
	if (!reader) return refuse(c, new Refusal(503, "database_unavailable"));
	try {
		return c.json(
			await nextTransaction(reader.connectionString, "read", async (tx) => {
				const job = await tx
					.selectFrom("job")
					.select("slug")
					.where("slug", "=", "cadence")
					.executeTakeFirst();
				if (!job) throw new Refusal(403, "unknown_job");
				const rows =
					collection === "next_steps"
						? await tx
								.selectFrom("next_step")
								.select(["id", "party_id", "owner_party_id"])
								.where("party_id", "is not", null)
								.$narrowType<{ party_id: string }>()
								.$if(status === "done", (q) =>
									q.select(["what as description", "done_at"]),
								)
								.where("status", "=", status ?? "open")
								.where((eb) => (after ? eb("id", ">", after) : eb.val(true)))
								.orderBy("id")
								.limit(limit + 1)
								.execute()
						: await subjects(tx, collection, after, limit);
				const items = rows.slice(0, limit);
				return {
					items,
					next_cursor: rows.length > limit ? items.at(-1)?.id : null,
				};
			}),
		);
	} catch (error) {
		if (error instanceof Refusal) return refuse(c, error);
		console.warn("cadence read failed:", failureKind(error));
		return refuse(c, new Refusal(503, "database_unavailable"));
	}
});
