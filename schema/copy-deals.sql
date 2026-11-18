-- Load copy-attribution.sql after next.sql first. Run after copy-parties.sql, in a separate transaction, with search_path set to the new schema.
-- Only reads public. Existing old_system deal maps make a repeat run leave copied deals alone.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
-- Historical parking and flags keep their source author rather than inventing an acting user.
alter table deal disable trigger stamp_change, disable trigger deal_parked_or_flagged_by_a_user;
alter table deal_party disable trigger stamp_change;
alter table deal_phase_change disable trigger stamp_change;
alter table property disable trigger stamp_change;
alter table deal_property disable trigger stamp_change;
alter table offer disable trigger stamp_change;
alter table offer_claim disable trigger stamp_change;
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;
insert into deal_kind (slug, label) values ('lease', 'Lease'), ('purchase', 'Purchase'),
 ('sale_leaseback', 'Sale-leaseback'), ('build_to_suit', 'Build-to-suit'), ('other', 'Other') on conflict do nothing;
insert into deal_reason (slug, label) values ('start_up', 'Start-up'), ('relocation', 'Relocation'),
 ('expansion', 'Expansion'), ('renewal', 'Renewal'), ('additional_office', 'Additional office') on conflict do nothing;
insert into role (slug, label) values ('client', 'Client'), ('market_agent', 'Market agent') on conflict do nothing;
insert into role (slug, label)
select case slug when 'listing_side' then 'listing_agent' when 'landlord_side' then 'property_owner' else slug end, label
from public.participant_role where slug in ('client', 'client_contact', 'support', 'referring_agent', 'listing_side', 'landlord_side', 'investor', 'capital_partner') on conflict do nothing;
insert into phase (slug, label) select slug, label from public.deal_phase on conflict do nothing;
insert into phase (slug, label) values ('dead', 'Dead') on conflict do nothing;

