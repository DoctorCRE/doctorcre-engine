-- Copies today's people and companies, with their emails, phone numbers, do not contact, specialties, outside ids,
-- and each person's company and title there, into the new database.
-- The owner runs it in one transaction, as psql --single-transaction does, with search_path set to the new schema.
-- It only reads today's tables in public, and ends by listing each value it did not copy, for a partner to fix there.
-- A record keeps its old id, and outside_id maps each old id, merged-away ones too, to the record it became.
-- That map follows later merges, so later copies find a record through it; a second run copies only what is new.

select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);

-- Off until the end, so each row keeps who last changed it in today's system and when.
alter table party disable trigger stamp_change;
alter table party_email disable trigger stamp_change;
alter table party_phone disable trigger stamp_change;
alter table do_not_contact disable trigger stamp_change;
alter table party_specialty disable trigger stamp_change;
alter table party_company disable trigger stamp_change;

create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;

-- Each partner becomes a person with a user row, under their actor's id, so a row they changed names them.
create temp table partner on commit drop as
select id, display_name from public.actor a
where kind = 'human' and not exists (select from outside_id where source = 'old_system' and value = a.id::text);

insert into party (id, kind, name, changed_by_user_id, changed_at) select id, 'person', display_name, id, now() from partner;
insert into app_user (id) select id from partner;
insert into outside_id (source, value, party_id) select 'old_system', id::text, id from partner;

-- Each old record not copied before, with the live record a chain of old merges ends in.
create temp table old_party on commit drop as
with recursive merged (id, survivor_id) as (
	select id, id from public.party where merged_into is null
	union all
	select p.id, m.survivor_id from public.party p join merged m on p.merged_into = m.id
)
select p.*, m.survivor_id,
	case author.kind when 'human' then author.id end as changed_by_user_id,
	case when author.kind is distinct from 'human' then 'old_system' end as changed_by_job,
	case setter.kind when 'human' then setter.id end as dnc_by_user_id,
	case when setter.kind is distinct from 'human' then 'old_system' end as dnc_by_job
from public.party p
left join merged m using (id)
left join public.actor author on author.id = p.updated_by
left join public.actor setter on setter.id = coalesce(p.contact_state_set_by, p.updated_by)
where not exists (select from outside_id where source = 'old_system' and value = p.id::text);

create temp table copied on commit drop as
select * from old_party where survivor_id = id and deleted_at is null;

-- Today's merge left a duplicate's values on it, so they come across to its survivor as merge_party would move them:
-- the survivor's own first, then its duplicates' by when they were stored.
create temp table chain on commit drop as
select *, row_number() over (partition by survivor_id order by id <> survivor_id, created_at, id) as rank
from old_party where survivor_id in (select id from copied);

-- NPPES issues a number once, so the record that first held it, here or in the new database, keeps it.
create temp table npi_claim on commit drop as
select s.id, s.survivor_id, s.npi as typed, btrim(s.npi) as npi, s.rank, pg_input_is_valid(btrim(s.npi), 'npi') as valid,
	coalesce(held.id, first_value(s.survivor_id) over (partition by btrim(s.npi) order by s.created_at, s.id)) as holder
from chain s left join party held on held.npi = btrim(s.npi)
where btrim(s.npi) <> '';

insert into party (id, created_at, kind, name, npi, changed_by_user_id, changed_by_job, changed_at)
select id, created_at, case kind when 'org' then 'company' else kind end, name,
	(select npi from npi_claim c where c.survivor_id = p.id and c.valid and c.holder = p.id order by c.rank limit 1),
	changed_by_user_id, changed_by_job, updated_at
from copied p;

insert into not_copied
select c.id, 'npi', c.typed,
	case when not c.valid then 'not an NPI' when c.holder <> p.id then 'also held by ' || c.holder
		else 'its record holds another NPI' end
from npi_claim c join party p on p.id = c.survivor_id
where p.npi is distinct from c.npi;

insert into outside_id (source, value, party_id) select 'old_system', id::text, id from copied;

