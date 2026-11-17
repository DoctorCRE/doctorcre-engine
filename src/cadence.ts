import { Hono } from "hono";
import { type Kysely, sql } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import { Refusal, refuse } from "./answer.ts";
import { failureKind } from "./failure.ts";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import type { NextSaveEnv } from "./next-door.ts";
import { isUuid } from "./request-shape.ts";

const collections = [
	"deals",
	"clients",
	"leads",
	"vendors",
	"next_steps",
] as const;
type Collection = (typeof collections)[number];
const isCollection = (value: unknown): value is Collection =>
	collections.some((collection) => collection === value);

async function subjects(
	db: Kysely<DB>,
	collection: Exclude<Collection, "next_steps">,
	after: string | undefined,
	limit: number,
) {
	if (collection === "deals")
		return db
			.selectFrom("deal as d")
			.leftJoin("deal_party as c", (join) =>
				join.onRef("c.deal_id", "=", "d.id").on("c.role", "=", "client"),
			)
			.leftJoin("client_status as cs", "cs.party_id", "c.party_id")
			.innerJoin("app_user as u", "u.id", "d.owner_user_id")
			.select([
				"d.id",
				"d.name",
				sql<null>`null`.as("ref"),
				"cs.status as client_status",
				"u.slug as owner",
				"u.id as owner_party_id",
			])
			.where((eb) => (after ? eb("d.id", ">", after) : eb.val(true)))
			.orderBy("d.id")
			.limit(limit + 1)
			.execute();
	const role =
		collection === "clients"
			? "client"
			: collection === "leads"
				? "lead"
				: "vendor";
	const prefix = { client: "C-%", lead: "L-%", vendor: "V-%" }[role];
	let query = db
		.selectFrom("party as p")
		.innerJoin("party_role as r", (join) =>
			join.onRef("r.party_id", "=", "p.id").on("r.role", "=", role),
		)
		.leftJoin("client as c", "c.party_id", "p.id")
		.leftJoin("client_status as cs", "cs.party_id", "p.id")
		.leftJoin("app_user as u", (join) =>
			join.onRef(
				"u.id",
				"=",
				collection === "clients" ? "c.owner_user_id" : "r.owner_user_id",
			),
		)
		.select((eb) => [
			"p.id",
			"p.name",
			eb
				.selectFrom("outside_id as o")
				.select("o.value")
				.whereRef("o.party_id", "=", "p.id")
				.where("o.source", "=", "old_system_ref")
				.orderBy(sql`o.value like ${prefix}`, "desc")
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
			sql<
				string | null
			>`case when ${collection} = 'vendors' then null else ${eb.ref("cs.status")} end`.as(
				"client_status",
			),
			"u.slug as owner",
			"u.id as owner_party_id",
		]);
	if (collection === "leads") query = query.select("r.estimated_lease_on");
	return query
		.where((eb) => (after ? eb("p.id", ">", after) : eb.val(true)))
		.orderBy("p.id")
		.limit(limit + 1)
		.execute();
}

export const cadence = new Hono<NextSaveEnv>().get("/cadence", async (c) => {
	const { collection, after, limit = "100", status } = c.req.query();
	if (
		!isCollection(collection) ||
		(after !== undefined && !isUuid(after)) ||
		!/^\d+$/.test(limit) ||
		Number(limit) < 1 ||
		Number(limit) > 500 ||
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
				await sql`select set_config('engine.job', 'cadence', true)`.execute(tx);
				const rows =
					collection === "next_steps"
						? await tx
								.selectFrom("next_step")
								.select([
									"id",
									"deal_id",
									"party_id",
									"property_id",
									"owner_party_id",
								])
								.$if(status === "done", (q) =>
									q.select(["what as description", "done_at"]),
								)
								.where("status", "=", status ?? "open")
								.where((eb) => (after ? eb("id", ">", after) : eb.val(true)))
								.orderBy("id")
								.limit(Number(limit) + 1)
								.execute()
						: await subjects(tx, collection, after, Number(limit));
				const items = rows.slice(0, Number(limit));
				return {
					items,
					next_cursor: rows.length > Number(limit) ? items.at(-1)?.id : null,
				};
			}),
		);
	} catch (error) {
		if (error instanceof Refusal) return refuse(c, error);
		console.warn("cadence read failed:", failureKind(error));
		return refuse(c, new Refusal(503, "database_unavailable"));
	}
});
