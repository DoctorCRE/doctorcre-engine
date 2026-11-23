import { type RawBuilder, sql } from "kysely";

export const openPartySteps = (partyId: RawBuilder<unknown>) =>
	sql`select n.id, n.due_on from next_step n
		where n.party_id = ${partyId} and n.status = 'open'`;

// Grouped once per read; a per-party subquery rescans activity for every row.
export const lastRecordedContacts = sql`select link.party_id, max(a.happened_at) as happened_at
	from activity_about link join activity a on a.id = link.activity_id
	where a.kind in ('email', 'call', 'meeting') group by link.party_id`;

export const copiedLeadIdentity = (partyId: RawBuilder<unknown>) =>
	sql`select min(value) filter (where source = 'old_system_lead') as value,
		min(value) filter (where source = 'old_system_ref' and value like 'L-%') as registry_ref
		from outside_id where party_id = ${partyId} and source in ('old_system_lead', 'old_system_ref')`;
