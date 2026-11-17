-- Run after the party, deal and activity copies, with attribution loaded, in one owner transaction.
-- Put the new schema on search_path. Only public is read.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table next_step disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

create temp table step_note on commit drop as
select n.*, row_number() over (partition by deal_id order by created_at desc, id desc) as rank,
 exists (select from public.event e where e.subject_type = 'deal' and e.subject_id = n.deal_id
  and e.field = 'next_step' and e.new_value ? 'superseded_action_ids' and e.recorded_at >= n.created_at) as superseded
from public.deal_note n where kind = 'next_step';

create temp table task_link on commit drop as
select a.id, f.field, f.value, o.deal_id, o.party_id
from public.activity a
left join public.client c on c.id = a.client_id
left join public.lead l on l.id = a.lead_id
left join public.vendor v on v.id = a.vendor_id
cross join lateral (values ('deal_id', a.deal_id, a.deal_id), ('client_id', a.client_id, c.party_id),
 ('lead_id', a.lead_id, l.party_id), ('vendor_id', a.vendor_id, v.party_id), ('party_id', a.party_id, a.party_id)) f(field, value, lookup)
left join outside_id o on o.source = 'old_system' and o.value = f.lookup::text
where a.kind = 'task' and f.value is not null;

-- All sources share a candidate shape; refusals never become a completion date.
create temp table step_candidate on commit drop as
select n.id, 'next_action'::text as source, n.subject_id as deal_id, null::uuid as party_id,
 regexp_replace(n.description, '^\s+|\s+$', '', 'g') as what, n.due_on, u.id as owner,
 case when n.status = 'done' then n.updated_at end as done_at, n.created_at, n.updated_at as changed_at, a.*,
 case when n.status not in ('open', 'done') then 'closed_without_doing' end as refusal
from public.next_action n
left join outside_id o on o.source = 'old_system' and o.value = n.owner_id::text
left join app_user u on u.id = o.party_id
cross join lateral copy_attribution('next_action', n.id, coalesce(n.updated_by, n.created_by)) a
where n.subject_type = 'deal'
union all
select n.id, 'deal_note', n.deal_id, null, n.text, d.next_date, owner.id, null, n.created_at, n.created_at, a.*,
 case when n.superseded then 'superseded_note' when n.rank <> 1 then 'older_next_step_note'
 when exists (select from public.next_action x where x.subject_type = 'deal' and x.subject_id = n.deal_id and x.status = 'open')
 then 'note_hidden_by_action' end
from step_note n join public.deal d on d.id = n.deal_id
left join public.actor actor on actor.slug = d.owner
left join outside_id o on o.source = 'old_system' and o.value = actor.id::text
left join app_user owner on owner.id = o.party_id
cross join lateral copy_event_attribution(n.actor_id, (select e.id from public.event e
 where e.verb = 'add-deal-note' and e.subject_type = 'deal' and e.subject_id = n.deal_id
 and e.actor_id = n.actor_id and e.occurred_at = n.created_at and e.new_value ->> 'note' = n.text
 order by e.mutation_order desc limit 1)) a
union all
select md5('old_system:deal:' || d.id || ':follow_up')::uuid, 'deal_date', d.id, null,
 'Imported deal follow-up', d.next_date, owner.id, null, d.created_at, d.updated_at, a.*, null
from public.deal d
left join public.actor actor on actor.slug = d.owner
left join outside_id o on o.source = 'old_system' and o.value = actor.id::text
left join app_user owner on owner.id = o.party_id
cross join lateral copy_attribution('deal', d.id, coalesce(d.updated_by, d.created_by), 'next_date') a
where d.next_date is not null
 and not exists (select from public.next_action n where n.subject_type = 'deal' and n.subject_id = d.id)
 and not exists (select from step_note n where n.deal_id = d.id)
union all
select a.id, 'task', target.deal_id, target.party_id,
 concat_ws(E'\n\n', a.summary, case when a.detail ~ '\S' and a.detail is not json object then a.detail end),
 null, null, null, a.recorded_at, a.updated_at, author.*,
 case when target.targets <> 1 then 'task_needs_one_record'
 when exists (select from task_link l where l.id = a.id and num_nonnulls(l.deal_id, l.party_id) = 0) then 'task_record_not_copied' end
from public.activity a
cross join lateral (select count(*) as targets, (array_agg(deal_id))[1] as deal_id, (array_agg(party_id))[1] as party_id
 from (select distinct deal_id, party_id from task_link where id = a.id and num_nonnulls(deal_id, party_id) = 1) links) target
cross join lateral copy_event_attribution(coalesce(a.updated_by, a.actor_id), (select e.id from public.event e
 where e.verb = 'log-activity' and e.new_value ->> 'activity' = a.id::text order by mutation_order desc limit 1)) author
where a.kind = 'task';

create temp table step_refusal on commit drop as
select s.id, f.field, f.value, f.reason from step_candidate s cross join lateral (values
 ('source', s.source, s.refusal, s.refusal is not null),
 ('what', s.what, 'blank_next_step', s.what !~ '\S'),
 ('deal_id', s.deal_id::text, 'deal_not_copied', s.deal_id is not null and not exists (select from deal d where d.id = s.deal_id)),
 ('id', s.id::text, 'id_taken', exists (select from next_step n where n.id = s.id
  and (n.deal_id, n.party_id) is distinct from (s.deal_id, s.party_id)))
) f(field, value, reason, refused) where f.refused;
insert into not_copied select * from step_refusal;
insert into next_step (id, deal_id, party_id, what, due_on, owner_party_id, done_at, created_at,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select id, deal_id, party_id, what, due_on, owner, done_at, created_at,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id from step_candidate s
where not exists (select from step_refusal r where r.id = s.id) on conflict do nothing;

insert into not_copied select n.id, f.field, f.value, f.reason from public.next_action n
cross join lateral (values
 ('owner_id', n.owner_id::text, 'owner_not_a_user', not exists (select from outside_id o join app_user u on u.id = o.party_id where o.source = 'old_system' and o.value = n.owner_id::text)),
 ('hold_until', n.hold_until::text, 'hold_has_no_place', n.hold_until is not null),
 ('source_ref', n.source_ref, 'reference_not_copied', n.source_ref ~ '\S'),
 ('item_title', n.item_title, 'display_title_not_copied', n.item_title is not null),
 ('item_bullets', n.item_bullets::text, 'display_bullets_not_copied', n.item_bullets <> '[]'::jsonb)
) f(field, value, reason, listed) where n.subject_type = 'deal' and f.listed;
insert into not_copied select d.id, 'next_date', d.next_date::text, 'date_without_fallback'
from public.deal d where d.next_date is not null and not exists
 (select from step_candidate s where s.deal_id = d.id and s.source in ('deal_date', 'deal_note') and s.refusal is null);
insert into not_copied select s.id, 'changed_for_user_id', null, 'agent_user_unknown'
from step_candidate s where s.changed_by_job = 'agent' and s.changed_for_user_id is null;
insert into not_copied select a.id, f.field, f.value, f.reason from public.activity a
cross join lateral (values ('owed', a.owed, 'owed_has_no_place', a.owed ~ '\S'),
 ('detail', a.detail, 'structured_detail_not_copied', a.detail is json object)) f(field, value, reason, listed)
where a.kind = 'task' and f.listed;
set constraints all immediate;
alter table next_step enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