create temp table old_deal on commit drop as
select d.*, u.id as owner_user_id, m.id as market_id, parker.id as parked_by_user_id,
 coalesce(nullif(btrim(d.city), ''), nullif(btrim(a.market), '')) as typed_market,
 exists (select from outside_id o where o.source = 'old_system' and o.value = d.id::text) as copied_before,
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
left join outside_id parker_map on parker_map.source = 'old_system' and parker_map.value = d.parked_by::text
left join app_user parker on parker.id = parker_map.party_id
cross join lateral copy_attribution('deal', d.id, coalesce(d.updated_by, d.created_by)) author;
insert into not_copied select id, 'deal', id::text, 'no_deal_owner' from old_deal where owner_user_id is null and not copied_before;
insert into deal (id, created_at, name, kind, reason, owner_user_id, market_id, closed_value,
 parking_reason, parking_note, needs_attention, parked_at, parked_by_user_id,
 changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select id, created_at, name, (select slug from deal_kind where slug = deal_type),
 (select slug from deal_reason where slug = case deal_type when 'startup' then 'start_up' when 'renewal' then null else deal_type end),
 owner_user_id, market_id, case when won_value > 0 then won_value end,
 case when operating_state = 'parked' then parking_reason end,
 case when operating_state = 'parked' then nullif(regexp_replace(parking_note, '^\s+|\s+$', '', 'g'), '') end, attention,
 case when operating_state = 'parked' then parked_at end, case when operating_state = 'parked' then parked_by_user_id end,
 changed_by_user_id, changed_by_job, changed_for_user_id, updated_at from old_deal where owner_user_id is not null and not copied_before;
insert into outside_id (source, value, deal_id)
select 'old_system', d.id::text, d.id from old_deal d join deal n on n.id = d.id where not d.copied_before;
insert into imported_deal_invoiced (deal_id, invoiced_on)
select d.id, d.invoiced_on from old_deal d join deal n on n.id = d.id where d.invoiced_on is not null on conflict do nothing;
create temp table deal_outside_id on commit drop as
select r.entity_id as old_id, concat_ws(' ', r.source_system, r.external_key) as typed, k.source, k.value, m.deal_id
from public.record_source r cross join lateral copy_outside_id(r.source_system, r.external_key) k
left join outside_id m on m.source = 'old_system' and m.value = r.entity_id::text
where r.entity_type = 'deal';
create temp table deal_outside_id_refusal on commit drop as
select v.*, case
 when source = 'dup_candidate' then 'a hint of a duplicate, not an id'
 when deal_id is null then 'its record is not copied'
 when source in ('old_system', 'old_system_ref') then 'a source the copy keeps for itself'
 when source !~ '^[a-z][a-z0-9_]*$' or value !~ '\S' then 'not an outside id'
 when (select count(distinct c.deal_id) from deal_outside_id c where (c.source, c.value) = (v.source, v.value)) > 1
 then 'several deals claim this outside id'
 when exists (select from outside_id o where (o.source, o.value) = (v.source, v.value) and o.deal_id is distinct from v.deal_id)
 then 'another record holds this outside id'
 end as reason from deal_outside_id v;
insert into outside_id (source, value, deal_id)
select distinct source, value, deal_id from deal_outside_id_refusal v
where reason is null and not exists (select from outside_id o where (o.source, o.value) = (v.source, v.value));
insert into not_copied
select old_id, 'record_source', typed, reason from deal_outside_id_refusal where reason is not null;

-- Every run lists the leftovers of every copied deal, so the list a partner fixes stays whole.
insert into not_copied
select d.id, f.field, f.value, f.reason from old_deal d join deal n on n.id = d.id
cross join lateral (values
 ('deal_type', d.deal_type, 'renewal_without_lease', d.deal_type = 'renewal'),
 ('market', d.typed_market, 'unknown_market', d.typed_market is not null and n.market_id is null),
 ('won_value', d.won_value::text, 'nonpositive_value', d.won_value is not null and n.closed_value is null)) f(field, value, reason, refused)
where f.refused;

-- Only a copy leaves a parked deal without its parker; the engine's own parking always names one.
insert into not_copied
select d.id, 'parked_by', d.parked_by::text, 'parker_not_a_user' from public.deal d join deal n on n.id = d.id
where n.parked_at is not null and n.parked_by_user_id is null;

-- Lane is not copied: national follows from the location's brand membership on the day the deal opened.
insert into not_copied
select d.id, 'lane', d.lane, case when answer.unreviewed then 'brand_dates_not_reviewed' else 'lane_disagrees_with_account' end
from public.deal d join deal n on n.id = d.id
join public.client c on c.id = d.client_id join public.party p on p.id = c.party_id
join outside_id m on m.source = 'old_system' and m.value = p.id::text
cross join lateral (select p.kind = 'org' and p.org_id is not null
 and not exists (select from client_brand b where b.location_id = m.party_id) as unreviewed,
 exists (select from client_brand b join national_account a on a.party_id = b.brand_id where b.location_id = m.party_id
 and daterange(b.started_on, b.ended_on) @> (n.created_at at time zone 'America/Chicago')::date) as national) answer
where d.lane is not null and (answer.unreviewed or (d.lane = 'national') <> answer.national);

create temp table old_participant on commit drop as
select p.*, case p.role when 'listing_side' then 'listing_agent' when 'landlord_side' then 'property_owner' else p.role end as mapped_role,
 p.role in ('lender', 'attorney', 'other_vendor') as vendor_role from public.deal_participant p;

create temp table old_link on commit drop as
select d.id as deal_id, d.client_id as old_id, c.party_id, 'client' as role, false as vendor_role, d.created_at, d.updated_at,
 a.*
from public.deal d join public.client c on c.id = d.client_id cross join lateral copy_attribution('deal', d.id, coalesce(d.updated_by, d.created_by)) a
union all
select p.deal_id, p.id, coalesce(p.party_id, p.actor_id),
 p.mapped_role, p.vendor_role, p.from_at, p.from_at,
 a.*
from old_participant p cross join lateral copy_attribution('deal', p.deal_id, p.set_by) a
where p.role <> 'lead' and p.to_at is null
union all
select v.deal_id, v.party_id, v.party_id, v.role, true, v.updated_at, v.updated_at,
 a.*
from public.deal_vendor_assignment v cross join lateral copy_attribution('deal', v.deal_id, v.updated_by, 'vendor_assignment') a
where v.active
union all
select m.deal_id, m.deal_id, m.agent_party_id, 'market_agent', false, m.set_at, m.set_at,
 a.*
from public.deal_market_assignment m cross join lateral copy_attribution('deal', m.deal_id, m.set_by, 'market_agent') a
where m.agent_party_id is not null;
create temp table mapped_link on commit drop as
select l.*, m.party_id as mapped_party_id, r.slug from old_link l
left join outside_id m on m.source = 'old_system' and m.value = l.party_id::text
left join role r on r.slug = l.role and (not l.vendor_role or r.category_of = 'vendor')
 and (l.role <> 'client' or exists (select from party_role pr where pr.party_id = m.party_id and pr.role = 'client'));
-- Use the same lock as the rejoin trigger before checking existing history.
select pg_advisory_xact_lock(hashtextextended(format('deal_party %s %s %s', deal_id, mapped_party_id, role), 0))
from (select distinct deal_id, mapped_party_id, role from mapped_link
 where mapped_party_id is not null order by deal_id, mapped_party_id, role) links;
insert into not_copied
select l.old_id, 'deal_party', concat_ws(' ', l.deal_id, l.party_id, l.role), 'current_membership_overlaps_history'
from mapped_link l join deal d on d.id = l.deal_id
where l.mapped_party_id is not null and l.slug is not null
 and exists (select from imported_deal_party p where (p.deal_id, p.party_id, p.role) = (l.deal_id, l.mapped_party_id, l.role)
 and p.ended_at > l.created_at);
-- A deal has one client, so a client changed in today's system since the last copy is listed, never added beside it.
create temp table second_client on commit drop as
select l.old_id, l.deal_id, l.party_id, l.mapped_party_id from mapped_link l
where l.role = 'client' and l.slug is not null and exists (select from deal_party p
 where p.deal_id = l.deal_id and p.role = 'client' and p.party_id <> l.mapped_party_id);
insert into not_copied
select old_id, 'deal_party', concat_ws(' ', deal_id, party_id, 'client'), 'deal_has_another_client' from second_client;
insert into deal_party (deal_id, party_id, role, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select distinct on (l.deal_id, l.mapped_party_id, l.role) l.deal_id, l.mapped_party_id, l.role,
 l.created_at, l.updated_at, l.changed_by_user_id, l.changed_by_job, l.changed_for_user_id from mapped_link l join deal d on d.id = l.deal_id
where l.mapped_party_id is not null and l.slug is not null
 and not exists (select from imported_deal_party p where (p.deal_id, p.party_id, p.role) = (l.deal_id, l.mapped_party_id, l.role)
 and p.ended_at > l.created_at)
 and not exists (select from second_client c where (c.deal_id, c.mapped_party_id) = (l.deal_id, l.mapped_party_id) and l.role = 'client')
 and not exists (select from deal_party p where (p.deal_id, p.party_id, p.role) = (l.deal_id, l.mapped_party_id, l.role))
order by l.deal_id, l.mapped_party_id, l.role, l.created_at, l.old_id;
insert into not_copied
select l.old_id, 'deal_party', concat_ws(' ', l.deal_id, l.party_id, l.role), case when d.id is null then 'deal_not_copied'
 when l.mapped_party_id is null then 'party_not_copied' when l.role = 'client' then 'client_role_not_available' else 'role_not_available' end
from mapped_link l left join deal d on d.id = l.deal_id
where d.id is null or l.mapped_party_id is null or l.slug is null;
-- A stated name is never matched to a person; only a verified party link names the agent.
insert into not_copied select deal_id, 'market_agent', agent_name, 'agent_not_verified'
from public.deal_market_assignment where agent_party_id is null;
create temp table old_membership on commit drop as
select p.id, p.deal_id, m.party_id, p.role = 'lead' as owner,
 p.mapped_role as role,
 -- The bulk importer used storage time, not a known start of work.
 case when a.kind <> 'system' then p.from_at end as started_at, p.to_at as ended_at,
 case when d.id is null then 'deal_not_copied'
 when m.party_id is null then 'party_not_copied'
 when p.role = 'lead' and u.id is null then 'owner_not_a_user'
 when p.role <> 'lead' and r.slug is null then 'role_not_available' end as refusal
from old_participant p
left join deal d on d.id = p.deal_id
left join outside_id m on m.source = 'old_system' and m.value = coalesce(p.party_id, p.actor_id)::text
left join app_user u on u.id = m.party_id
left join public.actor a on a.id = p.set_by
left join role r on r.slug = p.mapped_role
 and (not p.vendor_role or r.category_of = 'vendor')
where p.to_at is not null;
do $$
declare
 p record;
 refusal text;
begin
 for p in select * from old_membership order by deal_id, party_id, role, id loop
  refusal := p.refusal;
  if refusal is null then
   if (p.owner and exists (select from imported_deal_party where id = p.id))
    or (not p.owner and exists (select from imported_deal_owner where id = p.id)) then
    refusal := 'existing_period_conflict';
   elsif p.started_at >= p.ended_at then
    refusal := 'period_ends_before_it_starts';
   elsif exists (select from old_membership q where q.id <> p.id and q.deal_id = p.deal_id
    and q.owner = p.owner and (p.owner or (q.party_id, q.role) = (p.party_id, p.role))
    and q.refusal is null
    and case when q.started_at is null or q.started_at < q.ended_at
     then tstzrange(q.started_at, q.ended_at) && tstzrange(p.started_at, p.ended_at) else false end) then
    refusal := 'overlapping_source_periods';
   elsif (p.owner and exists (select from imported_deal_owner where id = p.id
    and (deal_id, user_id, started_at, ended_at) is distinct from (p.deal_id, p.party_id, p.started_at, p.ended_at)))
    or (not p.owner and exists (select from imported_deal_party where id = p.id
    and (deal_id, party_id, role, started_at, ended_at) is distinct from (p.deal_id, p.party_id, p.role, p.started_at, p.ended_at))) then
    refusal := 'existing_period_conflict';
   elsif not exists (select from imported_deal_owner where id = p.id)
    and not exists (select from imported_deal_party where id = p.id) then
    begin
     if p.owner then
      insert into imported_deal_owner (id, deal_id, user_id, started_at, ended_at)
      values (p.id, p.deal_id, p.party_id, p.started_at, p.ended_at);
     else
      insert into imported_deal_party (id, deal_id, party_id, role, started_at, ended_at)
      values (p.id, p.deal_id, p.party_id, p.role, p.started_at, p.ended_at);
     end if;
    exception when exclusion_violation or check_violation or unique_violation then
     get stacked diagnostics refusal = constraint_name;
    end;
   end if;
  end if;
  if refusal is not null then
   insert into not_copied values (p.id, 'deal_participant', p.role, refusal);
  end if;
 end loop;
end $$;

create temp table old_phase on commit drop as
select e.id as old_id, e.subject_id as deal_id, e.occurred_at as happened_at, case when e.field = 'outcome' then 'dead' else e.new_value ->> 'phase' end as phase,
 e.recorded_at as changed_at,
 coalesce(nullif(e.human_quote, ''), nullif(e.agent_rationale, '')) as reason,
 a.*
-- History takes its own event's cause and sponsor, rather than a later change to the same deal.
from public.event e cross join lateral copy_event_attribution(e.actor_id, e.id) a
where e.subject_type = 'deal' and (e.field = 'phase' and e.old_value ->> 'phase' is distinct from e.new_value ->> 'phase'
 or e.field = 'outcome' and e.new_value ->> 'outcome' = 'lost');
insert into not_copied select d.id, 'phase', d.phase, 'no_phase_history' from public.deal d
where not exists (select from public.event e where e.subject_type = 'deal' and e.subject_id = d.id and e.field = 'phase');
create temp table mapped_phase on commit drop as
select p.*, case when d.id is null then 'deal_not_copied' when f.slug is null then 'unknown_phase'
 when exists (select from deal_phase_change c where (c.deal_id, c.happened_at) = (p.deal_id, p.happened_at)
  and (c.phase, c.reason) is distinct from (p.phase, p.reason)) then 'existing_phase_conflict'
 when p.phase = 'dead' and p.reason is null then 'dead_without_reason'
 when count(*) over (partition by p.deal_id, p.happened_at) > 1 then 'same_time_phase_changes' end as refusal
from old_phase p left join deal d on d.id = p.deal_id left join phase f on f.slug = p.phase;
insert into deal_phase_change (deal_id, happened_at, phase, reason, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select p.deal_id, p.happened_at, p.phase, p.reason, p.changed_by_user_id, p.changed_by_job, p.changed_for_user_id, p.changed_at
from mapped_phase p where refusal is null
 and not exists (select from deal_phase_change c where (c.deal_id, c.happened_at) = (p.deal_id, p.happened_at));
insert into not_copied select old_id, 'phase', phase, refusal from mapped_phase where refusal is not null;
-- With no phase events, the current phase is known only to hold at the deal's last change.
insert into deal_phase_change (deal_id, happened_at, phase, changed_by_job, changed_at)
select d.id, d.updated_at, d.phase, 'old_system', d.updated_at from public.deal d join deal n on n.id = d.id
where d.outcome is distinct from 'lost' and not exists (select from deal_phase_change c where c.deal_id = d.id)
 and not exists (select from public.event e where e.subject_type = 'deal' and e.subject_id = d.id and e.field = 'phase');
insert into not_copied
select d.id, 'phase', d.phase, case when d.outcome = 'lost' then 'lost_without_dated_reason' else 'current_phase_differs' end
from public.deal d join deal n on n.id = d.id
where (d.outcome = 'lost' or exists (select from deal_phase_change c where c.deal_id = d.id))
 and (select c.phase from deal_phase_change c where c.deal_id = d.id order by happened_at desc limit 1)
 is distinct from case when d.outcome = 'lost' then 'dead' else d.phase end;

-- Keep the board's source city and history without inventing a market or phase event.
insert into imported_deal_board (deal_id, city, phase, outcome, closed_on, phase_at)
select d.id, nullif(btrim(d.city), ''),
 case when d.phase in ('closed', 'invoiced') or d.outcome in ('won', 'lost') or d.closed_on is not null then d.phase end,
 case when d.outcome in ('won', 'lost') then d.outcome end, d.closed_on, p.happened_at
from old_deal d join deal n on n.id = d.id
left join lateral (
 select happened_at from deal_phase_change where deal_id = d.id order by happened_at desc limit 1
) p on true
where not d.copied_before and (d.city is not null or d.market_id is not null
 or d.phase in ('closed', 'invoiced') or d.outcome in ('won', 'lost') or d.closed_on is not null);

-- Follow merged buildings to their survivor; several suites there remain one property.
create temp table building_map on commit drop as
with recursive chain as (
 select id as old_id, id, merged_into, array[id] as path from public.building
 union all
 select c.old_id, b.id, b.merged_into, c.path || b.id from chain c
 join public.building b on b.id = c.merged_into where not b.id = any(c.path)
) select old_id, id from chain where merged_into is null;
create temp table old_property on commit drop as
select distinct p.deal_id, b.id as property_id
from public.premises p join public.premises_space ps on ps.premises_id = p.id
join public.space s on s.id = ps.space_id join building_map m on m.old_id = s.building_id
join public.building b on b.id = m.id join deal d on d.id = p.deal_id;
insert into property (id, address, name, building_class, building_type, year_built, stories,
 created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select b.id, concat_ws(', ', b.address, nullif(b.city, ''), nullif(b.state, ''), nullif(b.zip, '')),
 case when b.name ~ '\S' then b.name end, case when b.class ~ '\S' then b.class end,
 case when b.sub_type ~ '\S' then b.sub_type end, b.year_built, b.stories,
 b.created_at, b.updated_at, a.* from public.building b
cross join lateral copy_attribution('building', b.id, b.updated_by) a
where exists (select from old_property p where p.property_id = b.id) on conflict (id) do nothing;
insert into deal_property (deal_id, property_id, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select distinct on (p.deal_id, m.id) p.deal_id, m.id, p.created_at, p.created_at, a.*
from public.premises p join public.premises_space ps on ps.premises_id = p.id
join public.space s on s.id = ps.space_id join building_map m on m.old_id = s.building_id
join deal d on d.id = p.deal_id cross join lateral copy_attribution('premises', p.id, p.created_by) a
order by p.deal_id, m.id, p.created_at, p.id on conflict do nothing;
insert into not_copied
select distinct s.building_id, 'property', s.building_id::text, 'building_merge_unresolved'
from public.premises p join public.premises_space ps on ps.premises_id = p.id join public.space s on s.id = ps.space_id
join deal d on d.id = p.deal_id
where not exists (select from building_map m where m.old_id = s.building_id);

insert into not_copied
select b.id, 'property', remaining.value::text, 'unmapped_building_fields' from public.building b
cross join lateral (select jsonb_strip_nulls(to_jsonb(b) - array['id', 'address', 'city', 'state', 'zip',
 'name', 'class', 'sub_type', 'year_built', 'stories', 'created_at', 'created_by', 'updated_at', 'updated_by', 'merged_into', 'version']) as value) remaining
where remaining.value <> '{}'::jsonb and exists (select from old_property p where p.property_id = b.id);

create temp table round_mapping on commit drop as
select r.*, row_number() over (partition by r.deal_id order by r.created_at, r.id) as new_round,
 (select count(*) from old_property p where p.deal_id = r.deal_id) as properties,
 sender.* from public.negotiation_round r
cross join lateral (select count(distinct p.party_id) as senders, count(*) as sender_roles,
 (array_agg(p.party_id))[1] as party_id, (array_agg(p.role))[1] as role
 from deal_party p where p.deal_id = r.deal_id and
 (r.side in ('tenant', 'buyer') and p.role = 'client' or r.side in ('landlord', 'seller')
 and p.role in ('landlord', 'property_owner', 'listing_agent'))) sender;
create temp table round_refusal on commit drop as
select r.id, f.reason from round_mapping r cross join lateral (values
 ('deal_not_copied', not exists (select from deal d where d.id = r.deal_id)),
 ('no_sender_candidate', r.senders = 0), ('several_sender_candidates', r.senders > 1),
 ('several_sender_roles', r.senders = 1 and r.sender_roles > 1),
 ('no_property', r.properties = 0), ('several_properties', r.properties > 1),
 ('round_number_unavailable', r.new_round > 32767 or exists (select from offer o where (o.deal_id, o.round) = (r.deal_id, r.new_round))),
 ('offer_id_unavailable', exists (select from offer o where o.id = r.id))) f(reason, refused)
where f.refused and (f.reason = 'deal_not_copied' or exists (select from deal d where d.id = r.deal_id))
 and not exists (select from offer o where o.import_source = 'old_system' and o.import_id = r.id::text);
insert into offer (id, deal_id, property_id, round, from_party_id, from_role, offered_at, expires_on,
 status, rent_per_sf_yr, term_months, ti_per_sf, free_rent_months, other_terms, submarket_condition, import_source, import_id, import_record,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select r.id, r.deal_id, p.property_id, r.new_round, r.party_id, r.role, r.proposed_on::timestamp at time zone 'America/Chicago', r.expires_on,
 'unknown', r.rate_norm_sf_yr, r.term_months, case when r.ti_basis = 'usd_sf' and r.ti_amount >= 0 then r.ti_amount end,
 r.free_rent_months, nullif(concat_ws(E'\n',
 case when r.escalator is not null then 'Escalator: ' || r.escalator end,
 case when r.options_note is not null then 'Options: ' || r.options_note end,
 case when r.opex_note is not null then 'Operating costs: ' || r.opex_note end,
 case when r.note is not null then 'Note: ' || r.note end), ''),
 case when r.submarket_condition in ('soft', 'balanced', 'tight') then r.submarket_condition end, 'old_system', r.id::text, to_jsonb(original), r.updated_at, a.*
from round_mapping r join public.negotiation_round original on original.id = r.id
join old_property p on p.deal_id = r.deal_id
cross join lateral copy_attribution('negotiation_round', r.id, coalesce(r.updated_by, r.created_by)) a
where not exists (select from round_refusal f where f.id = r.id)
 and not exists (select from offer o where o.import_source = 'old_system' and o.import_id = r.id::text);
insert into not_copied
select r.id, 'negotiation_round', jsonb_build_object('side', r.side, 'round_no', r.round_no, 'new_round', r.new_round)::text,
 f.reason from round_refusal f join round_mapping r on r.id = f.id;
insert into not_copied
select r.id, f.field, f.value, 'no_typed_destination' from public.negotiation_round r
cross join lateral (values
 ('rate_amount', r.rate_amount::text, r.rate_amount is not null and r.rate_norm_sf_yr is null),
 ('ti_amount', r.ti_amount::text, r.ti_amount is not null and (r.ti_basis is distinct from 'usd_sf' or r.ti_amount < 0)),
 ('submarket_condition', r.submarket_condition, r.submarket_condition not in ('soft', 'balanced', 'tight'))) f(field, value, refused)
where f.refused;
insert into claim_type (slug, label)
select slug, label from public.negotiation_claim_type where slug <> 'deadline' on conflict do nothing;
create temp table mapped_claim on commit drop as
select c.*, o.id as offer_id,
 case c.stated_floor_basis when 'usd_sf_yr' then c.stated_floor
 when 'usd_sf_mo' then c.stated_floor * 12 end as floor_rent_per_sf_yr,
 a.* from public.negotiation_claim c
left join offer o on o.import_source = 'old_system' and o.import_id = c.round_id::text
cross join lateral copy_attribution('negotiation_claim', c.id, c.created_by) a;
create temp table claim_refusal on commit drop as
select c.id, f.reason from mapped_claim c cross join lateral (values
 ('round_not_copied', c.offer_id is null),
 ('unsupported_claim_source', c.source <> 'stated'),
 ('unsupported_floor_basis', c.stated_floor is not null and c.stated_floor_basis not in ('usd_sf_yr', 'usd_sf_mo')),
 ('floor_out_of_range', c.floor_rent_per_sf_yr is not null and c.floor_rent_per_sf_yr >= 99999999.995),
 ('blank_claim_text', c.quote is not null and c.quote !~ '\S' or c.note is not null and c.note !~ '\S'),
 ('claim_author_not_copied', c.changed_by_user_id is not null and not exists (select from app_user u where u.id = c.changed_by_user_id)),
 ('claim_sponsor_not_copied', c.changed_for_user_id is not null and not exists (select from app_user u where u.id = c.changed_for_user_id)),
 ('existing_claim_conflict', exists (select from offer_claim n where (n.offer_id, n.claim_type) = (c.offer_id, c.claim_type)
 and (n.floor_rent_per_sf_yr, n.quote, n.note, n.created_at, n.changed_at, n.changed_by_user_id, n.changed_by_job, n.changed_for_user_id)
 is distinct from (c.floor_rent_per_sf_yr, c.quote, c.note, c.created_at, c.created_at, c.changed_by_user_id, c.changed_by_job, c.changed_for_user_id)))
 ) f(reason, refused) where f.refused;
insert into offer_claim (offer_id, claim_type, floor_rent_per_sf_yr, quote, note, created_at, changed_at,
 changed_by_user_id, changed_by_job, changed_for_user_id)
select c.offer_id, c.claim_type, c.floor_rent_per_sf_yr, c.quote, c.note, c.created_at, c.created_at,
 c.changed_by_user_id, c.changed_by_job, c.changed_for_user_id from mapped_claim c
where not exists (select from claim_refusal r where r.id = c.id)
 and not exists (select from offer_claim n where (n.offer_id, n.claim_type) = (c.offer_id, c.claim_type));
insert into not_copied
select c.id, 'negotiation_claim', to_jsonb(original)::text, r.reason from mapped_claim c
join public.negotiation_claim original on original.id = c.id join claim_refusal r on r.id = c.id;
set constraints all immediate;
alter table deal enable trigger stamp_change, enable trigger deal_parked_or_flagged_by_a_user;
alter table deal_party enable trigger stamp_change;
alter table deal_phase_change enable trigger stamp_change;
alter table property enable trigger stamp_change;
alter table deal_property enable trigger stamp_change;
alter table offer enable trigger stamp_change;
alter table offer_claim enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
