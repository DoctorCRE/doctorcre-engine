-- Run after copy-parties.sql and copy-attribution.sql in one owner transaction in the new schema.
-- The owner supplies exact free-text source mappings in pg_temp.copy_how_found before running this file.
create temp table if not exists copy_how_found (old_type text, source text, how_found text,
 primary key (old_type, source)) on commit drop;
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
do $$ declare t text; begin
 foreach t in array array['party', 'party_role', 'client', 'national_account', 'activity', 'activity_about', 'next_step'] loop
  execute format('alter table %I disable trigger stamp_change', t);
 end loop;
end $$;
alter table party_role disable trigger lead_stage_needs_evidence;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;
insert into role (slug, label) values ('lead', 'Lead'), ('client', 'Client'), ('national_account', 'National account') on conflict do nothing;
insert into how_found (slug, label) values ('referral', 'Referral'), ('vendor', 'Vendor'),
 ('marketing_post', 'Marketing post'), ('public_records', 'Public records'), ('cold_outreach', 'Cold outreach') on conflict do nothing;
insert into stage (role, slug, label) select 'lead', s, initcap(replace(s, '_', ' '))
from unnest(array['new','qualified','outreach_active','engaged','nurture','opportunity','archived']) s on conflict do nothing;
insert into lead_lane (slug, label) select slug, label from public.lead_lane on conflict do nothing;
insert into client_type (slug, label) values ('independent', 'Independent'), ('group_practice', 'Group practice'),
 ('dso', 'DSO'), ('franchise', 'Franchise'), ('regional_system', 'Regional system') on conflict do nothing;

create temp table old_relationship on commit drop as
select r.*, m.party_id as mapped_id, a.*,
 row_number() over (partition by m.party_id, r.kind order by r.updated_at desc, r.id) as rank,
 min(r.created_at) over (partition by m.party_id, r.kind) as first_created,
 count(*) over (partition by m.party_id, r.kind) as copies
from (
 select 'lead' as kind, l.id, l.party_id, l.created_at, l.updated_at, coalesce(l.updated_by, l.created_by) as author,
  to_jsonb(l) as fields from public.lead l
 union all
 select 'client', c.id, c.party_id, c.created_at, c.updated_at, coalesce(c.updated_by, c.created_by), to_jsonb(c)
 from public.client c where c.merged_into is null
) r left join outside_id m on m.source = 'old_system' and m.value = r.party_id::text
cross join lateral copy_attribution(r.kind, r.id, r.author) a;
create temp table relationship_source on commit drop as
select r.*, case when kind = 'client' then fields ->> 'acquisition_source' when fields ->> 'source_type' = 'prospect-pool' then (
 select case when count(*) = 1 then min(source) end from public.candidate_pool where promoted_lead_id = r.id)
 else fields ->> 'source_type' end as typed_source,
 case when kind = 'client' then 'client' when fields ->> 'source_type' = 'prospect-pool' then 'candidate_pool' else 'lead' end as source_kind
from old_relationship r;
create temp table mapped_source on commit drop as
select r.*, f.slug as mapped_source from relationship_source r
left join pg_temp.copy_how_found h on h.old_type = r.source_kind and h.source = r.typed_source
left join how_found f on f.slug = h.how_found;
insert into not_copied select id, 'how_found', typed_source, 'source_needs_mapping'
from mapped_source where mapped_source is null;
insert into not_copied select id, kind, party_id::text,
 case when mapped_id is null then 'party_not_copied' else 'several_records_on_one_party' end
from old_relationship where mapped_id is null or copies > 1;
insert into not_copied
select s.id, 'how_found', s.typed_source, 'sources_disagree' from mapped_source s
where exists (select from mapped_source other where other.mapped_id = s.mapped_id
 and other.mapped_source is distinct from s.mapped_source);

-- Client testimony takes precedence; an existing mapped fact is never overwritten.
update party p set how_found = s.mapped_source, how_found_detail = coalesce(nullif(btrim(s.fields ->> 'acquisition_detail'), ''),
 (select nullif(btrim(l.fields ->> 'source_detail'), '') from mapped_source l
  where l.mapped_id = s.mapped_id and l.kind = 'lead' and l.mapped_source = s.mapped_source and l.fields ->> 'source_detail' ~ '\S'
  order by l.updated_at desc, l.id limit 1)),
 changed_by_user_id = case when s.updated_at > p.changed_at then s.changed_by_user_id else p.changed_by_user_id end,
 changed_by_job = case when s.updated_at > p.changed_at then s.changed_by_job else p.changed_by_job end,
 changed_for_user_id = case when s.updated_at > p.changed_at then s.changed_for_user_id else p.changed_for_user_id end,
 changed_at = greatest(p.changed_at, s.updated_at)
from (select distinct on (mapped_id) * from mapped_source where mapped_source is not null
 order by mapped_id, kind = 'client' desc, updated_at desc, id) s
