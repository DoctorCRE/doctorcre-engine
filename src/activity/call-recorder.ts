import { type Expression, sql } from "kysely";

// The recorder gets a call's follow-up; a copied call with no recorder goes to whoever the old system stamped.
export const callFollowUpFor = (
	userId: string | Expression<string>,
	activity = "a",
	proposal = "p",
) => sql<boolean>`(${sql.ref(`${activity}.call_owner_user_id`)} = ${userId}::uuid
	or (${sql.ref(`${activity}.id`)} is not null
		and ${sql.ref(`${activity}.call_owner_user_id`)} is null
		and ${sql.ref(`${proposal}.proposed_by_job`)} = 'old_system'
		and ${sql.ref(`${proposal}.changed_for_user_id`)} = ${userId}::uuid))`;
