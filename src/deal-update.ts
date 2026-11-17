import { Hono } from "hono";
import { sql } from "kysely";
import { isoMillis, Refusal } from "./answer.ts";
import { isCalendarDate } from "./calendar-date.ts";
import type { JsonObject } from "./database.d.ts";
import { lockFields } from "./deal-field-base.ts";
import { lookupRefusal, resolveDeal } from "./deals/resolve.ts";
import { appendNextStep } from "./next-step.ts";
import { planStatus } from "./overdue-work.ts";
import {
	answerSave,
	type Change,
	SaveRefusal,
	type Saving,
	type WriterEnv,
} from "./save.ts";

export const dealUpdate = new Hono<WriterEnv>();

dealUpdate.post("/add-deal-note", (c) =>
	answerSave(
		c,
		{
			verb: "add-deal-note",
			fields: {
				idempotency_key: {},
				deal: {},
				text: {},
				next_step: {},
				next_date: {},
			},
			required: ["idempotency_key", "deal", "text"],
		},
		updateUnlessOverdue,
	),
);

// The old writer checks held overdue work after commit, which the engine does
// not port yet (decision 96), so that update rolls back and goes to the old system.
const updateUnlessOverdue: Change = async (saving, args) => {
	const answer = await addDealUpdate(saving, args);
	if ("overdue_assessment" in answer)
		throw new SaveRefusal(new Refusal(501, "old_system_required"));
	return answer;
};

type OpenWork = {
	id: string;
	source: "next_action" | "post_call_action";
	description: string;
	version: number | null;
	updated_at: string;
	due_on: string | null;
};

// Neither the old text_required nor next_step_and_date_required was a public error.
function refused(): never {
	throw new SaveRefusal(new Refusal(400, "unhandled_verb_failure"));
}

function plannedStep({ next_step, next_date }: JsonObject) {
	if (next_step === undefined && next_date === undefined) return null;
	if (
		typeof next_step !== "string" ||
		!next_step.trim() ||
		!isCalendarDate(next_date)
	)
		refused();
	return { text: next_step.trim(), next_date };
}

// The old add-deal-note before its after-commit assessment: the update is
// appended to the deal's thread and the partner's overdue work waits for it.
export const addDealUpdate: Change = async (saving, args) => {
	const { tx, actor_id, record } = saving;
	const subject = await resolveDeal(tx, String(args.deal));
	if ("error" in subject) throw new SaveRefusal(lookupRefusal(subject));
	const deal_id = subject.id;
	if (typeof args.text !== "string" || !args.text.trim()) refused();
	const step = plannedStep(args);
	const update = args.text.trim();
	await lockFields(tx, deal_id, ["next_date", "next_step"]);
	const note = await tx
		.insertInto("deal_note")
		.values({ deal_id, kind: "note", text: update, actor_id })
		.returning(["id", isoMillis(sql.ref("created_at")).as("created_at")])
		.executeTakeFirstOrThrow();
	const assessment = await holdOverdueWork(saving, deal_id, note.id, update);
	await record({
		subject_type: "deal",
		subject_id: deal_id,
		field: "note",
		new: { note: update },
	});
	const plan =
		step &&
		(await appendNextStep(
			saving,
			deal_id,
			step.text,
			step.next_date,
			assessment.preserved_action_ids,
		));
	return {
		ok: true,
		deal_id,
		note_id: note.id,
		created_at: new Date(note.created_at),
		...assessment,
		...(plan && {
			next_step_id: plan.next_step_id,
			next_action_id: plan.next_action_id,
			next_step_required: false,
		}),
	};
};

// Ordinary steps keep their ids so a next step saved alongside never drops
// them; each overdue item also gets a fallback that stays under review until
// the assessment replaces it.
async function holdOverdueWork(
	{ tx, actor_id, record }: Saving,
	deal_id: string,
	note_id: string,
	update: string,
) {
	const before = await tx
		.selectFrom("v_deal_room_board")
		.select(["next_step", "next_date"])
		.where("id", "=", deal_id)
		.executeTakeFirst();
	const plan = planStatus(before?.next_step, before?.next_date);
	const { rows } = await sql<OpenWork>`
		select n.id, 'next_action' as source, n.description, n.version, n.updated_at::text as updated_at,
			case when n.id=(select id from v_deal_current_action where deal_id=${deal_id} and status='open')
				then d.next_date::text else n.due_on::text end as due_on
		from next_action n join deal d on d.id=n.subject_id
		where n.subject_type='deal' and n.subject_id=${deal_id} and n.owner_id=${actor_id}
			and n.status='open' and n.item_title is null
		union all
		select id, 'post_call_action', description, null, updated_at::text, due_on::text
		from capture_post_call_action
		where deal_id=${deal_id} and owner_id=${actor_id} and status='open' and item_title is null`.execute(
		tx,
	);
	const { today } = await tx
		.selectNoFrom(sql<string>`current_date::text`.as("today"))
		.executeTakeFirstOrThrow();
	const overdue = rows.filter((a) => a.due_on && a.due_on < today);
	if (!overdue.length) return { preserved_action_ids: [], ...plan };
	const event = {
		subject_type: "deal",
		subject_id: deal_id,
		after_lock: true as const,
	};
	await record({
		...event,
		field: "overdue_assessment_pending",
		new: { note_id, update, actions: overdue },
	});
	for (const action of overdue)
		await record({
			...event,
			field: "overdue_assessment_fallback",
			new: {
				action,
				note_id,
				update,
				resolved: false,
				review_required: true,
				verdict: "unavailable",
				reason: "awaiting_assessment",
			},
		});
	return {
		...plan,
		overdue_assessment: {
			pending: true,
			reason: "awaiting_assessment",
			items: [],
		},
		preserved_action_ids: overdue
			.filter((a) => a.source === "next_action")
			.map((a) => a.id),
	};
}
