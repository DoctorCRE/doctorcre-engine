import { type Expression, sql } from "kysely";

export const visibleCall = (
	userId: string | Expression<string> | null,
	activity = "a",
) =>
	sql<boolean>`call_visible_to(${sql.ref(`${activity}.call_owner_user_id`)},
		case when ${sql.ref(`${activity}.call_shared`)} then 'old_system' end, null, ${userId}::uuid)`;

export const sharedCopiedCall = visibleCall(null);
