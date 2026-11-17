-- Copies today's vendors into the new database: each one's vendor role, with its stage, relationship level and
-- target flag, its categories as roles, its introductions and the deals it worked. Run it after schema/copy-parties.sql
-- and before schema/copy-deals.sql, which finds the vendor roles, and again after it, so introductions and worked deals
-- find their deals. The owner runs it in one transaction with search_path set to the new schema.
-- It only reads today's tables in public, and ends by listing each value it did not copy, for a partner to fix there.
-- outside_id maps each copied vendor's old id to its record, so a second run copies only vendors that are new.

select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);

-- Off until the end, so each row keeps who last changed it in today's system and when.
alter table party_role disable trigger stamp_change;
alter table deal_party disable trigger stamp_change;
alter table introduction disable trigger stamp_change;

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

-- Each vendor not copied before, at the record its party became. Today's merge joins vendors of one party and leaves
-- a value that conflicted on the merged-away one, so that one joins its survivor here, after the live ones.
create temp table old_vendor on commit drop as
select v.*, map.party_id as record_id,
	exists (select from party_role r where r.party_id = map.party_id and r.role = 'vendor') as record_had_vendor,
	row_number() over (partition by map.party_id
		order by v.merged_into is not null, v.party_id <> map.party_id, v.created_at, v.id) as rank,
	stage.slug as stage_slug, level.level, author.*
from public.vendor v
left join outside_id map on map.source = 'old_system' and map.value = v.party_id::text
left join stage on stage.role = 'vendor' and stage.slug = v.stage
left join relationship_level level on level.level = v.relationship_level
cross join lateral copy_attribution('vendor', v.id, v.updated_by) author
where not exists (select from outside_id where source = 'old_system' and value = v.id::text);

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
create temp table unplaced on commit drop as
select v.id, v.record_id, v.merged_into, f.field, f.value, f.reason
from copied v cross join lateral (values ('category', case when v.category_slug is null then v.category end, 'not a vendor category'),
	('trust_override', v.trust_override ->> 'tier', 'a hand-set rating, which the new database does not keep'),
	('verticals', array_to_string(v.verticals, ', '), null), ('owner_id', v.owner_id::text, null),
	('referral_active', v.referral_active::text, null), ('territory', v.territory, null), ('offers', v.offers, null),
	('seeking', v.seeking, null), ('rivalry_group', v.rivalry_group, null), ('originated', v.originated, null),
	('enrich', v.enrich::text, null), ('out_of_market', nullif(v.out_of_market, false)::text, null),
	('last_touch', v.last_touch::text, null), ('intro_notes', v.intro_notes, null), ('owner_label', v.owner_label, null),
	('links_label', v.links_label, null), ('loan_programs', array_to_string(v.loan_programs, ', '), null),
	('deal_history_verified_at', v.deal_history_verified_at::text, null)) as f (field, value, reason)
where f.value ~ '\S';

-- A merged-away vendor's value that a live one of its record holds too was filled in by today's merge.
insert into not_copied
select id, field, value, coalesce(reason, 'no place in the new database')
from unplaced v
where merged_into is null or not exists (select from unplaced w
	where w.record_id = v.record_id and w.merged_into is null and (w.field, w.value) = (v.field, v.value));

-- Revisit every vendor copied, now or before, merged-away ones too, since its deals may be copied after it.
create temp table evidence on commit drop as
select v.id as vendor_id, map.party_id, coalesce(case v.category_slug when 'gc' then 'contractor' else v.category_slug end,
	'vendor') as role, v.updated_at, e.deal_id as old_deal_id, e.role as kind, e.occurred_at, e.evidence_ref, deal.deal_id,
	client.party_id as client_id, author.*
from public.vendor v
join outside_id map on map.source = 'old_system' and map.value = v.id::text
cross join lateral jsonb_to_recordset(v.deal_evidence) as e (deal_id uuid, role text, occurred_at timestamptz, evidence_ref text)
left join outside_id deal on deal.source = 'old_system' and deal.value = e.deal_id::text
left join public.deal old on old.id = e.deal_id
left join public.client c on c.id = old.client_id
left join outside_id client on client.source = 'old_system' and client.value = c.party_id::text
cross join lateral copy_attribution('vendor', v.id, v.updated_by, 'deal_evidence') author;

