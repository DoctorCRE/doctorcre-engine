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

create temp table old_action on commit drop as
select n.id, 'next_action'::text as source, case n.subject_type when 'deal' then n.subject_id end as deal_id,
 case n.subject_type when 'vendor' then n.subject_id end as vendor_id, n.description, n.status, n.due_on,
 n.owner_id, n.created_by, n.created_at, n.updated_at, n.hold_until, n.source_ref, n.item_title, n.item_bullets, a.*
from public.next_action n
cross join lateral copy_attribution('next_action', n.id, coalesce(n.updated_by, n.created_by)) a
where n.subject_type in ('deal', 'vendor')
union all
select n.id, 'capture_post_call_action', n.deal_id, null, n.description, n.status, n.due_on,
 n.owner_id, n.accepted_by, n.accepted_at, n.updated_at, null, n.source_ref, n.item_title, n.item_bullets, a.*
from public.capture_post_call_action n
left join lateral (select e.id, e.actor_id from public.event e
 where e.subject_type = 'deal' and e.subject_id = n.deal_id
 and (e.new_value ->> 'next_action_id' = n.id::text or e.new_value ->> 'post_call_action_id' = n.id::text
  or e.verb = 'log-outreach' and e.new_value -> 'completed_post_call_action_ids' ? n.id::text)
 order by e.mutation_order desc limit 1) event on true
cross join lateral copy_event_attribution(coalesce(event.actor_id, n.accepted_by), event.id) a;

create temp table action_end on commit drop as
select e.* from copy_action_end() e join old_action n using (id);

