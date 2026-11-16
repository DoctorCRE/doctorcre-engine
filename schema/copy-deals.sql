-- Load copy-attribution.sql after next.sql first. Run after copy-parties.sql, in a separate transaction, with search_path set to the new schema.
-- Only reads public. Existing old_system deal maps make a repeat run leave copied deals alone.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table deal disable trigger stamp_change;
alter table deal_party disable trigger stamp_change;
alter table deal_phase_change disable trigger stamp_change;
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;
insert into deal_kind (slug, label) values ('lease', 'Lease'), ('purchase', 'Purchase'),
 ('sale_leaseback', 'Sale-leaseback'), ('build_to_suit', 'Build-to-suit') on conflict do nothing;
insert into deal_reason (slug, label) values ('start_up', 'Start-up'), ('relocation', 'Relocation'),
 ('expansion', 'Expansion'), ('renewal', 'Renewal'), ('additional_office', 'Additional office') on conflict do nothing;
insert into role (slug, label) values ('client', 'Client') on conflict do nothing;
insert into role (slug, label)
select case slug when 'listing_side' then 'listing_agent' when 'landlord_side' then 'property_owner' else slug end, label
from public.participant_role where slug in ('client', 'client_contact', 'support', 'referring_agent', 'listing_side', 'landlord_side', 'investor', 'capital_partner') on conflict do nothing;
insert into phase (slug, label) select slug, label from public.deal_phase on conflict do nothing;
insert into phase (slug, label) values ('dead', 'Dead') on conflict do nothing;

create temp table old_deal on commit drop as
select d.*, u.id as owner_user_id, m.id as market_id,
 coalesce(nullif(btrim(d.city), ''), nullif(btrim(a.market), '')) as typed_market,
 author.*
from public.deal d
left join public.deal_market_assignment a on a.deal_id = d.id and d.lane = 'national'
left join market m on m.name = coalesce(nullif(btrim(d.city), ''), nullif(btrim(a.market), ''))
left join public.actor owner on owner.slug = d.owner or (d.owner is null and (d.phase = 'closed' or d.outcome = 'lost')
 and owner.id = (select p.actor_id from public.deal_participant p where p.deal_id = d.id and p.role = 'lead'
 and p.to_at is null and p.actor_id is not null
 and 1 = (select count(*) from public.deal_participant q where q.deal_id = d.id and q.role = 'lead' and q.to_at is null)))
