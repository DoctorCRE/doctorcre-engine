import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Transaction } from "kysely";
import pg from "pg";
import { Refusal, refuse } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import { failureKind } from "./failure.ts";
import type { DB } from "./next-database.d.ts";
import { runNextSave, type Stamp } from "./next-save.ts";
import { SaveRefusal, type WriterEnv } from "./save.ts";
import { isArguments } from "./save-door.ts";

// Only the jobs entrance sets a stamp; on the app's, the signed-in partner made the save.
export type NextDoorEnv = WriterEnv & { Variables: { stamp?: Stamp } };

export type NextDoor<T> = {
	verb: string;
	parse: (args: JsonObject) => T | Refusal;
	change: (tx: Transaction<DB>, request: T) => Promise<JsonObject>;
	status?: 200 | 201;
};

// Access has vouched for the caller; the job names itself and the partner it works for.
export const jobStamp = createMiddleware<NextDoorEnv>(async (c, next) => {
	const job = c.req.header("Engine-Job");
	if (!job) return refuse(c, new Refusal(403, "unknown_job"));
	const for_user = c.req.header("Engine-For-User");
	c.set("stamp", for_user ? { job, for_user } : { job });
	await next();
});

// A new-section save from either entrance. Path values join the arguments, so a
// reused key with another path is refused as key_reuse.
export async function answerNextSave<T>(
	c: Context<NextDoorEnv>,
	{ verb, parse, change, status = 200 }: NextDoor<T>,
): Promise<Response> {
	const correlation_id = crypto.randomUUID();
	const refused = (refusal: Refusal) => refuse(c, refusal, correlation_id);
	const body: unknown = await c.req.json().catch(() => undefined);
	if (!isArguments(body)) return refused(new Refusal(400, "invalid_json"));
	const args = { ...body, ...c.req.param() };
	const request = parse(args);
	if (request instanceof Refusal) return refused(request);
	const writer = c.env.DATABASE_WRITER;
	if (!writer) return refused(new Refusal(503, "database_unavailable"));
	const stamp = c.get("stamp") ?? { user: c.get("partner").slug };
	try {
		const answer = await runNextSave(
			writer.connectionString,
			{ stamp, verb, args },
			(tx) => change(tx, request),
		);
		return c.json(answer, status);
	} catch (error) {
		if (error instanceof SaveRefusal) return refused(error.refusal);
		console.warn(`${verb} failed:`, correlation_id, failureKind(error));
		if (error instanceof pg.DatabaseError && error.constraint)
			return refused(
				new Refusal(422, "database_refused_the_statement", {
					rule: error.constraint,
				}),
			);
		return refused(new Refusal(503, "database_unavailable"));
	}
}
