import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { recordActivity } from "./activity/next-record.ts";
import { Refusal, refuse } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import { addDeal, changeDeal } from "./deals/next-change.ts";
import { savePlan } from "./deals/tours.ts";
import { failureKind } from "./failure.ts";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import { answerNextSave, type NextSaveEnv } from "./next-door.ts";
import { stampNextSave } from "./next-save.ts";
import { fit, isUuid } from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";
import { isArguments } from "./save-door.ts";

export type SignInFixtureEnv = NextSaveEnv & {
	Bindings: { ENGINE_ENVIRONMENT?: string };
};

const job = "sign-in-rehearsal";
const path = `/${job}` as const;
const changed_at = sql<string>`now()`;

const parseRun = (body: JsonObject) =>
	fit(body, { run_id: isUuid }, ["run_id"]);

async function prepare(tx: Transaction<DB>, run_id: string, owner: string) {
	const name = `Sign-in rehearsal ${run_id}`;
	const { id: client_id } = await tx
		.insertInto("party")
		.values({ name, kind: "company", how_found: "inbound", changed_at })
		.returning("id")
		.executeTakeFirstOrThrow();
	await tx
		.insertInto("party_role")
		.values({ party_id: client_id, role: "client", changed_at })
		.execute();
	await tx
		.insertInto("client")
		.values({ party_id: client_id, changed_at })
		.execute();

	const deal_name = `${name} deal`;
	const { deal_id, change_id, phase_changed_at } = await addDeal(tx, {
		client_id,
		owner,
		name: deal_name,
		phase: "research",
		idempotency_key: run_id,
	});
	await changeDeal(tx, deal_id, change_id, { needs_attention: true });

	const now = Date.now();
	const notes = [
		"Requested a sample floor plan.",
		"Reviewed the sample floor plan.",
	];
	const note_ids = [];
	for (const [index, summary] of notes.entries()) {
		const { activity_id } = await recordActivity(tx, {
			idempotency_key: run_id,
			kind: "note",
			happened_at: new Date(
				now - (notes.length - index) * 60_000,
			).toISOString(),
			about: [{ deal_id }],
			summary,
			from_party_id: null,
			reached: null,
			email: null,
		});
		note_ids.push(activity_id);
	}
	const { id: property_id } = await tx
		.insertInto("property")
		.values({ name, address: "1 Example Way", changed_at })
		.returning("id")
		.executeTakeFirstOrThrow();
	const { id: tour_id } = await savePlan(tx, {
		idempotency_key: run_id,
		deal_id,
		planned_on: new Date(now + 86_400_000).toISOString().slice(0, 10),
		stops: [{ property_id }],
	});
	return {
		run_id,
		client_id,
		deal_id,
		deal_name,
		phase_changed_at,
		note_ids,
		notes,
		home_item_id: `deal:${deal_id}`,
		tour_id,
		property_id,
	};
}

export const signInFixtures = new Hono<SignInFixtureEnv>()
	.use(`${path}/*`, async (c, next) => {
		if (c.env.ENGINE_ENVIRONMENT !== "staging") return c.notFound();
		if (c.get("stamp").job !== job)
			return refuse(c, new Refusal(403, "unknown_job"));
		return next();
	})
	.post(`${path}/prepare`, async (c) => {
		const stamp = c.get("stamp");
		const owner = "for_user" in stamp ? stamp.for_user : undefined;
		if (!owner) return refuse(c, new Refusal(403, "AUTHORIZATION_REFUSED"));
		return answerNextSave(
			c,
			"prepare-sign-in-rehearsal",
			(body) => {
				const run = parseRun(body);
				return run instanceof Refusal
					? run
					: { idempotency_key: run.run_id.toLowerCase() };
			},
			(tx, request) => prepare(tx, request.idempotency_key, owner),
			201,
		);
	})
	.post(`${path}/cleanup`, async (c) => {
		const body: unknown = await c.req.json().catch(() => undefined);
		if (!isArguments(body)) return refuse(c, new Refusal(400, "invalid_json"));
		const run = parseRun(body);
		if (run instanceof Refusal) return refuse(c, run);
		const { DATABASE_WRITER: writer } = c.env;
		if (!writer) return refuse(c, new Refusal(503, "database_unavailable"));
		const run_id = run.run_id.toLowerCase();
		try {
			await nextTransaction(writer.connectionString, "save", async (tx) => {
				await stampNextSave(tx, { job });
				await sql`select clear_sign_in_fixture(${run_id}::uuid)`.execute(tx);
			});
			return c.json({ run_id, remaining: 0 });
		} catch (error) {
			if (error instanceof SaveRefusal) return refuse(c, error.refusal);
			const correlation = crypto.randomUUID();
			console.warn(
				"sign-in rehearsal cleanup failed:",
				correlation,
				failureKind(error),
			);
			return refuse(c, new Refusal(503, "database_unavailable"), correlation);
		}
	});
