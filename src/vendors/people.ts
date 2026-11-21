import { type RawBuilder, sql } from "kysely";

const filled = (field: string) =>
	sql`(jsonb_typeof(f.value -> ${sql.lit(field)}) = 'string'
		and btrim(f.value ->> ${sql.lit(field)}) <> '')`;

// A finding verifies an office only when it is sourced, current, external and
// names a street, city and state.
const officeVerified = sql`coalesce(f.value -> 'found' = 'true'::jsonb
	and not f.proposes_correction
	and f.value ->> 'epistemic_status' = 'source_backed'
	and coalesce(f.value ->> 'internal', 'false') = 'false'
	and f.value ->> 'location_type' = 'office'
	and ${filled("street_address")} and ${filled("city")} and ${filled("state")}
	and btrim(f.source) <> '' and f.observed_at <= statement_timestamp()
	and (f.expires_on is null or f.expires_on >= current_date), false)`;

// The latest address finding on `party`, as the lateral row `f`.
const latestAddress = (party: RawBuilder<unknown>) =>
	sql`left join lateral (select f.*, ${officeVerified} as verified
		from (select flag_id, value, source, observed_at, expires_on, proposes_correction
			from v_record_flag_subject
			where subject_type = 'party' and subject_id = ${party} and kind = 'address'
			order by observed_at desc, flag_id desc limit 1) f) f on true`;

const office = sql`case when f.verified then jsonb_build_object(
	'street_address', f.value ->> 'street_address', 'city', f.value ->> 'city',
	'state', f.value ->> 'state', 'finding_id', f.flag_id, 'source', f.source,
	'observed_at', f.observed_at, 'expires_on', f.expires_on) end`;

const research = sql`jsonb_build_object(
	'status', case when f.flag_id is null then 'not_researched'
		when f.verified then 'office_verified' else 'needs_review' end,
	'finding_id', f.flag_id, 'observed_at', f.observed_at, 'expires_on', f.expires_on)`;

// The named people of the vendor `v`, each with its latest address finding.
export const people = sql<
	object[]
>`(select coalesce(jsonb_agg(jsonb_build_object(
		'company', a.company,
		'contact', jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email,
			'phone', c.phone, 'cell', c.cell),
		'office', ${office},
		'research', ${research}
	) order by c.id), '[]')
	from v_vendor_assignment_context a
	cross join jsonb_array_elements(a.contacts) listed
	join party c on c.id = (listed ->> 'id')::uuid and btrim(c.name) <> ''
	${latestAddress(sql.ref("c.id"))}
	where a.id = v.id)`;

export const nextVendorContacts = sql`(select p.id, p.name, p.city, (select jsonb_build_object('id', co.id, 'name', co.name)
		from party_company pc join party co on co.id = pc.company_id
		where pc.person_id = p.id and pc.ended_on is null
		order by pc.started_on desc nulls last, pc.created_at desc, pc.id desc limit 1) as company
	where p.kind = 'person'
	union all
	select distinct cp.id, cp.name, cp.city, jsonb_build_object('id', p.id, 'name', p.name)
	from party_company pc join party cp on cp.id = pc.person_id
	where p.kind = 'company' and pc.company_id = p.id and pc.ended_on is null)`;
