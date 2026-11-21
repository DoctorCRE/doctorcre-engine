import { type RawBuilder, sql } from "kysely";

export const openPartySteps = (partyId: RawBuilder<unknown>) =>
	sql`select n.id, n.due_on from next_step n
		where n.party_id = ${partyId} and n.status = 'open'`;

export const lastRecordedContact = (partyId: RawBuilder<unknown>) =>
	sql`(select max(a.happened_at) from activity_about link join activity a on a.id = link.activity_id
		where link.party_id = ${partyId} and a.kind in ('email', 'call', 'meeting'))`;

export const copiedLeadIdentity = (partyId: RawBuilder<unknown>) =>
	sql`select min(value) filter (where source = 'old_system_lead') as value,
		min(value) filter (where source = 'old_system_ref' and value like 'L-%') as registry_ref
		from outside_id where party_id = ${partyId} and source in ('old_system_lead', 'old_system_ref')`;