where p.id = s.mapped_id and p.how_found is null;
insert into not_copied select s.id, 'how_found', s.typed_source, 'existing_source_differs'
from mapped_source s join party p on p.id = s.mapped_id
where s.mapped_source is not null and p.how_found is distinct from s.mapped_source;
create temp table examined_relationship on commit drop as
select r.*, p.how_found, p.how_found_detail,
 case fields ->> 'client_type' when 'group' then 'group_practice' else fields ->> 'client_type' end as mapped_type,
 case when (fields ->> 'suppressed')::boolean or fields ->> 'stage' = 'do_not_contact' then 'archived'
 when fields ->> 'stage' in ('nurture_drip','closed_lost') then 'nurture'
 when fields ->> 'stage' in ('active_deal','closed_won') then 'opportunity' else fields ->> 'stage' end as mapped_stage,
 u.id as owner, coalesce(nullif(btrim(fields ->> 'event_source'), ''),
 (select case when count(*) = 1 then min(nullif(btrim(est_basis), '')) end
  from public.candidate_pool where promoted_lead_id = r.id)) as estimate_source
from old_relationship r join party p on p.id = r.mapped_id
left join outside_id o on o.source = 'old_system' and o.value = r.fields ->> 'owner_id'
left join app_user u on u.id = o.party_id
;
create temp table classified_relationship on commit drop as
select r.*, case
 when how_found is null then 'source_needs_mapping'
 when kind = 'lead' and not exists (select from stage where role = 'lead' and slug = mapped_stage) then 'unknown_stage'
 when kind = 'client' and coalesce(fields ->> 'status', '') not in ('roster','cold','engaged','paused','active_deal','past_client') then 'unknown_client_status'
 when kind = 'client' and mapped_type is not null and mapped_type <> 'national_account'
  and not exists (select from client_type where slug = mapped_type) then 'unknown_client_type'
 when mapped_type = 'national_account' and not exists (select from party where id = mapped_id and kind = 'company') then 'national_account_needs_company'
 end as refusal from examined_relationship r;
create temp table ready_relationship on commit drop as
select r.* from classified_relationship r where refusal is null
 and exists (select from classified_relationship latest where latest.mapped_id = r.mapped_id
  and latest.kind = r.kind and latest.rank = 1 and latest.refusal is null)
 and not exists (select from outside_id done where done.source = 'old_system' and done.value = r.id::text);
