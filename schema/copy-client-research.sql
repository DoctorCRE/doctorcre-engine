-- Run after copy-leads-clients.sql in one owner transaction with the new schema on search_path.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table client_vertical disable trigger stamp_change;
alter table client_research disable trigger stamp_change;
alter table client_research_fact disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, reason text) on commit drop;

create temp table old_client_role on commit drop as
with recursive chain as (
 select id as old_id, id, party_id, merged_into, array[id] as path from public.client
 union all
 select c.old_id, n.id, n.party_id, n.merged_into, c.path || n.id
 from chain c join public.client n on n.id = c.merged_into where not n.id = any(c.path)
)
select c.old_id, p.party_id from chain c
join outside_id o on o.source = 'old_system' and o.value = c.id::text
join party_role p on p.party_id = o.party_id and p.role = 'client'
where c.merged_into is null;

create temp table old_client_vertical on commit drop as
select c.id, p.party_id, regexp_replace(c.vertical, '^\s+|\s+$', '', 'g') as vertical,
 c.merged_into, c.created_at, c.updated_at, coalesce(c.updated_by, c.created_by) as author
from public.client c left join old_client_role p on p.old_id = c.id
where c.vertical is not null;

insert into not_copied
select v.id, 'vertical', r.reason from old_client_vertical v
cross join lateral (values
 ('client_role_not_copied', v.party_id is null),
 ('blank_vertical', v.vertical = ''),
 ('conflicting_verticals', exists (select from old_client_vertical other
  where other.party_id = v.party_id and other.vertical <> '' and other.vertical <> v.vertical)
  and v.vertical <> ''),
 ('existing_vertical_differs', exists (select from client_vertical held
  where held.party_id = v.party_id and held.vertical <> v.vertical))
) r(reason, refused) where r.refused;

insert into client_vertical (party_id, vertical, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select distinct on (v.party_id) v.party_id, v.vertical, v.created_at, v.updated_at, a.*
from old_client_vertical v cross join lateral copy_attribution('client', v.id, v.author, 'vertical') a
where not exists (select from not_copied r where r.old_id = v.id and r.field = 'vertical')
order by v.party_id, v.merged_into nulls first, v.created_at, v.id
on conflict (party_id) do nothing;

create temp table old_client_research on commit drop as
select f.*, p.party_id
from public.record_flag f left join old_client_role p on p.old_id = f.subject_id
where f.subject_type = 'client' and f.kind in ('business-model', 'business-reverse-engineering-dossier',
 'entity_filing', 'leadership', 'practice_acquisition_signal', 'practice_profile', 'practice_research', 'research_note');

insert into not_copied
select f.id, 'research', r.reason from old_client_research f
cross join lateral (values
 ('client_role_not_copied', f.party_id is null),
 ('blank_source', f.source !~ '\S'),
 ('invalid_dates', not isfinite(f.observed_at) or not isfinite(f.expires_on)),
 ('invalid_facts', jsonb_typeof(f.value) <> 'object' or jsonb_typeof(f.value -> 'found') is distinct from 'boolean'
  or exists (select from jsonb_object_keys(case when jsonb_typeof(f.value) = 'object' then f.value else '{}'::jsonb end) as keys(field)
   where field !~ '\S'))
) r(reason, refused) where r.refused;

with ready as materialized (
 select f.* from old_client_research f
 where not exists (select from not_copied r where r.old_id = f.id and r.field = 'research')
), copied as (
 insert into client_research (id, party_id, kind, source, found, observed_at, expires_on, old_author_id,
  changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
 select f.id, f.party_id, f.kind, f.source, (f.value ->> 'found')::boolean, f.observed_at, f.expires_on, f.created_by, f.observed_at, a.*
 from ready f cross join lateral copy_attribution('record_flag', f.id, f.created_by) a
 on conflict (id) do nothing
 returning id, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id
)
insert into client_research_fact (research_id, field, value, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select c.id, fact.key, fact.value, c.changed_at, c.changed_by_user_id, c.changed_by_job, c.changed_for_user_id
from copied c join ready f using (id) cross join lateral jsonb_each(f.value - 'found') fact;

alter table client_vertical enable trigger stamp_change;
alter table client_research enable trigger stamp_change;
alter table client_research_fact enable trigger stamp_change;
select * from not_copied order by old_id, field, reason;