insert into outside_id (source, value, party_id)
select 'old_system', p.id::text, survivor.party_id
from old_party p join outside_id survivor on survivor.source = 'old_system' and survivor.value = p.survivor_id::text
where p.survivor_id <> p.id;

insert into not_copied
select id, 'party', name, case when deleted_at is null then 'merged into a record not copied' else 'deleted' end
from old_party p where not exists (select from outside_id where source = 'old_system' and value = p.id::text);

insert into not_copied
select id, 'party', name, 'merged into a record copied before, so of its values only its outside ids are copied'
from old_party
where survivor_id <> id and survivor_id not in (select id from copied) and survivor_id not in (select id from old_party)
	and (concat(email, phone, cell, npi, specialty, title, city, state, county, contact_state_cadence, notes_path) ~ '\S'
		or org_id is not null or contact_state <> 'active');

-- Each email or phone number as typed, in order, in the one form the new database stores, or null when it has none.
create temp table typed_value on commit drop as
select old_id, party_id, field, typed, stored, extension, label,
	row_number() over (partition by party_id, field = 'email' order by rank, place) as place
from (
	select s.id as old_id, s.survivor_id as party_id, s.rank, 'email' as field, m.place, m.found[1] as typed,
		case when pg_input_is_valid(lower(m.found[1]), 'email_address') then lower(m.found[1]) end as stored,
		null as extension, 'work' as label
	from chain s
	-- Several addresses, or a name with the address in angle brackets.
	cross join lateral regexp_matches(s.email, '([^\s<>,;:"()/]+@[^\s<>,;:"()/]+)', 'g') with ordinality as m (found, place)
	union all
	-- Text that holds no address, or an @ no address took, is listed whole.
	select s.id, s.survivor_id, s.rank, 'email', 0, s.email, null, null, null
	from chain s
	where s.email ~ '\S' and (s.email !~ '@' or regexp_replace(s.email, '[^\s<>,;:"()/]+@[^\s<>,;:"()/]+', '', 'g') ~ '@')
	union all
	select old_id, party_id, rank, field, place, typed,
		case when pg_input_is_valid(number, 'phone_number') and coalesce(extension ~ '^[0-9]{1,6}$', true) then number end,
		extension, label
	from (
		select s.id as old_id, s.survivor_id as party_id, s.rank, phone.field, phone.place, phone.typed, phone.label,
			(regexp_match(phone.typed, '(?:x|ext\.?|extension|#)\s*([0-9]+)\s*$', 'i'))[1] as extension,
			-- Ten digits, with or without a leading 1 and in any punctuation, are North American. Words, such as fax, are listed.
			case
				when number_part ~ '[[:alpha:]]' then null
				when btrim(number_part) like '+%' then '+' || digits
				when length(digits) = 10 then '+1' || digits
				when digits ~ '^1[0-9]{10}$' then '+' || digits
			end as number
		from chain s
		cross join lateral (values ('phone', s.phone, 1, 'work'), ('cell', s.cell, 2, 'mobile')) as phone (field, typed, place, label)
		cross join lateral regexp_replace(phone.typed, '(?:x|ext\.?|extension|#)\s*[0-9]+\s*$', '', 'i') as number_part
		cross join lateral regexp_replace(number_part, '[^0-9]', '', 'g') as digits
		where phone.typed ~ '\S'
	) as phone
) as value;

insert into not_copied
select old_id, field, typed, case field when 'email' then 'not an email address' else 'not a phone number' end
from typed_value where stored is null;

-- The first value stored is primary, so cell is primary only when there is no phone, and a repeat is one row.
insert into party_email (party_id, address, label, is_primary, created_at, changed_by_user_id, changed_by_job, changed_at)
select distinct on (v.party_id, v.stored) v.party_id, v.stored, v.label,
	v.place = min(v.place) over (partition by v.party_id), p.created_at, p.changed_by_user_id, p.changed_by_job, p.updated_at
from typed_value v join copied p on p.id = v.party_id
where v.field = 'email' and v.stored is not null
order by v.party_id, v.stored, v.place;

insert into party_phone (party_id, number, extension, label, is_primary, created_at, changed_by_user_id, changed_by_job,
	changed_at)
