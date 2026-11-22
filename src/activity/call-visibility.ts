import { type Expression, sql } from "kysely";

export const visibleCall = (
	userId: string | Expression<string> | null,
	activity = "a",
) =>
	sql<boolean>`call_visible_to(${sql.ref(`${activity}.changed_by_user_id`)},
		${sql.ref(`${activity}.changed_by_job`)}, ${sql.ref(`${activity}.changed_for_user_id`)},
		${userId}::uuid)`;

export const sharedCopiedCall = visibleCall(null);

const viewer = sql<string>`nullif(current_setting('engine.user_id', true), '')::uuid`;

export const visibleCallStep = sql<boolean>`(s.call_activity_id is null or s.owner_party_id = ${viewer}
	or exists (select from activity a where a.id = s.call_activity_id and ${visibleCall(viewer)}))`;
