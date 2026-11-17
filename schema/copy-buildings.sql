-- Load copy-attribution.sql after next.sql first. Run after copy-parties.sql and before copy-leases.sql, in a separate transaction, with search_path set to the new schema.
-- Only reads public. Suites and owners keep their old ids, so a repeat adds only rows not yet copied.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table property disable trigger stamp_change;
alter table suite disable trigger stamp_change;
alter table building_ownership disable trigger stamp_change;
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;

create temp table building_map on commit drop as
with recursive chain as (
 select id as old_id, id, merged_into, array[id] as path from public.building
 union all
 select c.old_id, b.id, b.merged_into, c.path || b.id from chain c
 join public.building b on b.id = c.merged_into where not b.id = any(c.path)
) select old_id, id from chain where merged_into is null;

-- A building with a suite or an owner is a property, at its surviving building's address.
create temp table held_building on commit drop as
select distinct m.id from building_map m join (select building_id from public.space
 union select building_id from public.building_ownership) o on o.building_id = m.old_id;
insert into property (id, address, name, building_class, building_type, year_built, stories,
 created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select b.id, concat_ws(', ', b.address, nullif(b.city, ''), nullif(b.state, ''), nullif(b.zip, '')),
 case when b.name ~ '\S' then b.name end, case when b.class ~ '\S' then b.class end,
 case when b.sub_type ~ '\S' then b.sub_type end, b.year_built, b.stories,
 b.created_at, b.updated_at, a.* from public.building b join held_building h on h.id = b.id
cross join lateral copy_attribution('building', b.id, b.updated_by) a
on conflict (id) do nothing;
insert into not_copied
select b.id, 'property', remaining.value::text, 'unmapped_building_fields' from public.building b join held_building h on h.id = b.id
cross join lateral (select jsonb_strip_nulls(to_jsonb(b) - array['id', 'address', 'city', 'state', 'zip',
 'name', 'class', 'sub_type', 'year_built', 'stories', 'created_at', 'created_by', 'updated_at', 'updated_by', 'merged_into', 'version']) as value) remaining
where remaining.value <> '{}'::jsonb;

create temp table old_suite on commit drop as
select s.*, m.id as property_id, case when btrim(s.suite) ~ '\S' then btrim(s.suite) end as label, a.*
from public.space s left join building_map m on m.old_id = s.building_id
cross join lateral copy_attribution('space', s.id, s.updated_by) a
where not exists (select from suite n where (n.id, n.property_id) = (s.id, m.id));
create temp table suite_refusal on commit drop as
select s.id, f.field, f.value, f.reason from old_suite s cross join lateral (values
 ('building_id', s.building_id::text, 'building_merge_unresolved', s.property_id is null),
 ('id', s.id::text, 'suite_id_taken', exists (select from suite n where n.id = s.id)),
 ('suite', s.label, 'duplicate_suite_label', exists (select from suite n where (n.property_id, n.label) = (s.property_id, s.label))
  or exists (select from public.space o join building_map m on m.old_id = o.building_id
  where m.id = s.property_id and btrim(o.suite) = s.label and o.id <> s.id))) f(field, value, reason, refused)
where f.refused;
insert into not_copied select * from suite_refusal;
insert into suite (id, created_at, property_id, label, floor, area_sf, area_basis, condition,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select id, created_at, property_id, label, floor, area_amount, area_basis, case when condition ~ '\S' then condition end,
 updated_at, changed_by_user_id, changed_by_job, changed_for_user_id
from old_suite s where not exists (select from suite_refusal r where r.id = s.id);

create temp table old_ownership on commit drop as
select o.*, m.id as property_id, p.party_id as new_party_id,
 count(*) over (partition by m.id, p.party_id, o.kind, o.from_on) as same_key, a.*
from public.building_ownership o left join building_map m on m.old_id = o.building_id
left join outside_id p on p.source = 'old_system' and p.value = o.party_id::text
cross join lateral copy_attribution('building_ownership', o.id, o.created_by) a;
create temp table ownership_refusal on commit drop as
select o.id, f.field, f.value, f.reason from old_ownership o cross join lateral (values
 ('building_id', o.building_id::text, 'building_merge_unresolved', o.property_id is null),
 ('party_id', o.party_id::text, 'party_not_copied', o.new_party_id is null),
 ('to_on', concat_ws(' ', o.from_on, o.to_on), 'dates_out_of_order', o.to_on < o.from_on),
 ('source', o.source, 'blank_source', o.source !~ '\S'),
 ('id', o.id::text, 'ownership_id_taken', exists (select from building_ownership n where n.id = o.id
  and (n.property_id, n.party_id, n.kind) is distinct from (o.property_id, o.new_party_id, o.kind))),
 -- Merged buildings or parties can make two of today's links one.
 ('kind', o.kind, 'duplicate_ownership', o.property_id is not null and o.new_party_id is not null and (o.same_key > 1
  or exists (select from building_ownership n where (n.property_id, n.party_id, n.kind) = (o.property_id, o.new_party_id, o.kind)
  and n.started_on is not distinct from o.from_on and n.id <> o.id)))) f(field, value, reason, refused)
where f.refused and (f.reason = 'ownership_id_taken' or not exists (select from building_ownership n where n.id = o.id));
insert into not_copied select * from ownership_refusal;
insert into building_ownership (id, created_at, property_id, party_id, kind, started_on, ended_on, source,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select id, created_at, property_id, new_party_id, kind, from_on, to_on, source,
 created_at, changed_by_user_id, changed_by_job, changed_for_user_id
from old_ownership o where not exists (select from ownership_refusal r where r.id = o.id)
 and not exists (select from building_ownership n where n.id = o.id);
alter table property enable trigger stamp_change;
alter table suite enable trigger stamp_change;
alter table building_ownership enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
