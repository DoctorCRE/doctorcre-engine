-- Copies today's people and companies, with their emails, phone numbers and do not contact, into the new database.
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
	case when setter.kind is distinct from 'human' then 'old_system' end as dnc_by_job,
	pg_input_is_valid(btrim(p.npi), 'npi') as npi_ok
from public.party p
left join merged m using (id)
left join public.actor author on author.id = p.updated_by
left join public.actor setter on setter.id = coalesce(p.contact_state_set_by, p.updated_by)
where not exists (select from outside_id where source = 'old_system' and value = p.id::text);

-- NPPES issues a number once, so the first record holding it keeps it.
create temp table copied on commit drop as
select *, first_value(id) over (partition by btrim(npi) order by created_at, id) as npi_holder
from old_party where survivor_id = id and deleted_at is null;

insert into party (id, created_at, kind, name, npi, changed_by_user_id, changed_by_job, changed_at)
select id, created_at, case kind when 'org' then 'company' else kind end, name,
	case when npi_ok and npi_holder = id then btrim(npi) end, changed_by_user_id, changed_by_job, updated_at
from copied;

insert into not_copied
select id, 'npi', npi, case when npi_ok then 'also held by ' || npi_holder else 'not an NPI' end
from copied where btrim(npi) <> '' and not (npi_ok and npi_holder = id);

insert into outside_id (source, value, party_id) select 'old_system', id::text, id from copied;

insert into outside_id (source, value, party_id)
select 'old_system', p.id::text, survivor.party_id
from old_party p join outside_id survivor on survivor.source = 'old_system' and survivor.value = p.survivor_id::text
where p.survivor_id <> p.id;

insert into not_copied
select id, 'party', name, case when deleted_at is null then 'merged into a record not copied' else 'deleted' end
from old_party p where not exists (select from outside_id where source = 'old_system' and value = p.id::text);

-- Each email or phone number as typed, in order, in the one form the new database stores, or null when it has none.
create temp table typed_value on commit drop as
select p.id as party_id, 'email' as kind, 'email' as field, m.place, m.found[1] as typed,
	case when pg_input_is_valid(lower(m.found[1]), 'email_address') then lower(m.found[1]) end as stored,
	null as extension, 'work' as label
from copied p
-- Several addresses, or a name with the address in angle brackets.
cross join lateral regexp_matches(p.email, '([^\s<>,;:"()/]+@[^\s<>,;:"()/]+)', 'g') with ordinality as m (found, place)
union all
select p.id, 'email', 'email', 1, p.email, null, null, null
from copied p where p.email ~ '\S' and p.email !~ '@'
union all
select party_id, 'phone', field, place, typed,
	case when pg_input_is_valid(number, 'phone_number') and coalesce(extension ~ '^[0-9]{1,6}$', true) then number end,
	extension, label
from (
	select p.id as party_id, phone.field, phone.place, phone.typed, phone.label,
		(regexp_match(phone.typed, '(?:x|ext\.?|extension|#)\s*([0-9]+)\s*$', 'i'))[1] as extension,
		-- Ten digits, with or without a leading 1 and in any punctuation, are North American. Words, such as fax, are listed.
		case
			when number_part ~ '[[:alpha:]]' then null
			when btrim(number_part) like '+%' then '+' || digits
			when length(digits) = 10 then '+1' || digits
			when digits ~ '^1[0-9]{10}$' then '+' || digits
		end as number
	from copied p
	cross join lateral (values ('phone', p.phone, 1, 'work'), ('cell', p.cell, 2, 'mobile')) as phone (field, typed, place, label)
	cross join lateral regexp_replace(phone.typed, '(?:x|ext\.?|extension|#)\s*[0-9]+\s*$', '', 'i') as number_part
	cross join lateral regexp_replace(number_part, '[^0-9]', '', 'g') as digits
	where phone.typed ~ '\S'
) as phone;

insert into not_copied
select party_id, field, typed, 'not ' || case kind when 'email' then 'an email address' else 'a phone number' end
from typed_value where stored is null;

-- The first value stored is primary, so cell is primary only when there is no phone, and a repeat is one row.
insert into party_email (party_id, address, label, is_primary, created_at, changed_by_user_id, changed_by_job, changed_at)
select distinct on (v.party_id, v.stored) v.party_id, v.stored, v.label,
	v.place = min(v.place) over (partition by v.party_id), p.created_at, p.changed_by_user_id, p.changed_by_job, p.updated_at
from typed_value v join copied p on p.id = v.party_id
where v.kind = 'email' and v.stored is not null
order by v.party_id, v.stored, v.place;

insert into party_phone (party_id, number, extension, label, is_primary, created_at, changed_by_user_id, changed_by_job,
	changed_at)
select distinct on (v.party_id, v.stored, v.extension) v.party_id, v.stored, v.extension, v.label,
	v.place = min(v.place) over (partition by v.party_id), p.created_at, p.changed_by_user_id, p.changed_by_job, p.updated_at
from typed_value v join copied p on p.id = v.party_id
where v.kind = 'phone' and v.stored is not null
order by v.party_id, v.stored, v.extension, v.place;

insert into do_not_contact (party_id, reason, created_at, changed_by_user_id, changed_by_job, changed_at)
select id, btrim(contact_state_reason), coalesce(contact_state_set_at, updated_at), dnc_by_user_id, dnc_by_job,
	coalesce(contact_state_set_at, updated_at)
from copied where contact_state = 'do_not_contact' and contact_state_reason ~ '\S';

-- Paused and nurture have no place in the new database yet, and do not contact needs its reason.
insert into not_copied
select id, 'contact_state', concat_ws(' until ', contact_state, contact_state_until),
	case contact_state when 'do_not_contact' then 'do not contact without a reason' else 'no place in the new database' end
from copied where contact_state <> 'active' and not (contact_state = 'do_not_contact' and contact_state_reason ~ '\S');

-- A partner's own person row names them, checked now, because a table with checks waiting cannot be altered.
set constraints all immediate;
alter table party enable trigger stamp_change;
alter table party_email enable trigger stamp_change;
alter table party_phone enable trigger stamp_change;
alter table do_not_contact enable trigger stamp_change;

select * from not_copied order by old_id, field, value;