-- A worked deal is the vendor on the deal in its category, or as a vendor when it has none.
insert into deal_party (deal_id, party_id, role, created_at, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select distinct on (deal_id, party_id, role) deal_id, party_id, role, updated_at, changed_by_user_id, changed_by_job,
	changed_for_user_id, updated_at
from evidence e
where kind = 'worked' and deal_id is not null
	and not exists (select from deal_party p where (p.deal_id, p.party_id, p.role) = (e.deal_id, e.party_id, e.role))
order by deal_id, party_id, role, vendor_id;

-- Each introduction today, with the vendor, maker and party it introduced it can be told to have.
-- A referral on a deal brought that deal's client, as today's referral binding checks, and stands for its link.
create temp table typed_introduction on commit drop as
select l.*, made.vendor_id, made.user_id, introduced.party_id as introduced_party_id, introduced.count, case
	when made.ends_copied < made.ends or not made.via_copied then 'a party it links is not copied'
	when made.via_copied is null then 'who made it is not recorded'
	when made.vendor_id is null and made.user_id is null then 'made by neither a copied vendor nor a user'
	when made.vendor_id is null then 'no single copied vendor on either side'
	when introduced.count <> 1 then 'whom it introduced cannot be told'
	when l.old_deal_id is not null and l.deal_id is null then 'its deal is not copied'
end as reason
from (
	select l.id, l.id as old_id, 'party_link' as field, l.kind as value, l.from_party, l.to_party, l.via_party, l.occurred_on, l.note,
		l.created_at, l.created_by, null::uuid as old_deal_id, null::uuid as deal_id
	from public.party_link l
	where l.kind in ('introduced', 'referred', 'intro', 'intro_received', 'referral')
		and not exists (select from public.party_link_deal d where d.link_id = l.id)
	union all
	select md5(d.link_id::text || d.deal_id::text)::uuid, d.link_id, 'party_link_deal', d.deal_id::text, null, l.to_party, d.referred_by,
		d.occurred_on, d.note, d.created_at, d.created_by, d.deal_id, deal.deal_id
	from public.party_link_deal d
	join public.party_link l on l.id = d.link_id
	left join outside_id deal on deal.source = 'old_system' and deal.value = d.deal_id::text
) as l
left join outside_id via on via.source = 'old_system' and via.value = l.via_party::text
cross join lateral (
	select count(e.party_id) as ends_copied, count(*) as ends,
		case when l.via_party is not null then via.party_id is not null end as via_copied,
		case when exists (select from party_role where party_id = via.party_id and role = 'vendor') then via.party_id
			when exists (select from app_user where id = via.party_id) and count(e.party_id) filter (where e.vendor) = 1
				then (array_agg(e.party_id) filter (where e.vendor))[1] end as vendor_id,
		case when exists (select from app_user where id = via.party_id)
			and not exists (select from party_role where party_id = via.party_id and role = 'vendor') then via.party_id end as user_id
	from unnest(array[l.from_party, l.to_party]) as old (id)
	left join lateral (select map.party_id, exists (select from party_role where party_id = map.party_id and role = 'vendor') as vendor
		from outside_id map where map.source = 'old_system' and map.value = old.id::text) as e on true
	where old.id is not null
) as made
cross join lateral (
	select count(*), min(map.party_id::text)::uuid as party_id
	from unnest(array[l.from_party, l.to_party]) as old (id)
	join outside_id map on map.source = 'old_system' and map.value = old.id::text
	where map.party_id <> made.vendor_id and map.party_id is distinct from made.user_id
		and map.party_id not in (select id from app_user)
) as introduced
where not exists (select from introduction i where i.id = l.id);

insert into introduction (id, created_at, vendor_id, made_by, introduced_by_user_id, introduced_party_id, introduced_on,
	deal_id, note, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select i.id, i.created_at, i.vendor_id, case when i.user_id is null then 'vendor' else 'team' end, i.user_id,
	i.introduced_party_id, i.occurred_on, i.deal_id, nullif(regexp_replace(i.note, '^\s+|\s+$', '', 'g'), ''), a.changed_by_user_id, a.changed_by_job,
	a.changed_for_user_id, i.created_at
from typed_introduction i cross join lateral copy_attribution('party_link', i.id, i.created_by) a
where i.reason is null;

insert into not_copied select old_id, field, value, reason from typed_introduction where reason is not null;

-- A referred deal in a vendor's evidence is an introduction of the deal's client, made by the vendor, unless a referral
-- on that deal already is.
insert into introduction (id, created_at, vendor_id, made_by, introduced_party_id, introduced_on, deal_id, note,
	changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select distinct on (vendor_id, deal_id) md5(vendor_id::text || old_deal_id::text)::uuid, updated_at, party_id, 'vendor',
	client_id, (occurred_at at time zone 'America/Chicago')::date, deal_id, nullif(regexp_replace(evidence_ref, '^\s+|\s+$', '', 'g'), ''),
	changed_by_user_id, changed_by_job, changed_for_user_id, updated_at
from evidence e
where kind = 'referred' and deal_id is not null and client_id <> party_id
	and not exists (select from introduction i where (i.vendor_id, i.deal_id, i.made_by) = (e.party_id, e.deal_id, 'vendor'))
order by vendor_id, deal_id, occurred_at;

insert into not_copied
select vendor_id, 'deal_evidence', concat_ws(' ', kind, old_deal_id), case
	when coalesce(kind, '') not in ('worked', 'referred') then 'neither worked nor referred'
	when deal_id is null then 'its deal is not copied'
	when client_id is null then 'its deal''s client is not copied'
	else 'its deal''s client is the vendor' end
from evidence e
where coalesce(kind, '') not in ('worked', 'referred') or kind = 'worked' and deal_id is null
	or kind = 'referred'
		and not exists (select from introduction i where (i.vendor_id, i.deal_id, i.made_by) = (e.party_id, e.deal_id, 'vendor'));

-- A category waits on its vendor role, checked now, because a table with checks waiting cannot be altered.
set constraints all immediate;
alter table party_role enable trigger stamp_change;
alter table deal_party enable trigger stamp_change;
alter table introduction enable trigger stamp_change;

select * from not_copied order by old_id, field, value;
