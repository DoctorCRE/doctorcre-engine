import { type Expression, sql } from "kysely";

export const visibleCall = (
	userId: string | Expression<string> | null,
	activity = "a",
) =>
	sql<boolean>`call_visible_to(${sql.ref(`${activity}.changed_by_user_id`)},
		${sql.ref(`${activity}.changed_by_job`)}, ${sql.ref(`${activity}.changed_for_user_id`)},
		${userId}::uuid)`;

export const sharedCopiedCall = visibleCall(null);
