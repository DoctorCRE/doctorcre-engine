select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table home_update disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

create temp table old_home_update on commit drop as
select n.id, d.id as deal_id, n.subject_ref, u.id as user_id, n.recipient_actor, n.reason,
 e.new_value ->> 'checklist_item_id' as checklist_item_ref,
 due_text, case when due_text ~ '^\d{4}-\d{2}-\d{2}$' and pg_input_is_valid(due_text, 'date') then due_text::date end as due_on,
 n.event_ref, n.created_at, r.read_at, a.*
from ops.notification n
left join deal d on d.id::text = n.subject_ref
left join public.event e on e.id = n.event_ref and n.event_source = 'event'
 and e.subject_type = 'deal' and e.subject_id = d.id and e.verb = 'ping-deal-checklist' and e.field = 'checklist_ping'
cross join lateral (select e.new_value ->> 'due_on' as due_text) due
left join outside_id o on o.source = 'old_system' and o.value = n.recipient_actor::text
left join app_user u on u.id = o.party_id
left join ops.notification_read r on (r.notification_id, r.recipient_actor) = (n.id, n.recipient_actor)
cross join lateral copy_event_attribution(e.actor_id, e.id) a
where n.subject_type = 'deal' and starts_with(n.dedupe_key, 'deal-checklist:');

insert into not_copied
select n.id, f.field, f.value, f.reason from old_home_update n cross join lateral (values
 ('deal_id', n.subject_ref, 'deal_not_copied', n.deal_id is null),
 ('user_id', n.recipient_actor::text, 'recipient_not_a_user', n.user_id is null),
 ('event_ref', n.event_ref::text, 'checklist_item_missing', coalesce(n.checklist_item_ref, '') !~ '\S'),
 ('due_on', n.due_text, 'checklist_due_date_missing_or_invalid', n.checklist_item_ref ~ '\S' and n.due_on is null),
 ('what', null, 'blank_update', n.reason !~ '\S'),
 ('read_at', n.read_at::text, 'read_before_creation', n.read_at < n.created_at)
) f(field, value, reason, refused) where f.refused;

insert into home_update (id, user_id, deal_id, what, checklist_item_ref, due_on, created_at, read_at,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select id, user_id, deal_id, reason, checklist_item_ref, due_on, created_at, read_at,
 created_at, changed_by_user_id, changed_by_job, changed_for_user_id
from old_home_update n where not exists (select from not_copied r where r.old_id = n.id)
on conflict (id) do nothing;

alter table home_update enable trigger stamp_change;
select 'old_work_alert' as kind, count(*) as left_behind
from ops.notification where subject_type in ('engineering_program', 'loop', 'release');
select * from not_copied order by old_id, field, value, reason;
