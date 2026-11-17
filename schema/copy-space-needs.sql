-- Run after copy-attribution.sql, copy-markets.sql, copy-deals.sql and copy-vendors.sql in an owner transaction.
-- pg_temp.copy_space_need_county supplies complete, owner-reviewed county sets, keyed by source table and old id.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
create temp table if not exists copy_space_need_county (
 source_table text not null, old_id uuid not null, county_fips text not null
) on commit drop;
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;
alter table space_need disable trigger stamp_change;
alter table space_need disable trigger record_change;

create temp table old_need on commit drop as
select 'space_search'::text as source_table, s.id, s.deal_id as old_deal_id, 'Space need'::text as name,
 s.created_at, s.created_at as updated_at, s.created_by as author_id, s.spec as criteria,
 s.spec -> 'min_sf' as minimum, s.spec -> 'max_sf' as maximum, s.spec -> 'max_rate_sf_yr' as rate,
 s.spec -> 'sub_types' as types, null::text as must_haves, null::uuid as vendor_id,
 null::text as source_ref, null::text as source_revision, null::text as applicability, null::jsonb as approval,
 null::text as refusal
from public.space_search s
union all
select 'ops.deal_space_search', s.id, s.deal_id, s.name, s.updated_at, s.updated_at, null, s.criteria,
 s.criteria -> 'min_square_feet', s.criteria -> 'max_square_feet', null, s.criteria -> 'property_types',
 nullif(regexp_replace(s.requirements, '^\s+|\s+$', '', 'g'), ''), null, null, null, null, null,
 case when s.status = 'draft' then 'draft_needs_confirmation' end
from ops.deal_space_search s
union all
select 'deal_client_need', n.id, n.deal_id, 'Client requirement', n.observed_at, n.updated_at, n.updated_by, '{}',
 null, null, null, null, n.description, v.party_id, n.source_ref, n.source_revision, n.applicability,
 jsonb_build_object('approved_by', n.approved_by, 'approved_at', n.approved_at,
 'approved_revision', n.approved_revision, 'approved_client_id', n.approved_client_id),
 case when n.approved_revision is distinct from n.revision or n.approved_at is null then 'pending_confirmation'
 when n.fresh_until <= current_timestamp then 'stale_requirement'
 when n.restriction <> 'allowed' then 'restricted_requirement'
 when n.withdrawn then 'withdrawn_requirement'
 when n.approved_client_id is distinct from d.client_id then 'approval_client_differs'
 when not exists (select from public.actor a join app_user u on u.id = a.id
 where a.id = n.approved_by and a.kind = 'human') then 'approval_needs_user' end
from public.deal_client_need n left join public.vendor v on v.id = n.vendor_id
left join public.deal d on d.id = n.deal_id;

create temp table search_problem on commit drop as
select n.id, 'criteria'::text as field, n.criteria::text as value, 'criteria_not_object'::text as reason
from old_need n where jsonb_typeof(criteria) <> 'object'
union all
select n.id, k.key, k.value::text, 'unknown_key' from old_need n
cross join lateral jsonb_each(case when jsonb_typeof(criteria) = 'object' then criteria else '{}' end) k
where n.source_table = 'space_search' and k.key not in ('min_sf','max_sf','max_rate_sf_yr','sub_types','cities','states','statuses')
 or n.source_table = 'ops.deal_space_search' and k.key not in
 ('min_square_feet','max_square_feet','property_types','counties','query','entrance_verified','availability','public_projection_ready','photos_available','sort','cursor','limit')
union all
select n.id, k, criteria ->> k, 'requirement_needs_review' from old_need n
cross join lateral unnest(array['query','entrance_verified']) k
where source_table = 'ops.deal_space_search' and criteria -> k is not null and criteria -> k <> 'null'
 and criteria -> k <> '""'
