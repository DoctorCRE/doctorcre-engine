import { Hono } from "hono";
import { sql, type Transaction } from "kysely";
import { recordActivity } from "./activity/next-record.ts";
import { Refusal, refuse } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import { addDeal } from "./deals/next-change.ts";
import { savePlan } from "./deals/tours.ts";
import { failureKind } from "./failure.ts";
import { stepItemId } from "./home-steps.ts";
import { nextTransaction } from "./next-connection.ts";
import type { DB } from "./next-database.d.ts";
import type { NextSaveEnv } from "./next-door.ts";
import { ACTING_USER, stampNextSave } from "./next-save.ts";
import { fit, isUuid } from "./request-shape.ts";
import { SaveRefusal } from "./save.ts";
import { isArguments } from "./save-door.ts";

export type SignInFixtureEnv = NextSaveEnv & {
	Bindings: { ENGINE_ENVIRONMENT?: string };
};

const job = "sign-in-rehearsal";
const changed_at = sql<string>`now()`;

const parseRun = (body: JsonObject) =>
	fit(body, { run_id: isUuid }, ["run_id"]);

export async function insertSignInFixture(
	tx: Transaction<DB>,
	run_id: string,
	owner: string,
) {
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
	const { deal_id, phase_changed_at } = await addDeal(tx, {
		client_id,
		owner,
		name: deal_name,
		phase: "research",
		idempotency_key: run_id,
	});
	const {
		rows: [step],
	} = await sql<{ id: string }>`
		insert into next_step (deal_id, created_at, owner_party_id, due_on, what)
		values (${deal_id}::uuid, now(), ${ACTING_USER},
			(now() at time zone 'America/Chicago')::date - 1, 'Send the sample floor plan.')
		returning id
	`.execute(tx);
	if (!step) throw new Error("rehearsal next step insert returned no row");

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
		next_step_id: step.id,
		home_item_id: stepItemId({ id: step.id, call_id: null }),
		tour_id,
		property_id,
	};
}

async function fixtureState(
	tx: Transaction<DB>,
	run: string,
	action: "prepare" | "record" | "cleanup",
	answer: JsonObject | null = null,
) {
	const { rows } = await sql<{ state: JsonObject | null }>`
		select sign_in_fixture(${run}::uuid, ${action}, ${JSON.stringify(answer)}::jsonb) as state
	`.execute(tx);
	return rows[0]?.state ?? null;
}

export const signInFixtures = new Hono<SignInFixtureEnv>().post(
	`/${job}/:action`,
	async (c) => {
		if (c.env.ENGINE_ENVIRONMENT !== "staging") return c.notFound();
		const stamp = c.get("stamp");
		if (stamp.job !== job) return refuse(c, new Refusal(403, "unknown_job"));
		const action = c.req.param("action");
		if (action !== "prepare" && action !== "cleanup") return c.notFound();
		const owner = "for_user" in stamp ? stamp.for_user : undefined;
		if (action === "prepare" && !owner)
			return refuse(c, new Refusal(403, "AUTHORIZATION_REFUSED"));
		const body: unknown = await c.req.json().catch(() => undefined);
		if (!isArguments(body)) return refuse(c, new Refusal(400, "invalid_json"));
		const run = parseRun(body);
		if (run instanceof Refusal) return refuse(c, run);
		const { DATABASE_WRITER: writer } = c.env;
		if (!writer) return refuse(c, new Refusal(503, "database_unavailable"));
		const run_id = run.run_id.toLowerCase();
		try {
			const result = await nextTransaction(
				writer.connectionString,
				"save",
				async (tx) => {
					await stampNextSave(tx, action === "prepare" ? stamp : { job });
					const prior = await fixtureState(tx, run_id, action);
					if (prior?.conflict)
						throw new SaveRefusal(new Refusal(409, "key_reuse"));
					if (action === "cleanup") return { run_id, remaining: 0 };
					if (prior) return prior;
					if (!owner) throw new Error("sign-in rehearsal owner required");
					const answer = await insertSignInFixture(tx, run_id, owner);
					const recorded = await fixtureState(tx, run_id, "record", answer);
					if (recorded?.conflict)
						throw new SaveRefusal(new Refusal(409, "key_reuse"));
					return answer;
				},
			);
			return c.json(result, action === "prepare" ? 201 : 200);
		} catch (error) {
			if (error instanceof SaveRefusal) return refuse(c, error.refusal);
			const correlation = crypto.randomUUID();
			console.warn(
				"sign-in rehearsal failed:",
				correlation,
				failureKind(error),
			);
			return refuse(c, new Refusal(503, "database_unavailable"), correlation);
		}
	},
);
