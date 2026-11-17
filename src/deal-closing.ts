import { Hono } from "hono";
import { sql } from "kysely";
import { Refusal } from "./answer.ts";
import { isCalendarDate } from "./calendar-date.ts";
import type { JsonObject, JsonValue } from "./database.d.ts";
import { lockFields } from "./deal-field-base.ts";
import { lookupRefusal, resolveDeal } from "./deals/resolve.ts";
import { dropOverdueWork } from "./overdue-work.ts";
import {
	answerSave,
	SaveRefusal,
	type Saving,
	type WriterEnv,
} from "./save.ts";
import { isArguments } from "./save-door.ts";

const FIELDS = ["outcome", "closed_on", "won_value", "invoiced_on"] as const;
const isClosingField = (field: string): field is (typeof FIELDS)[number] =>
	FIELDS.some((name) => name === field);

export const dealClosing = new Hono<WriterEnv>();
dealClosing.post("/update-deal", (c) =>
	answerSave(
		c,
		{
			verb: "update-deal",
			fields: {
				idempotency_key: {},
				deal: {},
				base_version: { type: "number" },
				fields: {
					type: "object",
					fields: {
						outcome: {},
						closed_on: {},
						won_value: {},
						invoiced_on: {},
					},
				},
			},
			required: ["idempotency_key", "deal", "base_version", "fields"],
		},
		closeDeal,
	),
);

async function closeDeal(saving: Saving, args: JsonObject) {
	const { tx, actor_id, record } = saving;
	const subject = await resolveDeal(tx, String(args.deal));
	if ("error" in subject) throw new SaveRefusal(lookupRefusal(subject));
	const fields = args.fields;
	if (!isArguments(fields))
		throw new SaveRefusal(new Refusal(400, "unhandled_verb_failure"));
	const keys = Object.keys(fields).filter(isClosingField);
	if (
		!keys.length ||
		(keys.includes("invoiced_on") &&
			fields.invoiced_on !== null &&
			!isCalendarDate(fields.invoiced_on))
	)
		throw new SaveRefusal(new Refusal(400, "unhandled_verb_failure"));
	const deal_id = subject.id;
	if (keys.includes("outcome"))
		await lockFields(tx, deal_id, ["next_date", "next_step"]);
	const rebase = await versionGuard(saving, deal_id, args.base_version, keys);
	const old = await tx
		.selectFrom("deal")
		.select(keys)
		.where("id", "=", deal_id)
		.executeTakeFirstOrThrow();
	// PostgreSQL validates and coerces these values just as the old writer did.
	await tx
		.updateTable("deal")
		.set(Object.fromEntries(keys.map((key) => [key, sql`${fields[key]}`])))
		.set({ updated_by: actor_id })
		.where("id", "=", deal_id)
		.execute();
	for (const field of keys)
		await record({
			subject_type: "deal",
			subject_id: deal_id,
			field,
			old: { [field]: old[field] },
			new: { [field]: fields[field] },
			...(field === "invoiced_on" && { after_lock: true }),
		});
	const status =
		keys.includes("outcome") && old.outcome !== fields.outcome
			? await dropOverdueWork(saving, deal_id)
			: {};
	return { ok: true, updated: keys, ...status, ...rebase };
}

async function versionGuard(
	{ tx }: Saving,
	deal_id: string,
	base: JsonValue | undefined,
	keys: readonly string[],
) {
	const current = await tx
		.selectFrom("deal")
		.select(["version", "created_at"])
		.where("id", "=", deal_id)
		.forUpdate()
		.executeTakeFirstOrThrow();
	if (current.version === Number(base)) return {};
	const events = await tx
		.selectFrom("event as e")
		.innerJoin("actor as a", "a.id", "e.actor_id")
		.select(["a.slug as actor", "e.verb", "e.field"])
		.select(
			sql<string>`to_char(e.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as(
				"recorded_at",
			),
		)
		.where("e.subject_id", "=", deal_id)
		.where("e.recorded_at", ">", current.created_at)
		.orderBy("e.recorded_at", "desc")
		.limit(5)
		.execute();
	if (
		!events.length ||
		events.some((event) => event.field && keys.includes(event.field))
	)
		throw new SaveRefusal(
			new Refusal(409, "version_conflict", {
				current_version: current.version,
			}),
		);
	return {
		rebased: true,
		rebase_receipt: {
			from_base_version: Number(base),
			rebased_to_version: current.version,
			disjoint_intervening_events: events,
			hint: "version advanced from a write to a different field; re-applied against the current row with no human confirmation needed",
		},
	};
}
