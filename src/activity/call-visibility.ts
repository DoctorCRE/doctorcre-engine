import { type Expression, sql } from "kysely";

export const visibleCall = (
	userId: string | Expression<string> | null,
	activity = "a",
) => sql<boolean>`call_visible_to(${sql.ref(activity)}, ${userId}::uuid)`;

export const sharedCopiedCall = visibleCall(null);

export const visibleCallStep = sql<boolean>`call_step_visible_to(s.call_activity_id, s.owner_party_id)`;

export const visiblePhaseReason = (alias: string) =>
	sql<
		string | null
	>`visible_phase_reason(${sql.ref(`${alias}.deal_id`)}, ${sql.ref(`${alias}.happened_at`)})`;