union all
select n.id, k.key, k.value::text, 'geography_filter_invalid' from old_need n
cross join lateral jsonb_each(case when jsonb_typeof(criteria) = 'object' then criteria else '{}' end) k
where k.key in ('cities','states','counties') and k.value <> 'null' and case
 when jsonb_typeof(k.value) = 'array' then exists (select from jsonb_array_elements(k.value) item
 where jsonb_typeof(item) <> 'string' or item #>> '{}' !~ '\S') else true end
union all
select n.id, 'types', types::text, 'types_need_correction' from old_need n
where types is not null and types <> 'null' and case when jsonb_typeof(types) = 'array' then
 jsonb_array_length(types) > 1 or exists (select from jsonb_array_elements(types) t
 where jsonb_typeof(t) <> 'string' or t #>> '{}' !~ '\S') else true end
union all
select n.id, v.field, v.value::text, 'invalid_number' from old_need n
cross join lateral (values ('min_sf', minimum, 'numeric(10,1)', false), ('max_sf', maximum, 'numeric(10,1)', false),
 ('max_rate_sf_yr', rate, 'numeric(10,2)', true)) v(field, value, target, zero_allowed)
where v.value is not null and v.value <> 'null' and case
 when jsonb_typeof(v.value) <> 'number' or not pg_input_is_valid(v.value #>> '{}', v.target) then true
 else (v.value #>> '{}')::numeric < 0 or not v.zero_allowed and (v.value #>> '{}')::numeric(10,1) = 0 end;

create temp table mapped_need on commit drop as
select n.*, d.deal_id, vendor.party_id as mapped_vendor_id, a.*, geography.market_id,
 case when n.refusal is not null then n.refusal
 when d.deal_id is null then 'deal_not_copied'
 when count(*) over (partition by n.id) > 1 then 'source_id_collision'
 when exists (select from search_problem p where p.id = n.id) then 'incomplete_search'
 when n.source_table = 'deal_client_need' and not exists
 (select from party_role r where r.party_id = vendor.party_id and r.role = 'vendor') then 'vendor_not_copied'
 when geography.specified and geography.matches <> 1 then 'geography_needs_correction'
 end as problem
from old_need n
left join outside_id d on d.source = 'old_system' and d.value = n.old_deal_id::text
left join outside_id vendor on vendor.source = 'old_system' and vendor.value = n.vendor_id::text
cross join lateral copy_attribution(n.source_table, n.id, n.author_id) a
cross join lateral (
 select exists (select from jsonb_each(case when jsonb_typeof(n.criteria) = 'object' then n.criteria else '{}' end) k
 where key in ('cities','states','counties') and value <> 'null' and value <> '[]') as specified,
 count(*) as matches, min(m.id::text)::uuid as market_id
 from market m where exists (select from pg_temp.copy_space_need_county c
 where c.source_table = n.source_table and c.old_id = n.id)
 and array(select distinct c.county_fips from pg_temp.copy_space_need_county c
 where c.source_table = n.source_table and c.old_id = n.id order by c.county_fips)
 = array(select c.county_fips::text from market_county c where c.market_id = m.id order by c.county_fips::text)
) geography
where not exists (select from space_need s where s.id = n.id);

insert into not_copied select id, 'space_need', criteria::text, problem from mapped_need where problem is not null;
insert into not_copied select p.* from search_problem p join mapped_need n on n.id = p.id;
create temp table ready_need on commit drop as
select n.*, (minimum #>> '{}')::numeric as min_sf, (maximum #>> '{}')::numeric as max_sf,
 (rate #>> '{}')::numeric as max_rate from mapped_need n where problem is null;
insert into not_copied select id, 'size', concat_ws(' ', min_sf, max_sf), 'reversed_size' from ready_need where min_sf > max_sf;

create temp table copied_need on commit drop as
with copied as (insert into space_need (id, created_at, deal_id, name, min_sf, max_sf, max_rate_sf_yr, space_type, market_id,
 must_haves, vendor_id, source_ref, source_revision, applicability, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select id, created_at, deal_id, name, min_sf, max_sf, max_rate, types ->> 0,
 case when criteria -> 'cities' <> '[]' or criteria -> 'states' <> '[]' or criteria -> 'counties' <> '[]' then market_id end,
 must_haves, mapped_vendor_id, source_ref, source_revision, applicability,
 updated_at, changed_by_user_id, changed_by_job, changed_for_user_id
from ready_need where not (coalesce(min_sf > max_sf, false)) returning *) select * from copied;
set constraints all immediate;
alter table change disable trigger stamp_change;
insert into change (table_name, record, action, new_value, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select 'space_need', jsonb_build_object('id', id), 'insert',
 to_jsonb(n) - array['changed_at','changed_by_user_id','changed_by_job','changed_for_user_id'],
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id from copied_need n;

-- Approval is evidence from the old assertion, not a new approval by the importing job.
insert into change (table_name, record, action, new_value, changed_by_user_id, changed_at)
select 'space_need', jsonb_build_object('id', n.id), 'update', n.approval,
 (n.approval ->> 'approved_by')::uuid, (n.approval ->> 'approved_at')::timestamptz
from ready_need n join copied_need s on s.id = n.id where n.approval is not null;
set constraints all immediate;
alter table space_need enable trigger stamp_change;
alter table space_need enable trigger record_change;
alter table change enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
