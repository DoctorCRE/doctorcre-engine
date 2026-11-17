-- Run after the party, vendor, deal and activity copies, with attribution loaded, in one owner transaction.
-- Put the new schema on search_path. Only public is read.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table next_step disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

create temp table step_note on commit drop as
select n.*, row_number() over (partition by deal_id order by created_at desc, id desc) as rank,
 exists (select from public.event e where e.subject_type = 'deal' and e.subject_id = n.deal_id
  and e.field = 'next_step' and e.new_value ? 'superseded_action_ids' and e.recorded_at >= n.created_at) as superseded
from public.deal_note n where kind = 'next_step';

-- Each action's latest closing event per end state. A later keep or reopen leaves no proof.
create temp table closure on commit drop as
select distinct on (action_id, resolution) e.*, count(*) over (partition by action_id, resolution) as events
from (select e.new_value ->> 'next_action_id' as action_id, 'cancelled' as resolution, e.id, e.occurred_at, e.mutation_order,
  coalesce(e.new_value ->> 'reason', e.human_quote) as reason, e.new_value ->> 'version' as version, true as proves
 from public.event e where e.verb = 'drop-action'
 union all
 select r ->> 'id', 'expired', e.id, e.occurred_at, e.mutation_order, null, null, e.new_value ->> 'action' = 'drop'
 from public.event e cross join jsonb_array_elements(e.new_value -> 'rows') r
 where e.verb = 'clear-the-deck-apply' and e.new_value ->> 'kind' = 'next_action'
  and (e.new_value ->> 'action' = 'keep' or r ->> 'status' = 'open')
 union all
 select coalesce(e.new_value ->> 'next_action_id', e.new_value ->> 'item_id', e.new_value ->> 'action_id'), 'done',
  e.id, e.occurred_at, e.mutation_order, null, null, e.verb <> 'reopen-one-action'
 from public.event e where e.verb in ('complete-one-action', 'complete-deal-item', 'reopen-one-action')) e
order by action_id, resolution, mutation_order desc;

create temp table old_action on commit drop as
select n.id, 'next_action'::text as source, case n.subject_type when 'deal' then n.subject_id end as deal_id,
 case n.subject_type when 'vendor' then n.subject_id end as vendor_id, n.description, n.status, n.due_on,
 n.owner_id, n.created_at, n.updated_at, null::timestamptz as completed_at, n.version,
 n.hold_until, n.source_ref, n.item_title, n.item_bullets, a.*
from public.next_action n
cross join lateral copy_attribution('next_action', n.id, coalesce(n.updated_by, n.created_by)) a
where n.subject_type in ('deal', 'vendor')
union all
select n.id, 'capture_post_call_action', n.deal_id, null, n.description, n.status, n.due_on,
 n.owner_id, n.accepted_at, n.updated_at, n.completed_at, n.version, null, n.source_ref, n.item_title, n.item_bullets, a.*
from public.capture_post_call_action n
left join lateral (select e.id, e.actor_id from public.event e
 where e.subject_type = 'deal' and e.subject_id = n.deal_id
 and (e.new_value ->> 'next_action_id' = n.id::text or e.new_value ->> 'post_call_action_id' = n.id::text
  or e.verb = 'log-outreach' and e.new_value -> 'completed_post_call_action_ids' ? n.id::text)
 order by e.mutation_order desc limit 1) event on true
cross join lateral copy_event_attribution(coalesce(event.actor_id, n.accepted_by), event.id) a;

-- A cancellation needs one partner drop with its reason, on the row as that drop left it.
create temp table action_end on commit drop as
select n.id, s.resolution, p.proven,
 case when s.resolution = 'done' then coalesce(n.completed_at, case when p.proven then c.occurred_at end) end as done_at,
 case when s.resolution <> 'done' and p.proven then c.occurred_at end as resolved_at,
 case when s.resolution = 'cancelled' and p.proven then c.reason end as resolution_reason,
 case when s.resolution <> 'done' and p.proven then c.id end as resolution_event_id,
 case when s.resolution = 'cancelled' and not p.proven then case when coalesce(c.reason, '') !~ '\S'
  then 'cancellation_reason_missing' else 'cancellation_evidence_conflict' end end as refusal
from old_action n
cross join lateral (values (case n.status when 'done' then 'done' when 'dropped' then 'cancelled' when 'expired' then 'expired' end)) s(resolution)
left join closure c on c.action_id = n.id::text and c.resolution = s.resolution
cross join lateral (values (coalesce(case when s.resolution <> 'cancelled' then c.proves
 else c.events = 1 and c.version = n.version::text and c.reason ~ '\S' end, false))) p(proven)
where s.resolution is not null;

create temp table step_candidate on commit drop as
select n.id, n.source, n.deal_id, n.vendor_id, vendor.party_id,
 regexp_replace(n.description, '^\s+|\s+$', '', 'g') as what, n.due_on, u.id as owner,
 e.resolution, e.done_at, e.resolved_at, e.resolution_reason, e.resolution_event_id,
 n.created_at, n.updated_at as changed_at, n.changed_by_user_id, n.changed_by_job, n.changed_for_user_id, e.refusal
