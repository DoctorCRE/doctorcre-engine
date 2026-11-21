import { sql } from "kysely";

// A role move records its original key in record and its destination in new_value.
export const leadVersions = sql`
	select coalesce(new_value->>'party_id', record->>'party_id') as party_id,
		max(id) as base_version
	from change
	where table_name = 'party_role'
		and coalesce(new_value->>'role', record->>'role') = 'lead'
	group by 1`;