left join outside_id owner_map on owner_map.source = 'old_system' and owner_map.value = owner.id::text
left join app_user u on u.id = owner_map.party_id
cross join lateral copy_attribution('deal', d.id, coalesce(d.updated_by, d.created_by)) author
where not exists (select from outside_id o where o.source = 'old_system' and o.value = d.id::text);
insert into not_copied select id, 'deal', id::text, 'no_deal_owner' from old_deal where owner_user_id is null;
insert into deal (id, created_at, name, kind, reason, owner_user_id, market_id, closed_value,
 changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select id, created_at, name, (select slug from deal_kind where slug = deal_type),
 (select slug from deal_reason where slug = case deal_type when 'startup' then 'start_up' else deal_type end),
 owner_user_id, market_id, case when won_value > 0 then won_value end,
 changed_by_user_id, changed_by_job, changed_for_user_id, updated_at from old_deal where owner_user_id is not null;
insert into outside_id (source, value, deal_id)
select 'old_system', d.id::text, d.id from old_deal d join deal n on n.id = d.id;
insert into not_copied
select d.id, f.field, f.value, f.reason from old_deal d join deal n on n.id = d.id
cross join lateral (values
 ('deal_type', d.deal_type, 'unfiled_deal_type', d.deal_type not in (select slug from deal_kind)
  and d.deal_type not in (select slug from deal_reason) and d.deal_type <> 'startup'),
 ('market', d.typed_market, 'unknown_market', d.typed_market is not null and d.market_id is null),
 ('won_value', d.won_value::text, 'nonpositive_value', d.won_value <= 0)) f(field, value, reason, refused)
where f.refused;

create temp table old_link on commit drop as
select d.id as deal_id, d.client_id as old_id, c.party_id, 'client' as role, false as vendor_role, d.created_at, d.updated_at,
 a.*
from public.deal d join public.client c on c.id = d.client_id cross join lateral copy_attribution('deal', d.id, coalesce(d.updated_by, d.created_by)) a
union all
select p.deal_id, p.id, coalesce(p.party_id, p.actor_id),
 case p.role when 'listing_side' then 'listing_agent' when 'landlord_side' then 'property_owner' else p.role end, p.role in ('lender', 'attorney', 'other_vendor'), p.from_at, p.from_at,
 a.*
from public.deal_participant p cross join lateral copy_attribution('deal_participant', p.id, p.set_by) a where p.role <> 'lead' and p.to_at is null
union all
select v.deal_id, v.party_id, v.party_id, v.role, true, v.updated_at, v.updated_at,
 a.*
from public.deal_vendor_assignment v cross join lateral copy_attribution('deal', v.deal_id, v.updated_by) a where v.active;
create temp table mapped_link on commit drop as
select l.*, m.party_id as mapped_party_id, r.slug from old_link l
left join outside_id m on m.source = 'old_system' and m.value = l.party_id::text
left join role r on r.slug = l.role and (not l.vendor_role or r.category_of = 'vendor')
 and (l.role <> 'client' or exists (select from party_role pr where pr.party_id = m.party_id and pr.role = 'client'));
insert into deal_party (deal_id, party_id, role, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select distinct on (l.deal_id, l.mapped_party_id, l.role) l.deal_id, l.mapped_party_id, l.role,
 l.created_at, l.updated_at, l.changed_by_user_id, l.changed_by_job, l.changed_for_user_id from mapped_link l join deal d on d.id = l.deal_id
where l.mapped_party_id is not null and l.slug is not null
 and not exists (select from deal_party p where (p.deal_id, p.party_id, p.role) = (l.deal_id, l.mapped_party_id, l.role))
order by l.deal_id, l.mapped_party_id, l.role, l.created_at, l.old_id;
insert into not_copied
select l.old_id, 'deal_party', concat_ws(' ', l.deal_id, l.party_id, l.role), case when d.id is null then 'deal_not_copied'
 when l.mapped_party_id is null then 'party_not_copied' when l.role = 'client' then 'client_role_not_available' else 'role_not_available' end
from mapped_link l left join deal d on d.id = l.deal_id
where d.id is null or l.mapped_party_id is null or l.slug is null;
insert into not_copied select id, 'deal_participant', role, 'ended_participant_history'
from public.deal_participant where to_at is not null;

create temp table old_phase on commit drop as
select e.id as old_id, e.subject_id as deal_id, e.occurred_at as happened_at, case when e.field = 'outcome' then 'dead' else e.new_value ->> 'phase' end as phase,
 coalesce(nullif(e.human_quote, ''), nullif(e.agent_rationale, '')) as reason,
 a.changed_by_user_id, job.slug as changed_by_job,
 case when job.slug in ('agent', 'mail_capture') then sponsor.id end as changed_for_user_id
-- History takes its own event's cause and sponsor, rather than a later change to the same deal.
from public.event e cross join lateral copy_attribution('event', e.id, e.actor_id) a
left join public.actor actor on actor.id = e.actor_id
cross join lateral (select case when a.changed_by_job = 'old_system' and actor.kind = 'automation'
 and e.cause = 'ingest_email' then 'mail_capture' else a.changed_by_job end as slug) job
left join public.actor sponsor on sponsor.slug = e.sponsoring_human_slug and sponsor.kind = 'human' where e.subject_type = 'deal' and (e.field = 'phase' and e.old_value ->> 'phase' is distinct from e.new_value ->> 'phase'
 or e.field = 'outcome' and e.new_value ->> 'outcome' = 'lost');
insert into not_copied select d.id, 'phase', d.phase, 'no_phase_history' from public.deal d
where not exists (select from public.event e where e.subject_type = 'deal' and e.subject_id = d.id and e.field = 'phase');
create temp table mapped_phase on commit drop as
select p.*, case when d.id is null then 'deal_not_copied' when f.slug is null then 'unknown_phase'
 when exists (select from deal_phase_change c where (c.deal_id, c.happened_at) = (p.deal_id, p.happened_at) and (c.phase, c.reason) is distinct from (p.phase, p.reason)) then 'existing_phase_conflict'
 when p.phase = 'dead' and p.reason is null then 'dead_without_reason'
 when count(*) over (partition by p.deal_id, p.happened_at) > 1 then 'same_time_phase_changes' end as refusal
from old_phase p left join deal d on d.id = p.deal_id left join phase f on f.slug = p.phase;
insert into deal_phase_change (deal_id, happened_at, phase, reason, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select p.deal_id, p.happened_at, p.phase, p.reason, p.changed_by_user_id, p.changed_by_job, p.changed_for_user_id, p.happened_at
from mapped_phase p where refusal is null
 and not exists (select from deal_phase_change c where (c.deal_id, c.happened_at) = (p.deal_id, p.happened_at));
insert into not_copied select old_id, 'phase', phase, refusal from mapped_phase where refusal is not null;
insert into not_copied
select d.id, 'phase', d.phase, case when d.outcome = 'lost' then 'lost_without_dated_reason' else 'current_phase_differs' end
from public.deal d join deal n on n.id = d.id
where (d.outcome = 'lost' or exists (select from deal_phase_change c where c.deal_id = d.id))
 and (select c.phase from deal_phase_change c where c.deal_id = d.id order by happened_at desc limit 1)
 is distinct from case when d.outcome = 'lost' then 'dead' else d.phase end;


-- Source properties are buildings reached through the deal's premises and spaces. Several suites in one building are one.
create temp table round_mapping on commit drop as
select r.*, row_number() over (partition by r.deal_id order by r.created_at, r.id) as new_round,
 (select count(distinct s.building_id) from public.premises p join public.premises_space ps on ps.premises_id = p.id
 join public.space s on s.id = ps.space_id where p.deal_id = r.deal_id) as properties,
 (select count(distinct p.party_id) from deal_party p where p.deal_id = r.deal_id and
  (r.side in ('tenant', 'buyer') and p.role = 'client' or r.side in ('landlord', 'seller')
   and p.role in ('landlord', 'property_owner', 'listing_agent'))) as senders
from public.negotiation_round r;
insert into not_copied
select r.id, 'negotiation_round', jsonb_build_object('side', r.side, 'round_no', r.round_no, 'new_round', r.new_round)::text,
 f.reason from round_mapping r cross join lateral (values
 ('deal_not_copied', not exists (select from deal d where d.id = r.deal_id)),
 ('no_sender_candidate', r.senders = 0), ('several_sender_candidates', r.senders > 1),
 ('no_property', r.properties = 0), ('several_properties', r.properties > 1),
 ('unknown_offer_status', r.senders = 1 and r.properties = 1 and exists (select from deal d where d.id = r.deal_id))) f(reason, refused)
where f.refused and (f.reason = 'deal_not_copied' or exists (select from deal d where d.id = r.deal_id));
set constraints all immediate;
alter table deal enable trigger stamp_change;
alter table deal_party enable trigger stamp_change;
alter table deal_phase_change enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