select distinct on (v.party_id, v.stored, v.extension) v.party_id, v.stored, v.extension, v.label,
	v.place = min(v.place) over (partition by v.party_id), p.created_at, p.changed_by_user_id, p.changed_by_job, p.updated_at
from typed_value v join copied p on p.id = v.party_id
where v.field <> 'email' and v.stored is not null
order by v.party_id, v.stored, v.extension, v.place;

-- Keep the longest restriction, with an indefinite stop first.
insert into do_not_contact (party_id, reason, until_date, created_at, changed_by_user_id, changed_by_job, changed_at)
select distinct on (survivor_id) survivor_id, btrim(contact_state_reason), contact_state_until,
	coalesce(contact_state_set_at, updated_at), dnc_by_user_id, dnc_by_job, coalesce(contact_state_set_at, updated_at)
from chain where contact_state in ('do_not_contact', 'paused') and contact_state_reason ~ '\S'
	and (contact_state <> 'paused' or contact_state_until is not null)
order by survivor_id, contact_state_until desc nulls first, rank;

insert into not_copied
select id, 'contact_state', concat_ws(' until ', contact_state, contact_state_until),
	case when contact_state in ('do_not_contact', 'paused') and not coalesce(contact_state_reason ~ '\S', false) then 'do not contact without a reason'
		when contact_state = 'paused' then 'paused without an end date'
		else 'no place in the new database' end
from chain where contact_state <> 'active' and not (contact_state in ('do_not_contact', 'paused')
	and contact_state_reason ~ '\S' and (contact_state <> 'paused' or contact_state_until is not null));

-- Each specialty typed, split at commas and semicolons. Spellings that differ only in case, spaces or punctuation
-- are one specialty, labelled as first typed, and one already on the list keeps its label.
create temp table typed_specialty on commit drop as
select s.id as old_id, s.survivor_id as party_id, s.created_at, t.place, regexp_replace(t.typed, '^\s+|\s+$', '', 'g') as typed,
	btrim(regexp_replace(lower(t.typed), '[^a-z0-9]+', '_', 'g'), '_') as slug
from chain s cross join lateral regexp_split_to_table(s.specialty, '[,;]') with ordinality as t (typed, place)
where t.typed ~ '\S';

insert into specialty (slug, label)
select distinct on (v.slug) v.slug, v.typed
from typed_specialty v join copied p on p.id = v.party_id
where p.kind = 'person' and v.slug <> '' and v.slug not in (select slug from specialty)
order by v.slug, v.created_at, v.old_id, v.place;

insert into party_specialty (person_id, specialty, created_at, changed_by_user_id, changed_by_job, changed_at)
select distinct v.party_id, v.slug, p.created_at, p.changed_by_user_id, p.changed_by_job, p.updated_at
from typed_specialty v join copied p on p.id = v.party_id
where p.kind = 'person' and v.slug <> '';

insert into not_copied
select v.old_id, 'specialty', v.typed, case when v.slug = '' then 'not a specialty' else 'only a person holds a specialty' end
from typed_specialty v join copied p on p.id = v.party_id
where p.kind <> 'person' or v.slug = '';

-- A person's company and their title there, the survivor's own first, at the record the company became.
create temp table typed_company on commit drop as
select s.id as old_id, s.survivor_id as person_id, s.org_id, s.title as typed_title, p.kind, map.party_id as company_id,
	company.kind as company_kind, nullif(regexp_replace(s.title, '^\s+|\s+$', '', 'g'), '') as title, s.rank
from chain s
join copied p on p.id = s.survivor_id
left join outside_id map on map.source = 'old_system' and map.value = s.org_id::text
left join party company on company.id = map.party_id;

insert into party_company (person_id, company_id, title, created_at, changed_by_user_id, changed_by_job, changed_at)
select distinct on (v.person_id, v.company_id) v.person_id, v.company_id, v.title, p.created_at, p.changed_by_user_id,
	p.changed_by_job, p.updated_at