insert into party_role (party_id, role, stage, owner_user_id, lane, segment,
 estimated_lease_on, lease_estimate_source, lease_estimate_confidence,
 created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select mapped_id, kind, case when kind = 'lead' then mapped_stage end, case when kind = 'lead' then owner end,
 (select slug from lead_lane where slug = fields ->> 'lane'), nullif(btrim(fields ->> 'segment'), ''),
 case when estimate_source is not null then (fields ->> 'est_lease_event')::date end,
 case when fields ->> 'est_lease_event' is not null then estimate_source end,
 case when estimate_source is not null and fields ->> 'est_lease_event' is not null
 and fields ->> 'event_confidence' in ('high','medium','low') then fields ->> 'event_confidence' end,
 first_created, updated_at, changed_by_user_id, changed_by_job, changed_for_user_id
from ready_relationship r where rank = 1
on conflict do nothing;
insert into client (party_id, status, client_type, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select mapped_id, case when fields ->> 'status' in ('roster','cold','engaged','paused') then fields ->> 'status' else 'roster' end,
 (select slug from client_type where slug = mapped_type), first_created, updated_at,
 changed_by_user_id, changed_by_job, changed_for_user_id from ready_relationship where kind = 'client' and rank = 1 on conflict do nothing;
insert into party_role (party_id, role, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select r.mapped_id, 'national_account', r.first_created, r.updated_at, r.changed_by_user_id, r.changed_by_job, r.changed_for_user_id
from ready_relationship r join party p on p.id = r.mapped_id
where r.rank = 1 and r.kind = 'client' and r.fields ->> 'client_type' = 'national_account' and p.kind = 'company' on conflict do nothing;
insert into national_account (party_id, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select r.mapped_id, r.first_created, r.updated_at, r.changed_by_user_id, r.changed_by_job, r.changed_for_user_id
from ready_relationship r join party_role pr on pr.party_id = r.mapped_id and pr.role = 'national_account'
where r.rank = 1 and r.kind = 'client' and r.fields ->> 'client_type' = 'national_account' on conflict do nothing;
insert into not_copied
select r.id, f.field, f.value, f.reason from classified_relationship r
cross join lateral (values
 ('stage', fields ->> 'stage', 'unknown_stage', kind = 'lead' and not exists (select from stage where role = 'lead' and slug = mapped_stage)),
 ('do_not_contact', fields ->> 'stage', 'restriction_needs_reason', kind = 'lead' and ((fields ->> 'suppressed')::boolean or fields ->> 'stage' = 'do_not_contact')),
 ('owner_id', fields ->> 'owner_id', 'owner_not_a_user', fields ->> 'owner_id' is not null and owner is null),
 ('owner_id', fields ->> 'owner_id', 'client_owner_has_no_target', kind = 'client' and fields ->> 'owner_id' is not null),
 ('owner_label', fields ->> 'owner_label', 'owner_label_only', fields ->> 'owner_id' is null and fields ->> 'owner_label' ~ '\S'),
 ('lane', fields ->> 'lane', 'unknown_lane', fields ->> 'lane' is not null and not exists (select from lead_lane where slug = fields ->> 'lane')),
 ('segment', fields ->> 'segment', 'blank_segment', fields ->> 'segment' is not null and fields ->> 'segment' !~ '\S'),
 ('est_lease_event', fields ->> 'est_lease_event', 'estimate_needs_source', fields ->> 'est_lease_event' is not null and estimate_source is null),
 ('event_source', fields ->> 'event_source', 'source_without_estimate', fields ->> 'event_source' is not null and fields ->> 'est_lease_event' is null),
 ('event_confidence', fields ->> 'event_confidence', 'invalid_or_unsourced_confidence', fields ->> 'event_confidence' is not null and
  (fields ->> 'est_lease_event' is null or estimate_source is null or fields ->> 'event_confidence' not in ('high','medium','low'))),
 ('est_lease_event_raw', fields ->> 'est_lease_event_raw', 'unparsed_estimate', fields ->> 'est_lease_event_raw' ~ '\S'),
 ('notes_path', fields ->> 'notes_path', 'file_not_copied', fields ->> 'notes_path' ~ '\S'),
 ('last_touch', fields ->> 'last_touch', 'contact_activity_copy_required', fields ->> 'last_touch' is not null),
 ('client_type', fields ->> 'client_type', 'unknown_client_type', kind = 'client' and fields ->> 'client_type' is not null
  and fields ->> 'client_type' <> 'national_account' and not exists (select from client_type where slug = mapped_type)),
 ('client_type', fields ->> 'client_type', 'national_account_needs_company', fields ->> 'client_type' = 'national_account' and not exists (select from party where id = mapped_id and kind = 'company')),
 ('status', fields ->> 'status', 'unknown_client_status', kind = 'client' and coalesce(fields ->> 'status', '') not in ('roster','cold','engaged','paused','active_deal','past_client'))
) f(field, value, reason, refused) where f.refused;

create temp table relationship_note on commit drop as
select r.*, md5('old_system:' || kind || ':' || id || ':' || n.field)::uuid as activity_id, n.text
from ready_relationship r cross join lateral (values ('notes', fields ->> 'notes'),
 ('source_detail', case when kind = 'lead' and nullif(btrim(fields ->> 'source_detail'), '') is distinct from how_found_detail then fields ->> 'source_detail' end)) n(field, text)
where n.text ~ '\S';
insert into activity (id, kind, happened_at, summary, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select activity_id, 'note', updated_at, text, updated_at, changed_by_user_id, changed_by_job, changed_for_user_id
from relationship_note on conflict do nothing;
insert into activity_about (activity_id, party_id, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select activity_id, mapped_id, updated_at, updated_at, changed_by_user_id, changed_by_job, changed_for_user_id
from relationship_note on conflict do nothing;
insert into next_step (id, party_id, what, due_on, owner_party_id, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select md5('old_system:lead:' || id || ':follow_up')::uuid, mapped_id, 'Imported lead follow-up',
 (fields ->> 'next_action_date')::date, owner, created_at, updated_at, changed_by_user_id, changed_by_job, changed_for_user_id
from ready_relationship where kind = 'lead' and fields ->> 'next_action_date' is not null on conflict do nothing;
insert into outside_id (source, value, party_id)
select 'old_system', r.id::text, r.mapped_id from ready_relationship r
join party_role pr on pr.party_id = r.mapped_id and pr.role = r.kind
where (r.kind = 'lead' or exists (select from client c where c.party_id = r.mapped_id))
 and not exists (select from outside_id o where o.source = 'old_system' and o.value = r.id::text);

-- Neither today's org_id nor set_at establishes when brand membership or account ownership began.
insert into not_copied select c.id, 'org_id', p.org_id::text, 'brand_start_date_required'
from public.client c join public.party p on p.id = c.party_id where c.merged_into is null and p.kind = 'org' and p.org_id is not null;
insert into not_copied select account_client_id, 'national_account_owner', owner_actor_id::text, 'owner_start_date_required'
from public.national_account_owner;
insert into not_copied select id, 'client', merged_into::text, 'merged_client' from public.client where merged_into is not null;
insert into not_copied select id, 'candidate_pool', status, 'later_copy_334' from public.candidate_pool;
insert into not_copied select id, 'lead_contact_draft', lead_id::text, 'later_copy_334' from public.lead_contact_draft;
insert into not_copied select id, 'lead_stage_move', lead_id::text, 'later_copy_335' from public.lead_stage_move;
set constraints all immediate;
do $$ declare t text; begin
 foreach t in array array['party', 'party_role', 'client', 'national_account', 'activity', 'activity_about', 'next_step'] loop
  execute format('alter table %I enable trigger stamp_change', t);
 end loop;
end $$;
alter table party_role enable trigger lead_stage_needs_evidence;
select * from not_copied order by old_id, field, value, reason;
