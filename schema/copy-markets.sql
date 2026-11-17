-- Run after the party copy and copy-attribution.sql in one owner transaction in the new schema.
-- Optional pg_temp.copy_market_county lists each market's complete, owner-reviewed county set.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
create temp table if not exists copy_market_county (market_slug text not null, county_fips text not null) on commit drop;
create temp table not_copied (old_id text not null, field text not null, value text, reason text not null) on commit drop;
alter table market disable trigger stamp_change;
alter table market_county disable trigger stamp_change;
alter table territory disable trigger stamp_change;
alter table territory_piece disable trigger stamp_change;
alter table party_territory disable trigger stamp_change;
alter table party_territory_review disable trigger stamp_change;
alter table party_territory_review disable trigger review_stamp;

-- Names are not identities: the source slug gives imports stable ids without widening outside_id.
create temp table old_market on commit drop as
with source as (
 select m.*, md5('old_system:market:' || slug)::uuid as id,
 md5('old_system:market_territory:' || slug)::uuid as territory_id,
 exists (select from market n where n.id = md5('old_system:market:' || m.slug)::uuid) as copied
 from public.vendor_market m
)
select m.*, a.*,
 case when kind = 'regional' then 'regional_boundary_needs_drawing'
 when copied then null
 when count(*) filter (where kind = 'market') over (partition by name) > 1 then 'duplicate_market_name'
 when exists (select from market n where n.name = m.name and n.id <> md5('old_system:market:' || m.slug)::uuid)
 then 'market_name_already_used'
 when not exists (select from pg_temp.copy_market_county c where c.market_slug = m.slug) then 'counties_not_listed'
 when exists (select from pg_temp.copy_market_county c where c.market_slug = m.slug
 and not pg_input_is_valid(c.county_fips, 'county_fips')) then 'invalid_county' end as refusal
from source m cross join lateral copy_attribution('vendor_market', null, m.reviewed_by) a;
insert into not_copied select slug, 'boundary', boundary, refusal from old_market where refusal is not null;
insert into not_copied select c.market_slug, 'county_fips', c.county_fips, 'unknown_market_slug'
from pg_temp.copy_market_county c where not exists (select from old_market m where m.slug = c.market_slug);

insert into not_copied
select m.slug, 'county_fips', jsonb_build_object('supplied', supplied.counties, 'stored', stored.counties)::text,
 'market_already_copied' from old_market m
cross join lateral (select array_agg(distinct c.county_fips order by c.county_fips) as counties
 from pg_temp.copy_market_county c where c.market_slug = m.slug) supplied
cross join lateral (select array_agg(c.county_fips::text order by c.county_fips::text) as counties
 from market_county c where c.market_id = m.id) stored
where m.copied and supplied.counties is not null and supplied.counties is distinct from stored.counties;

