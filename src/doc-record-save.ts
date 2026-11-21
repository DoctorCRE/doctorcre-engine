import { sql, type Transaction } from "kysely";
import { z } from "zod";
import { recordActivity } from "./activity/next-record.ts";
import { Refusal } from "./answer.ts";
import { isCalendarDate } from "./calendar-date.ts";
import type { DB } from "./next-database.d.ts";
import { createStep } from "./next-steps.ts";
import { SaveRefusal } from "./save.ts";
import { searchableLead } from "./search/records.ts";
import { isUuid } from "./uuid.ts";

export const docText = z
	.string()
	.trim()
	.min(1)
	.max(4000)
	.refine((value) => value.isWellFormed() && !value.includes("\0"));
export const docDueOn = z
	.string()
	.nullable()
	.refine(
		(date) =>
			date === null || (isCalendarDate(date) && !date.startsWith("0000")),
	);

const target = z.object({
	ref: z.object({
		kind: z.enum(["deal", "lead", "client"]),
		id: z.string().refine(isUuid),
	}),
	href: z.string(),
});
const noteEdits = z.strictObject({ text: docText.optional() });
const stepEdits = z.strictObject({
	what: docText.optional(),
	due_on: docDueOn.optional(),
});
export const docRecordEdits = z.union([noteEdits, stepEdits]);
const recordAnswer = z.object({
	proposal: z.discriminatedUnion("kind", [
		z.object({ kind: z.literal("note"), target, text: docText }),
		z.object({
			kind: z.literal("next_step"),
			target,
			what: docText,
			due_on: docDueOn,
		}),
	]),
});

export function readDocEdits<T>(schema: z.ZodType<T>, value: unknown): T {
	const parsed = schema.safeParse(value);
	if (parsed.success) return parsed.data;
	throw new SaveRefusal(
		new Refusal(400, "invalid_field_value", { fields: ["edits"] }),
	);
}

async function lockTarget(
	tx: Transaction<DB>,
	{ kind, id }: z.infer<typeof target>["ref"],
) {
	if (kind !== "deal") {
		// Match merge_party's order. New deal links need key-share on a lead's party.
		const lock = kind === "lead" ? sql`for update` : sql`for key share`;
		await sql`select id from party where id = ${id} ${lock}`.execute(tx);
	}
	const query = {
		deal: sql`select id from deal where id = ${id} for key share`,
		lead: sql`select r.party_id from party_role r
			where r.party_id = ${id} and ${searchableLead} for share of r`,
		client: sql`select party_id from client where party_id = ${id} for key share`,
	};
	const { rows } = await query[kind].execute(tx);
	if (!rows.length) throw new SaveRefusal(new Refusal(409, "target_changed"));
	return kind === "deal" ? { deal_id: id } : { party_id: id };
}

export async function saveDocRecord(
	tx: Transaction<DB>,
	answer: unknown,
	edits: unknown,
	idempotency_key: string,
) {
	const proposal = recordAnswer.safeParse(answer).data?.proposal;
	if (!proposal) throw new SaveRefusal(new Refusal(409, "no_proposal"));
	const {
		kind,
		target: { ref, href },
	} = proposal;
	const subject = await lockTarget(tx, ref);
	if (kind === "note") {
		const { text } = readDocEdits(noteEdits, edits);
		const { activity_id } = await recordActivity(tx, {
			idempotency_key,
			kind,
			about: [subject],
			summary: text ?? proposal.text,
			from_party_id: null,
			reached: null,
			email: null,
		});
		return { kind, id: activity_id, href };
	}
	const { what, due_on } = readDocEdits(stepEdits, edits);
	try {
		const { next_step_id } = await createStep(tx, {
			...subject,
			what: what ?? proposal.what,
			due_on: due_on === undefined ? proposal.due_on : due_on,
		});
		return { kind, id: next_step_id, href };
	} catch (error) {
		if (
			error instanceof SaveRefusal &&
			error.refusal.error === "open_step_exists"
		)
			throw new SaveRefusal(
				new Refusal(409, "open_step_exists", { ...error.refusal.extra, href }),
			);
		throw error;
	}
}