from old_action n
left join action_end e using (id)
-- A vendor's next steps are about the person or company it became, merged-away vendors' too.
left join outside_id vendor on vendor.source = 'old_system' and vendor.value = n.vendor_id::text
left join outside_id o on o.source = 'old_system' and o.value = n.owner_id::text
left join app_user u on u.id = o.party_id
union all
select n.id, 'deal_note', n.deal_id, null, null, n.text, d.next_date, owner.id, null, null, null, null, null,
 n.created_at, n.created_at, a.*,
 case when n.superseded then 'superseded_note' when n.rank <> 1 then 'older_next_step_note'
 when current.status = 'done' then 'plan_already_done'
 when current.status = 'open' then 'note_hidden_by_action' end
from step_note n join public.deal d on d.id = n.deal_id
-- The current-action view excludes checklist items and pending assessments, and retains completed plans.
left join public.v_deal_current_action current on current.deal_id = n.deal_id
left join public.actor actor on actor.slug = d.owner
left join outside_id o on o.source = 'old_system' and o.value = actor.id::text
left join app_user owner on owner.id = o.party_id
cross join lateral copy_event_attribution(n.actor_id, (select e.id from public.event e
 where e.verb = 'add-deal-note' and e.subject_type = 'deal' and e.subject_id = n.deal_id
 and e.actor_id = n.actor_id and e.occurred_at = n.created_at and e.new_value ->> 'note' = n.text
 order by e.mutation_order desc limit 1)) a
union all
select md5('old_system:deal:' || d.id || ':follow_up')::uuid, 'deal_date', d.id, null, null,
 'Imported deal follow-up', d.next_date, owner.id, null, null, null, null, null, d.created_at, d.updated_at, a.*, null
from public.deal d
left join public.actor actor on actor.slug = d.owner
left join outside_id o on o.source = 'old_system' and o.value = actor.id::text
left join app_user owner on owner.id = o.party_id
cross join lateral copy_attribution('deal', d.id, coalesce(d.updated_by, d.created_by), 'next_date') a
where d.next_date is not null
 and not exists (select from old_action n where n.deal_id = d.id)
 and not exists (select from step_note n where n.deal_id = d.id);

create temp table step_refusal on commit drop as
select s.id, f.field, f.value, f.reason from step_candidate s cross join lateral (values
 (case when s.resolution is not null then 'status' when s.source = 'deal_note' then 'text' else 'source' end,
 case when s.resolution is not null then (select status from old_action a where a.id = s.id) when s.source = 'deal_note' then s.what else s.source end, s.refusal, s.refusal is not null),
 ('what', s.what, 'blank_next_step', s.what !~ '\S'),
 ('deal_id', s.deal_id::text, 'deal_not_copied', s.deal_id is not null and not exists (select from deal d where d.id = s.deal_id)),
 ('vendor_id', s.vendor_id::text, 'vendor_not_copied', s.vendor_id is not null and s.party_id is null),
 ('id', s.id::text, 'id_taken', exists (select from next_step n where n.id = s.id
  and (n.deal_id, n.party_id) is distinct from (s.deal_id, s.party_id)))
) f(field, value, reason, refused) where f.refused;
insert into not_copied select * from step_refusal;
insert into next_step (id, deal_id, party_id, what, due_on, owner_party_id, resolution, done_at, resolved_at,
 resolution_reason, resolution_event_id, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select id, deal_id, party_id, what, due_on, owner, resolution, done_at, resolved_at,
 resolution_reason, resolution_event_id, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id from step_candidate s
where not exists (select from step_refusal r where r.id = s.id) on conflict do nothing;

insert into not_copied select n.id, f.field, f.value, f.reason from old_action n
cross join lateral (values
 ('owner_id', n.owner_id::text, 'owner_not_a_user', not exists (select from outside_id o join app_user u on u.id = o.party_id where o.source = 'old_system' and o.value = n.owner_id::text)),
 ('hold_until', n.hold_until::text, 'hold_has_no_place', n.hold_until is not null),
 ('source_ref', n.source_ref, 'reference_not_copied', n.source_ref ~ '\S'),
 ('item_title', n.item_title, 'display_title_not_copied', n.item_title is not null),
 ('item_bullets', n.item_bullets::text, 'display_bullets_not_copied', n.item_bullets <> '[]'::jsonb)
) f(field, value, reason, listed) where f.listed;
insert into not_copied select d.id, 'next_date', d.next_date::text, 'date_without_fallback'
from public.deal d where d.next_date is not null
 and not exists (select from old_action a where a.deal_id = d.id and a.due_on = d.next_date and a.status = 'open')
 and not exists
 (select from step_candidate s where s.deal_id = d.id and s.source in ('deal_date', 'deal_note') and s.refusal is null);
insert into not_copied select id, 'resolution_event_id', null, 'expiry_unproven' from action_end
where resolution = 'expired' and not proven;
insert into not_copied select s.id, 'changed_for_user_id', null, 'agent_user_unknown'
from step_candidate s where s.changed_by_job = 'agent' and s.changed_for_user_id is null;
insert into not_copied select id, 'kind', kind, 'task_kind_unconfirmed' from public.activity where kind = 'task';
set constraints all immediate;
alter table next_step enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