create temp table vendor_last_work on commit drop as
with work as (
 select v.party_id, a.occurred_at as worked_at, u.id as user_id
 from public.activity a
 join outside_id v on v.source = 'old_system' and v.value = a.vendor_id::text
 left join copy_activity_event() e on e.activity_id = a.id
 cross join lateral copy_event_attribution(a.actor_id, e.event_id) stamp
 left join copy_email_mailboxes() mail on a.kind = 'email_out' and mail.activity_id = a.id
 join app_user u on u.id = coalesce(stamp.changed_by_user_id, stamp.changed_for_user_id, mail.user_id)
 where a.kind <> 'task' and coalesce(a.email_context #>> '{lifecycle,state}', 'live') = 'live'
  and not (a.kind = 'note' and a.source = 'import' and a.summary = 'last-touch stamp (imported)')
 union all
 select v.party_id, n.created_at, u.id
 from old_action n
 join outside_id v on v.source = 'old_system' and v.value = n.vendor_id::text
 join app_user u on u.id = n.created_by
), latest as (
 select *, rank() over (partition by party_id order by worked_at desc) as recency from work
)
select party_id, (array_agg(distinct user_id))[1] as user_id
from latest where recency = 1 group by party_id having count(distinct user_id) = 1;

create temp table step_candidate on commit drop as
select n.id, n.source, n.deal_id, n.vendor_id, vendor.party_id,
 coalesce(plain.what, regexp_replace(stripped.description, '^\s+|\s+$', '', 'g')) as what,
 coalesce(n.due_on, plain.due_on) as due_on, n.hold_until,
 coalesce(u.id, d.owner_user_id, v.owner_user_id, creator.id, worked.user_id) as owner,
 u.id is null as owner_inferred,
 case when n.source = 'capture_post_call_action' then n.item_title end as item_title,
 case when n.source = 'capture_post_call_action' then n.item_bullets else '[]'::jsonb end as item_bullets,
 case when n.source = 'capture_post_call_action' then n.source_ref end as source_ref,
 e.resolution, e.done_at, e.resolved_at, e.resolution_reason, e.resolution_event_id,
 n.created_at, n.updated_at as changed_at, n.changed_by_user_id, n.changed_by_job, n.changed_for_user_id,
 case when n.source = 'next_action' and n.deal_id is not null and copy_automation_note_step(n.description, n.created_by)
  then 'automation_note_step' else e.refusal end as refusal
from old_action n
cross join lateral (select case
 when n.source = 'next_action' and n.deal_id is not null and n.description like 'Nothing outstanding on the agent side.%'
 then (regexp_match(n.description, '\(([0-9a-f]{8}),[[:blank:]]+(?=\S)', 'i'))[1] end as prefix) code
cross join lateral (select case when exists (
 select from public.next_action a where a.subject_type = 'deal' and a.subject_id = n.deal_id
  and a.id <> n.id and left(a.id::text, 8) = lower(code.prefix)
) then regexp_replace(n.description, '\(' || code.prefix || ',[[:blank:]]+', '(')
 else n.description end as description) stripped
cross join lateral (select case when n.source = 'next_action' and n.deal_id is not null then regexp_match(stripped.description,
 $re$^\s*\{\s*'text':\s*('[^'\\]*'|"[^"\\]*")\s*,\s*'due':\s*'(\d{4}-\d\d-\d\d)'\s*,\s*'waiting_on':\s*('[^'\\]*'|"[^"\\]*"|None)\s*\}\s*$$re$)
 end as parts) structured
cross join lateral (select
 substr(structured.parts[1], 2, length(structured.parts[1]) - 2) as words,
 substr(structured.parts[3], 2, length(structured.parts[3]) - 2) as waiting,
 case when pg_input_is_valid(structured.parts[2], 'date') then structured.parts[2]::date end as due_on) parsed
left join lateral (select concat_ws(E'\n', parsed.words, case when structured.parts[3] <> 'None'
 and parsed.waiting ~ '\S' then parsed.waiting end) as what, parsed.due_on
 where parsed.words ~ '\S' and parsed.due_on is not null
  and (n.due_on is null or n.due_on = parsed.due_on)) plain on true
left join action_end e using (id)
-- A vendor's next steps are about the person or company it became, merged-away vendors' too.
left join outside_id vendor on vendor.source = 'old_system' and vendor.value = n.vendor_id::text
left join party_role v on v.party_id = vendor.party_id and v.role = 'vendor'
left join app_user creator on n.vendor_id is not null and creator.id = n.created_by
left join vendor_last_work worked on worked.party_id = vendor.party_id
left join deal d on d.id = n.deal_id
left join outside_id o on o.source = 'old_system' and o.value = n.owner_id::text
left join app_user u on u.id = o.party_id
union all
select n.id, 'deal_note', n.deal_id, null, null, n.text, d.next_date, null, owner.id, true, null, '[]'::jsonb, null, null, null, null, null, null,
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
left join copy_next_step_event() event on event.note_id = n.id
cross join lateral copy_event_attribution(n.actor_id, event.event_id) a
union all
select md5('old_system:deal:' || d.id || ':follow_up')::uuid, 'deal_date', d.id, null, null,
 'Imported deal follow-up', d.next_date, null, owner.id, true, null, '[]'::jsonb, null, null, null, null, null, null, d.created_at, d.updated_at, a.*, null
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
 (case when s.refusal = 'automation_note_step' then 'text'
  when s.resolution is not null then 'status' when s.source = 'deal_note' then 'text' else 'source' end,
 case when s.refusal = 'automation_note_step' then null
  when s.resolution is not null then (select status from old_action a where a.id = s.id) when s.source = 'deal_note' then s.what else s.source end, s.refusal, s.refusal is not null),
 ('what', s.what, 'blank_next_step', s.what !~ '\S'),
 ('deal_id', s.deal_id::text, 'deal_not_copied', s.deal_id is not null and not exists (select from deal d where d.id = s.deal_id)),
 ('vendor_id', s.vendor_id::text, 'vendor_not_copied', s.vendor_id is not null and s.party_id is null),
 ('id', s.id::text, 'id_taken', exists (select from next_step n where n.id = s.id
  and (n.deal_id, n.party_id) is distinct from (s.deal_id, s.party_id)))
) f(field, value, reason, refused) where f.refused;
create temp table post_call_source on commit drop as
select n.id, c.session_id, c.evidence_quote, c.contact_party_id, contact.party_id as contact_id,
 case when a.id is null then 'call_activity_not_copied'
  when c.evidence_quote !~ '\S' then 'call_quote_missing' end as refusal
from public.capture_post_call_action n
join public.capture_post_call_candidate c on c.id = n.candidate_id and c.deal_id = n.deal_id
left join activity a on a.id = c.session_id and a.kind = 'call'
 and exists (select from activity_about aa where aa.activity_id = a.id and aa.deal_id = n.deal_id)
left join outside_id contact on contact.source = 'old_system' and contact.value = c.contact_party_id::text;

insert into step_refusal
select s.id, 'call_activity_id', c.session_id::text, coalesce(c.refusal, 'call_candidate_deal_differs')
from step_candidate s left join post_call_source c using (id)
where s.source = 'capture_post_call_action' and (c.id is null or c.refusal is not null)
 and not exists (select from step_refusal r where r.id = s.id);
insert into not_copied select * from step_refusal;
insert into not_copied
select id, 'call_contact_party_id', contact_party_id::text, 'call_contact_not_copied'
from post_call_source where contact_party_id is not null and contact_id is null;

with ready as (
 select s.*, row_number() over (
  partition by deal_id, party_id, owner, resolution is null and item_title is null
  order by owner_inferred, source <> 'deal_note', created_at, id
 ) as rank
 from step_candidate s where not exists (select from step_refusal r where r.id = s.id)
  and not exists (select from next_step copied where copied.id = s.id)
)
insert into next_step (id, deal_id, party_id, what, due_on, hold_until, owner_party_id, item_title, item_bullets, source_ref, resolution, done_at, resolved_at,
 resolution_reason, resolution_event_id, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id,
 call_activity_id, call_evidence_quote, call_contact_party_id)
select s.id, deal_id, party_id, copy_note_text(what), due_on, hold_until, owner, item_title, item_bullets, source_ref,
 case when replaced then 'cancelled' else resolution end, done_at, resolved_at,
 case when replaced then 'replaced at the move' else resolution_reason end, resolution_event_id,
 created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id,
 c.session_id, c.evidence_quote, c.contact_id
from ready s left join post_call_source c on c.id = s.id and s.source = 'capture_post_call_action'
cross join lateral (values (owner_inferred and owner is not null and resolution is null and item_title is null and (rank > 1 or exists (
  select from next_step kept where kept.id <> s.id and kept.owner_party_id = s.owner
   and (kept.deal_id, kept.party_id) is not distinct from (s.deal_id, s.party_id)
   and kept.status = 'open' and kept.item_title is null
 )))) moved(replaced)
order by owner_inferred, source <> 'deal_note', created_at, s.id on conflict do nothing;

insert into not_copied
select n.id, 'text', null,
 case when n.description ~ '^\s*\{' then 'serialized_next_step' else 'technical_step_code' end
from old_action n join step_candidate s using (id) join next_step copied using (id)
where copied.what = copy_note_text(s.what) and s.what <> regexp_replace(n.description, '^\s+|\s+$', '', 'g');

insert into not_copied
select s.id, 'next_step', kept.id::text, 'open_step_exists'
from step_candidate s join next_step kept on kept.owner_party_id = s.owner
 and (kept.deal_id, kept.party_id) is not distinct from (s.deal_id, s.party_id)
where kept.id <> s.id and s.resolution is null and s.item_title is null and kept.status = 'open' and kept.item_title is null
 and not exists (select from step_refusal r where r.id = s.id)
 and not exists (select from next_step copied where copied.id = s.id);

insert into not_copied select n.id, f.field, f.value, f.reason from old_action n join step_candidate s using (id)
cross join lateral (values
 ('owner_id', n.owner_id::text, case when n.vendor_id is not null then 'vendor_owner_unknown' else 'owner_not_a_user' end, s.owner is null),
 ('source_ref', n.source_ref, 'reference_not_copied', n.source_ref ~ '\S'),
 ('item_title', n.item_title, 'display_title_not_copied', n.item_title is not null),
 ('item_bullets', n.item_bullets::text, 'display_bullets_not_copied', n.item_bullets <> '[]'::jsonb)
) f(field, value, reason, listed) where f.listed and (f.field = 'owner_id' or n.source = 'next_action');
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
