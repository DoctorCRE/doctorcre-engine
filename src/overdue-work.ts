import { sql } from "kysely";
import type { Saving } from "./save.ts";

const PROMPT =
	"Doc needs the new next step and date for this deal. Use set-next-step to record both.";

export const planStatus = (step?: string | null, date?: string | null) =>
	!step || !date
		? { next_step_required: true, prompt: PROMPT }
		: { next_step_required: false };

export const notKept = (kept: readonly (string | null)[]) =>
	sql<boolean>`not (id = any(${kept}::uuid[]))`;

// The old writer's cleanup when a deal moves on: the partner's overdue next
// steps and post-call actions are dropped, never checklist items or another
// partner's, and a dropped current step hands the deal to the next open one.
// Kept actions await an overdue assessment and are never dropped here.
// Its partner-authority check always passes for a signed-in partner, so it is
// not repeated. The caller holds the next_date and next_step locks.
export async function dropOverdueWork(
	{ tx, actor_id, partner, record }: Saving,
	deal_id: string,
	kept: readonly (string | null)[] = [],
) {
	const unkept = notKept(kept);
	const current = await tx
		.selectFrom("deal as d")
		.leftJoin("v_deal_room_board as b", "b.id", "d.id")
		.leftJoin("v_deal_current_action as n", (join) =>
			join.onRef("n.deal_id", "=", "d.id").on("n.status", "=", "open"),
		)
		.select(["b.next_date", "d.owner", "n.id as action_id", "b.next_step"])
		.select(sql<boolean | null>`b.next_date < current_date`.as("overdue"))
		.where("d.id", "=", deal_id)
		.executeTakeFirstOrThrow();
	const dropped = await tx
		.updateTable("next_action")
		.set({ status: "dropped", updated_by: actor_id })
		.where("subject_type", "=", "deal")
		.where("subject_id", "=", deal_id)
		.where("owner_id", "=", actor_id)
		.where("status", "=", "open")
		.where("item_title", "is", null)
		.where(unkept)
		.where(
			sql<boolean>`((id=${current.action_id} and ${current.overdue}::boolean) or (id is distinct from ${current.action_id} and due_on < current_date))`,
		)
		.returning(["id", "description", "due_on"])
		.execute();
	const postCall = await tx
		.updateTable("capture_post_call_action")
		.set({
			status: "dropped",
			updated_at: sql<string>`clock_timestamp()`,
			completed_at: null,
		})
		.where("deal_id", "=", deal_id)
		.where("owner_id", "=", actor_id)
		.where("status", "=", "open")
		.where("item_title", "is", null)
		.where("due_on", "<", sql<string>`current_date`)
		.where(unkept)
		.returning(["id", "description", "due_on"])
		.execute();
	const superseded_action_ids = [...dropped, ...postCall].map((a) => a.id);
	const superseded_post_call_action_ids = postCall.map((a) => a.id);
	const event = {
		subject_type: "deal",
		subject_id: deal_id,
		after_lock: true as const,
	};
	if (superseded_action_ids.length)
		await record({
			...event,
			field: "next_action",
			old: { actions: [...dropped, ...postCall] },
			new: { superseded_action_ids, status: "dropped" },
		});
	const replacesCurrent =
		dropped.some((a) => a.id === current.action_id) ||
		(!current.action_id && current.overdue && current.owner === partner);
	if (!replacesCurrent)
		return {
			...planStatus(current.next_step, current.next_date),
			...(superseded_action_ids.length > 0 && {
				superseded_action_ids,
				superseded_post_call_action_ids,
			}),
		};
	const next = await tx
		.selectFrom("v_deal_current_action as c")
		.innerJoin("next_action as n", "n.id", "c.id")
		.select(["n.description", "n.due_on"])
		.where("c.deal_id", "=", deal_id)
		.where("c.status", "=", "open")
		.executeTakeFirst();
	const next_date = next?.due_on ?? null;
	await tx
		.updateTable("deal")
		.set({ next_date, updated_by: actor_id })
		.where("id", "=", deal_id)
		.execute();
	for (const [field, before, after] of [
		["next_date", current.next_date, next_date],
		["next_step", current.next_step, next?.description ?? null],
	] as const)
		await record({
			...event,
			field,
			old: { [field]: before },
			new: { [field]: after, superseded_action_ids },
		});
	return {
		superseded_action_ids,
		superseded_post_call_action_ids,
		...planStatus(next?.description, next_date),
	};
}