from typed_company v join copied p on p.id = v.person_id
where v.kind = 'person' and v.company_kind = 'company'
order by v.person_id, v.company_id, v.title is null, v.rank;

insert into not_copied
select old_id, 'org_id', org_id::text, case
	-- A company's own company is its national account, which waits for that slice.
	when kind <> 'person' then 'a national account has no place in the new database yet'
	when company_id is null then 'its company is not copied'
	else 'not a company' end
from typed_company where org_id is not null and (kind <> 'person' or company_kind is distinct from 'company');

insert into not_copied
select v.old_id, 'title', v.typed_title, case
	when exists (select from party_company c where c.person_id = v.person_id and c.company_id = v.company_id)
		then 'its record holds another title there'
	when v.org_id is not null then 'its company is not copied'
	else 'a title without a company' end
from typed_company v
where v.title is not null
	and not exists (select from party_company c where c.person_id = v.person_id and c.company_id = v.company_id and c.title = v.title);

-- These have no place in the new database yet (#271).
insert into not_copied
select s.id, f.field, f.value, 'no place in the new database'
from chain s cross join lateral (values ('city', s.city), ('state', s.state), ('county', s.county),
	('contact_state_cadence', s.contact_state_cadence), ('notes_path', s.notes_path)) as f (field, value)
where f.value ~ '\S';

-- Today's import history and its own reference numbers become outside ids of the record each old one became.
-- A source is lower-cased, with _ for each run of anything but letters and digits.
create temp table typed_outside_id on commit drop as
select v.old_id, v.field, v.typed, v.source, v.value, map.party_id, case
	when v.field = 'record_source' and v.source = 'dup_candidate' then 'a hint of a duplicate, not an id'
	when v.kind not in ('party', 'vendor', 'lead', 'client') then 'no place in the new database'
	when map.party_id is null then 'its record is not copied'
	when v.field = 'record_source' and v.source in ('old_system', 'old_system_ref') then 'a source the copy keeps for itself'
	when v.source !~ '^[a-z][a-z0-9_]*$' or v.value !~ '\S' then 'not an outside id'
end as reason
from (
	select coalesce(o.party_id, r.entity_id) as old_id, 'record_source' as field, r.entity_type as kind,
		concat_ws(' ', r.source_system, r.external_key) as typed,
		btrim(regexp_replace(lower(r.source_system), '[^a-z0-9]+', '_', 'g'), '_') as source,
		regexp_replace(r.external_key, '^\s+|\s+$', '', 'g') as value, o.party_id
	from public.record_source r
	left join (
		select 'party' as kind, id, id as party_id from public.party
		union all select 'vendor', id, party_id from public.vendor
		union all select 'lead', id, party_id from public.lead
		union all select 'client', id, party_id from public.client
	) as o on o.kind = r.entity_type and o.id = r.entity_id
	-- These are left to the copies of those records.
	where r.entity_type not in ('deal', 'activity', 'event', 'loop_item')
	union all
	select id, 'ref', 'party', ref, 'old_system_ref', regexp_replace(ref, '^\s+|\s+$', '', 'g'), id
	from old_party where ref ~ '\S'
) as v
left join outside_id map on map.source = 'old_system' and map.value = v.party_id::text;

insert into outside_id (source, value, party_id)
select distinct on (source, value) source, value, party_id
from typed_outside_id v
where reason is null and not exists (select from outside_id o where o.source = v.source and o.value = v.value)
order by source, value, old_id;

insert into not_copied
select v.old_id, v.field, v.typed, coalesce(v.reason, 'also the id of ' || o.party_id)
from typed_outside_id v left join outside_id o using (source, value)
where v.reason is not null or o.party_id is distinct from v.party_id;

-- A partner's own person row names them, checked now, because a table with checks waiting cannot be altered.
set constraints all immediate;
alter table party enable trigger stamp_change;
alter table party_email enable trigger stamp_change;
alter table party_phone enable trigger stamp_change;
alter table do_not_contact enable trigger stamp_change;
alter table party_specialty enable trigger stamp_change;
alter table party_company enable trigger stamp_change;

select * from not_copied order by old_id, field, value;
