import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { Transaction } from "kysely";
import pg from "pg";
import { Refusal, refuse } from "./answer.ts";
import type { JsonObject } from "./database.d.ts";
import { failureKind, sqlState } from "./failure.ts";
import type { DB } from "./next-database.d.ts";
import { runNextSave, type Stamp } from "./next-save.ts";
import { SaveRefusal, type WriterEnv } from "./save.ts";
import { isArguments } from "./save-door.ts";

export type NextSaveEnv = WriterEnv & { Variables: { stamp: Stamp } };

export const userStamp = createMiddleware<
	NextSaveEnv & { Variables: { partner: { slug: string } } }
>(async (c, next) => {
	c.set("stamp", { user: c.get("partner").slug });
	await next();
});

// Behind the Studio's Access token, a job names itself and the partner it works for.
export const jobStamp = createMiddleware<NextSaveEnv>(async (c, next) => {
	const job = c.req.header("Engine-Job")?.trim();
	if (!job) return refuse(c, new Refusal(403, "unknown_job"));
	const for_user = c.req.header("Engine-For-User")?.trim();
	c.set("stamp", for_user ? { job, for_user } : { job });
	await next();
});

// A save whose arguments parse into its request, which is also what its receipt hashes.
export async function answerNextSave<Request extends JsonObject>(
	c: Context<NextSaveEnv>,
	verb: string,
	parse: (body: JsonObject) => Refusal | Request,
	change: (tx: Transaction<DB>, request: Request) => Promise<JsonObject>,
): Promise<Response> {
	const correlation_id = crypto.randomUUID();
	const refused = (refusal: Refusal) => refuse(c, refusal, correlation_id);
	const body: unknown = await c.req.json().catch(() => undefined);
	if (!isArguments(body)) return refused(new Refusal(400, "invalid_json"));
	const request = parse(body);
	if (request instanceof Refusal) return refused(request);
	const writer = c.env.DATABASE_WRITER;
	if (!writer) return refused(new Refusal(503, "database_unavailable"));
	try {
		const save = { stamp: c.get("stamp"), verb, args: request };
		return c.json(
			await runNextSave(writer.connectionString, save, (tx) =>
				change(tx, request),
			),
		);
	} catch (error) {
		if (error instanceof SaveRefusal) return refused(error.refusal);
		console.warn("save failed:", correlation_id, failureKind(error));
		if (error instanceof pg.DatabaseError && sqlState(error)?.startsWith("23"))
			return refused(
				new Refusal(422, "database_refused_the_statement", {
					rule: error.constraint ?? null,
				}),
			);
		return refused(new Refusal(503, "database_unavailable"));
	}
}
