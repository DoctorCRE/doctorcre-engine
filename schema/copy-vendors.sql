-- Copies today's vendors into the new database: each one's vendor role, with its stage, relationship level and
-- target flag, and its categories as roles. Run it after schema/copy-parties.sql and before schema/copy-deals.sql,
-- which finds the vendor roles. The owner runs it in one transaction with search_path set to the new schema.
-- It only reads today's tables in public, and ends by listing each value it did not copy, for a partner to fix there.
-- outside_id maps each copied vendor's old id to its record, so a second run copies only vendors that are new.

select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);

-- Off until the end, so each role keeps who last changed its vendor in today's system and when.
alter table party_role disable trigger stamp_change;

create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;

insert into role (slug, label) values ('vendor', 'Vendor') on conflict do nothing;

insert into role (slug, label, category_of)
select case slug when 'gc' then 'contractor' else slug end, label, 'vendor' from public.vendor_category
on conflict do nothing;

-- The roles a vendor plays on a deal today, so the deal copy finds each of them.
insert into role (slug, label, category_of) values ('lender', 'Lender', 'vendor'), ('contractor', 'Contractor', 'vendor'),
	('architect', 'Architect', 'vendor'), ('attorney', 'Attorney', 'vendor'), ('title', 'Title', 'vendor'),
	('inspector', 'Inspector', 'vendor'), ('landlord_rep', 'Landlord rep', 'vendor')
on conflict do nothing;

-- The old system's migration 0047 split its nine original stages into level, ruling and target, which hold them now.
create temp table original_stage on commit drop as
select unnest(array['prospect_uncontacted', 'unrated', 'target_not_yet_met', 'building_working_on_it', 'decent_relationship',
	'important_strengthening', 'fully_aligned', 'avoid_not_a_good_partner', 'tabled_parked_drip_only']) as slug;

insert into stage (role, slug, label)
select 'vendor', slug, label from public.vendor_stage where slug not in (select slug from original_stage)
on conflict do nothing;

-- Each live vendor not copied before, at the record its party became. A merged-away vendor is today's tombstone,
-- whose values today's merge already gave its survivor.
create temp table old_vendor on commit drop as
select v.*, map.party_id as record_id,
	exists (select from party_role r where r.party_id = map.party_id and r.role = 'vendor') as record_had_vendor,
	row_number() over (partition by map.party_id order by v.party_id <> map.party_id, v.created_at, v.id) as rank,
	stage.slug as stage_slug, level.level, author.*
from public.vendor v
left join outside_id map on map.source = 'old_system' and map.value = v.party_id::text
left join stage on stage.role = 'vendor' and stage.slug = v.stage
left join relationship_level level on level.level = v.relationship_level
cross join lateral copy_attribution('vendor', v.id, v.updated_by) author
where v.merged_into is null and not exists (select from outside_id where source = 'old_system' and value = v.id::text);

-- Today's rulings have no reason, and the new database keeps none without one, so a ruled vendor's record waits whole.
-- Copying it without the ruling would put it back in play.
create temp table copied on commit drop as
select * from old_vendor v
where record_id is not null and not record_had_vendor
	and not exists (select from old_vendor w where w.record_id = v.record_id and w.disposition <> 'active');

-- One record's vendors are one vendor role, as merge_party would join them: the first stage and level, the record's
-- own vendor's first, then by when they were stored, and a target on any.
insert into party_role (party_id, role, created_at, stage, relationship_level, is_target, changed_by_user_id, changed_by_job,
	changed_for_user_id, changed_at)
select distinct on (record_id) record_id, 'vendor', created_at,
	first_value(stage_slug) over (partition by record_id order by stage_slug is null, rank),
	first_value(level) over (partition by record_id order by level is null, rank),
	bool_or(is_target) over (partition by record_id), changed_by_user_id, changed_by_job, changed_for_user_id, updated_at
from copied
order by record_id, rank;

insert into party_role (party_id, role, created_at, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select distinct on (record_id, role) record_id, role, created_at, changed_by_user_id, changed_by_job, changed_for_user_id, updated_at
from copied cross join lateral (select case category_slug when 'gc' then 'contractor' else category_slug end as role) category
where role is not null
order by record_id, role, rank;

insert into outside_id (source, value, party_id) select 'old_system', id::text, record_id from copied;

create temp table typed_ref on commit drop as
select id, vendor_ref, record_id, regexp_replace(vendor_ref, '^\s+|\s+$', '', 'g') as value from copied where vendor_ref ~ '\S';

insert into outside_id (source, value, party_id)
select distinct on (value) 'old_system_ref', value, record_id
from typed_ref t where not exists (select from outside_id o where o.source = 'old_system_ref' and o.value = t.value)
order by value, id;

insert into not_copied
select t.id, 'vendor_ref', t.vendor_ref, 'also the id of ' || o.party_id
from typed_ref t join outside_id o on o.source = 'old_system_ref' and o.value = t.value
where o.party_id <> t.record_id;

insert into not_copied
select id, 'vendor', vendor_ref, case
	when record_id is null then 'its record is not copied'
	when record_had_vendor then 'its record holds a vendor role copied before'
	else 'another vendor of its record waits for a ruling' end
from old_vendor v
where disposition = 'active' and not exists (select from copied c where c.id = v.id);

insert into not_copied
select id, 'disposition', disposition, case when disposition in ('parked', 'avoid') then 'a ruling without a reason'
	else 'not a ruling' end
from old_vendor where disposition <> 'active';

insert into not_copied
select v.id, 'stage', v.stage, 'its record holds another stage'
from copied v join party_role r on r.party_id = v.record_id and r.role = 'vendor'
where v.stage_slug <> r.stage;

insert into not_copied
select v.id, 'relationship_level', v.relationship_level::text,
	case when v.level is null then 'not a relationship level' else 'its record holds another level' end
from copied v join party_role r on r.party_id = v.record_id and r.role = 'vendor'
where v.relationship_level is distinct from r.relationship_level and v.relationship_level is not null;

-- Today's free-text category is what 0050 could not name, kept for a partner to give a category.
insert into not_copied
select id, 'category', category, 'not a vendor category' from copied where category_slug is null and category ~ '\S';

insert into not_copied
select id, 'trust_override', trust_override ->> 'tier', 'a hand-set rating, which the new database does not keep'
from copied where trust_override is not null;

insert into not_copied
select v.id, f.field, f.value, 'no place in the new database'
from copied v cross join lateral (values ('verticals', array_to_string(v.verticals, ', ')), ('owner_id', v.owner_id::text),
	('referral_active', v.referral_active::text), ('territory', v.territory), ('offers', v.offers), ('seeking', v.seeking),
	('rivalry_group', v.rivalry_group), ('originated', v.originated), ('enrich', v.enrich::text),
	('out_of_market', nullif(v.out_of_market, false)::text), ('last_touch', v.last_touch::text), ('intro_notes', v.intro_notes),
	('owner_label', v.owner_label), ('links_label', v.links_label), ('loan_programs', array_to_string(v.loan_programs, ', ')),
	('deal_history_verified_at', v.deal_history_verified_at::text)) as f (field, value)
where f.value ~ '\S';

-- A category waits on its vendor role, checked now, because a table with checks waiting cannot be altered.
set constraints all immediate;
alter table party_role enable trigger stamp_change;

select * from not_copied order by old_id, field, value;