insert into market (id, name, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select id, name, reviewed_at, reviewed_at, changed_by_user_id, changed_by_job, changed_for_user_id
from old_market where refusal is null on conflict (id) do nothing;
insert into market_county (market_id, county_fips, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select distinct m.id, c.county_fips::county_fips, m.reviewed_at, m.reviewed_at,
 m.changed_by_user_id, m.changed_by_job, m.changed_for_user_id
from old_market m join pg_temp.copy_market_county c on c.market_slug = m.slug
where m.refusal is null and not m.copied
on conflict do nothing;
insert into territory (id, name, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select territory_id, name, reviewed_at, reviewed_at, changed_by_user_id, changed_by_job, changed_for_user_id
from old_market where refusal is null or kind = 'regional' on conflict (id) do nothing;
insert into territory_piece (territory_id, market_id, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select territory_id, id, reviewed_at, reviewed_at, changed_by_user_id, changed_by_job, changed_for_user_id
from old_market where refusal is null and not copied on conflict do nothing;

create temp table old_membership on commit drop as
select v.vendor_id, v.market_slug, v.office_presence, v.service_coverage, v.source, v.reviewed_at, o.party_id, m.territory_id, m.refusal, a.*
from public.vendor_market_membership v join old_market m on m.slug = v.market_slug
join public.vendor vendor on vendor.id = v.vendor_id
left join outside_id o on o.source = 'old_system' and o.value = vendor.party_id::text
cross join lateral copy_attribution('vendor_market_membership', null, v.reviewed_by) a;
insert into party_territory (id, party_id, territory_id, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select distinct on (party_id, territory_id) md5('old_system:market_membership:' || market_slug || ':' || vendor_id)::uuid, party_id, territory_id, reviewed_at, reviewed_at,
 changed_by_user_id, changed_by_job, changed_for_user_id from old_membership
where party_id is not null and exists (select from territory t where t.id = territory_id)
order by party_id, territory_id, reviewed_at, vendor_id on conflict do nothing;
insert into not_copied select vendor_id::text, 'market_membership', market_slug,
 case when party_id is null then 'party_not_copied' else refusal end from old_membership
where party_id is null or not exists (select from territory t where t.id = territory_id);

create temp table old_membership_review on commit drop as
select distinct on (m.party_id, m.territory_id) m.*,
 exists (select from old_membership other where other.party_id = m.party_id and other.territory_id = m.territory_id
 and (other.office_presence, other.service_coverage, other.source)
 is distinct from (m.office_presence, m.service_coverage, m.source)) as disagrees
from old_membership m
order by m.party_id, m.territory_id, m.reviewed_at, m.vendor_id;
insert into party_territory_review (party_territory_id, has_office, coverage, source,
 reviewed_by_user_id, reviewed_by_job, reviewed_for_user_id, reviewed_at,
 created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select p.id, m.office_presence, m.service_coverage, m.source,
 m.changed_by_user_id, m.changed_by_job, m.changed_for_user_id, m.reviewed_at,
 m.reviewed_at, m.reviewed_at, m.changed_by_user_id, m.changed_by_job, m.changed_for_user_id
from old_membership_review m join party_territory p
 on p.party_id = m.party_id and p.territory_id = m.territory_id and p.started_on is null
where not m.disagrees on conflict do nothing;
insert into not_copied select m.vendor_id::text, 'membership_details',
 jsonb_build_object('market', m.market_slug, 'office_presence', m.office_presence,
 'service_coverage', m.service_coverage, 'source', m.source)::text, 'membership_reviews_disagree'
from old_membership m join old_membership_review r using (party_id, territory_id) where r.disagrees;

create temp table text_territory on commit drop as
select v.*, md5('old_system:vendor_territory:' || v.id)::uuid as territory_id, o.party_id as mapped_party_id, a.*
from public.vendor v left join outside_id o on o.source = 'old_system' and o.value = v.party_id::text
cross join lateral copy_attribution('vendor', v.id, coalesce(v.updated_by, v.created_by)) a
where v.territory ~ '\S';
insert into territory (id, name, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select territory_id, territory, created_at, updated_at, changed_by_user_id, changed_by_job, changed_for_user_id
from text_territory where mapped_party_id is not null on conflict (id) do nothing;
insert into party_territory (id, party_id, territory_id, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select md5('old_system:vendor_territory_link:' || id)::uuid, mapped_party_id, territory_id, created_at, updated_at, changed_by_user_id, changed_by_job, changed_for_user_id
from text_territory where mapped_party_id is not null on conflict do nothing;
insert into not_copied select id::text, 'territory', territory,
 case when mapped_party_id is null then 'party_not_copied' else 'text_territory_needs_drawing' end from text_territory;

insert into not_copied select slug, 'source', source, 'no_typed_destination' from public.vendor_market;
insert into not_copied select market_slug, 'market_key', key, 'no_alias_destination' from public.vendor_market_key;
insert into not_copied select market_slug, 'regional_reference', to_jsonb(r)::text, 'reference_is_not_a_boundary'
from public.vendor_market_regional_reference r;
-- This list describes negotiating conditions, not geographic submarkets.
insert into not_copied select slug, 'submarket_condition', to_jsonb(s)::text, 'not_geography' from public.submarket_condition s;
set constraints all immediate;
alter table market enable trigger stamp_change;
alter table market_county enable trigger stamp_change;
alter table territory enable trigger stamp_change;
alter table territory_piece enable trigger stamp_change;
alter table party_territory enable trigger stamp_change;
alter table party_territory_review enable trigger stamp_change;
alter table party_territory_review enable trigger review_stamp;
select * from not_copied order by old_id, field, value, reason;
