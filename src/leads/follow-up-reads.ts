import { type RawBuilder, sql } from "kysely";

export const openPartySteps = (partyId: RawBuilder<unknown>) =>
	sql`select n.id, n.due_on from next_step n
		where n.party_id = ${partyId} and n.status = 'open'`;

// Grouped once per read; a per-party subquery rescans activity for every row.
export const lastRecordedContacts = sql`select link.party_id, max(a.happened_at) as happened_at
	from activity_about link join activity a on a.id = link.activity_id
	where a.kind in ('email', 'call', 'meeting') group by link.party_id`;

export const chicagoDay = (at: RawBuilder<unknown>) =>
	sql`(${at} at time zone 'America/Chicago')::date`;

// A ruling outranks the level, and no level is not_rated.
export const VENDOR_RELATIONSHIPS = [
	{ word: "core", level: 3 },
	{ word: "established", level: 2 },
	{ word: "building", level: 1 },
	{ word: "prospective", level: 0 },
	{ word: "not_rated", level: null },
	{ word: "parked", ruling: true },
	{ word: "avoid", ruling: true },
] as const;
export type VendorRelationship = (typeof VENDOR_RELATIONSHIPS)[number]["word"];

export const vendorRelationship = (role: string) => {
	const ruling = sql.ref(`${role}.disposition`);
	const level = sql.ref(`${role}.relationship_level`);
	const whens = VENDOR_RELATIONSHIPS.map((r) => {
		const when =
			"ruling" in r
				? sql`${ruling} = ${r.word}`
				: r.level === null
					? sql`${ruling} is null and ${level} is null`
					: sql`${ruling} is null and ${level} = ${r.level}`;
		return sql`when ${when} then ${r.word}::text`;
	});
	return sql`case ${sql.join(whens, sql` `)} end`;
};

// `recorded` is a join on lastRecordedContacts for the same party.
export const vendorIsQuiet = (role: string, recorded: string, days: number) => {
	const partyId = sql.ref(`${role}.party_id`);
	return sql`${sql.ref(`${role}.disposition`)} is null
		and not exists (select from active_do_not_contact dnc where dnc.party_id = ${partyId})
		and not exists (${openPartySteps(partyId)})
		and coalesce(${chicagoDay(sql.ref(`${recorded}.happened_at`))}, ${chicagoDay(sql.ref(`${role}.created_at`))})
			+ ${days}::int <= ${chicagoDay(sql`now()`)}`;
};

export const copiedLeadIdentity = (partyId: RawBuilder<unknown>) =>
	sql`select min(value) filter (where source = 'old_system_lead') as value,
		min(value) filter (where source = 'old_system_ref' and value like 'L-%') as registry_ref
		from outside_id where party_id = ${partyId} and source in ('old_system_lead', 'old_system_ref')`;
