import { Hono } from "hono";
import { type Selectable, sql } from "kysely";
import pg from "pg";
import { Refusal, refuse } from "../answer.ts";
import { failureKind } from "../failure.ts";
import { nextTransaction } from "../next-connection.ts";
import type { DB } from "../next-database.d.ts";
import type { NextSaveEnv } from "../next-door.ts";
import { stampNextSave } from "../next-save.ts";
import {
	fit,
	isInstant,
	isStoredText,
	isUuid,
	orNull,
} from "../request-shape.ts";
import { SaveRefusal } from "../save.ts";
import { isArguments } from "../save-door.ts";

const shape = {
	activity_id: isUuid,
	source_hash: (v: unknown): v is string =>
		typeof v === "string" && /^sha256:[a-f0-9]{64}$/u.test(v),
	generator_version: isStoredText,
	status: (v: unknown): v is "available" | "unavailable" =>
		v === "available" || v === "unavailable",
	text: orNull(isStoredText),
	provenance: isArguments,
	recorded_at: isInstant,
};

export const emailSummary = new Hono<NextSaveEnv>().post(
	"/email-summaries",
	async (c) => {
		const correlationId = crypto.randomUUID();
		const refused = (error: Refusal) => refuse(c, error, correlationId);
		const stamp = c.get("stamp");
		if (stamp.job !== "mail_capture" || !stamp.for_user)
			return refused(new Refusal(403, "unknown_job"));
		const body: unknown = await c.req.json().catch(() => undefined);
		if (!isArguments(body)) return refused(new Refusal(400, "invalid_json"));
		const result = fit(body, shape, [
			"activity_id",
			"source_hash",
			"generator_version",
			"status",
			"text",
			"provenance",
			"recorded_at",
		]);
		if (result instanceof Refusal) return refused(result);
		if ((result.status === "available") !== (result.text !== null))
			return refused(
				new Refusal(400, "invalid_field_value", { fields: ["text"] }),
			);
		const writer = c.env.DATABASE_WRITER;
		if (!writer) return refused(new Refusal(503, "database_unavailable"));
		try {
			const saved = await nextTransaction(
				writer.connectionString,
				"save",
				async (tx) => {
					await stampNextSave(tx, stamp);
					const {
						rows: [row],
					} = await sql<{ summary: Selectable<DB["email_summary"]> }>`
					select to_jsonb(s) as summary
					from record_email_summary(
						${result.activity_id}, ${result.source_hash}, ${result.generator_version},
						${result.status}, ${result.text}, ${JSON.stringify(result.provenance)}, ${result.recorded_at}
					) s
					where s.activity_id is not null
				`.execute(tx);
					return row?.summary;
				},
			);
			return saved ? c.json(saved) : refused(new Refusal(404, "not_found"));
		} catch (error) {
			if (error instanceof SaveRefusal) return refused(error.refusal);
			if (error instanceof pg.DatabaseError) {
				if (error.constraint === "email_summary_result_conflict")
					return refused(new Refusal(409, "email_summary_result_conflict"));
				if (error.code === "22P05")
					return refused(
						new Refusal(400, "invalid_field_value", { fields: ["provenance"] }),
					);
				if (error.code?.startsWith("23"))
					return refused(
						new Refusal(422, "database_refused_the_statement", {
							rule: error.constraint ?? null,
						}),
					);
			}
			console.warn("save failed:", correlationId, failureKind(error));
			return refused(new Refusal(503, "database_unavailable"));
		}
	},
);
