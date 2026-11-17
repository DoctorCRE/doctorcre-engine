-- Owner transaction after party, client and attribution copies, with the new schema on search_path.
-- Supply reviewed first known dates in pg_temp.copy_client_brand_date before running this file.
create temp table if not exists copy_client_brand_date (
 location_client_id uuid primary key, started_on date not null
) on commit drop;
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table client_brand disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

-- A person's org_id is their company, which the party copy keeps; only a company's names its brand.
create temp table old_brand on commit drop as
select c.id as client_id, c.party_id as old_location_id, p.org_id, md5('old_system:client_brand:' || c.id)::uuid as id,
 location.id as location_id, brand.id as brand_id, d.started_on,
 coalesce(set_event.occurred_at, p.created_at) as set_at, author.*,
 case when d.started_on is null then 'brand_start_date_required'
 when location.id is null then 'location_not_copied'
 when brand.id is null then 'brand_not_copied'
 when brand.kind <> 'company' then 'brand_not_company'
 when brand.id = location.id then 'brand_is_location' end as refusal
from public.client c join public.party p on p.id = c.party_id
left join pg_temp.copy_client_brand_date d on d.location_client_id = c.id
left join outside_id location_map on location_map.source = 'old_system' and location_map.value = c.id::text
left join party location on location.id = location_map.party_id and location.kind = 'company'
left join outside_id brand_map on brand_map.source = 'old_system' and brand_map.value = p.org_id::text
left join party brand on brand.id = brand_map.party_id
-- An org_id given when the company was made has no event of its own, so its creation event signs it.
left join lateral (select e.id, e.actor_id, e.occurred_at from public.event e where e.subject_type = 'party' and e.subject_id = p.id
 and e.field = 'org_id' order by e.mutation_order desc limit 1) set_event on true
left join lateral (select e.id from public.event e where e.subject_type = 'party' and e.subject_id = p.id
 order by e.mutation_order limit 1) made_event on true
cross join lateral copy_event_attribution(coalesce(set_event.actor_id, p.created_by), coalesce(set_event.id, made_event.id)) author
where c.merged_into is null and p.kind = 'org' and p.org_id is not null
 and not exists (select from client_brand done where done.id = md5('old_system:client_brand:' || c.id)::uuid);

create temp table examined_brand on commit drop as
select b.*, coalesce(refusal, case when exists (select from client_brand held where held.location_id = b.location_id
  and daterange(held.started_on, held.ended_on) && daterange(b.started_on, null))
 or exists (select from old_brand other where other.client_id <> b.client_id
  and other.location_id = b.location_id and other.refusal is null)
 then 'brand_dates_overlap' end) as reason
from old_brand b;

insert into client_brand (id, location_id, brand_id, started_on, created_at, changed_at,
 changed_by_user_id, changed_by_job, changed_for_user_id)
select id, location_id, brand_id, started_on, set_at, set_at, changed_by_user_id, changed_by_job, changed_for_user_id
from examined_brand where reason is null;

insert into not_copied
select client_id, case when reason in ('brand_start_date_required', 'brand_dates_overlap') then 'started_on'
 when reason = 'location_not_copied' then 'party_id' else 'org_id' end,
 case when reason = 'brand_dates_overlap' then started_on::text
 when reason = 'location_not_copied' then old_location_id::text
 when reason <> 'brand_start_date_required' then org_id::text end, reason
from examined_brand where reason is not null;

set constraints all immediate;
alter table client_brand enable trigger stamp_change;
select * from not_copied order by old_id, field, value;
