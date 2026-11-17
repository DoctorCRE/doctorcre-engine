-- Run after the copies that make next steps, in a separate owner transaction with search_path set to the new schema.
-- Only reads public and ops. A user's copied preferences and marks stay as they are, so an unchanged rerun changes nothing.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table user_preference disable trigger stamp_change;
alter table home_mark disable trigger stamp_change;
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;

create temp table old_preference on commit drop as
select p.*, u.id as user_id from ops.notification_preference p
left join outside_id o on o.source = 'old_system' and o.value = p.actor::text
left join app_user u on u.id = o.party_id
where not exists (select from user_preference done where done.user_id = u.id);
create temp table preference_refusal on commit drop as
select p.actor, f.field, f.value, f.reason from old_preference p cross join lateral (values
 ('actor', p.actor::text, 'actor_not_a_user', p.user_id is null),
 ('timezone', p.timezone, 'unknown_time_zone', not is_time_zone(p.timezone)),
 ('quiet_hours_start', p.quiet_hours_start::text, 'quiet_hours_start_equals_end', p.quiet_hours_start = p.quiet_hours_end)
) f(field, value, reason, refused) where f.refused;
insert into not_copied select * from preference_refusal;
-- Today's row keeps no time; only its user sets it.
insert into user_preference (user_id, time_zone, quiet_from, quiet_until, push_to_device, changed_by_user_id, changed_at)
select user_id, timezone, quiet_hours_start, quiet_hours_end, device_opt_in, user_id, now() from old_preference p
where not exists (select from preference_refusal r where r.actor = p.actor);

-- An inbox disposition and a cleared waiting are no mark. Today's item id for a next action is its id, which the copies keep.
create temp table old_mark on commit drop as
select k.actor_id, k.item_id, d.disposition, d.snoozed_until, w.identity_id, w.reason,
 least(d.updated_at, w.updated_at) as created_at, greatest(d.updated_at, w.updated_at) as changed_at,
 u.id as user_id, s.id as next_step_id, waiting_on.id as waiting_on_party_id
from (select actor_id, item_id from ops.home_inbox_disposition where disposition <> 'inbox'
 union select actor_id, item_id from ops.home_waiting where identity_id is not null) k
left join ops.home_inbox_disposition d on (d.actor_id, d.item_id) = (k.actor_id, k.item_id) and d.disposition <> 'inbox'
left join ops.home_waiting w on (w.actor_id, w.item_id) = (k.actor_id, k.item_id) and w.identity_id is not null
left join outside_id o on o.source = 'old_system' and o.value = k.actor_id::text
left join app_user u on u.id = o.party_id
left join next_step s on 'next_action:' || s.id = k.item_id
left join outside_id wo on wo.source = 'old_system' and wo.value = w.identity_id::text
left join party waiting_on on waiting_on.id = wo.party_id
where not exists (select from home_mark done where (done.user_id, done.next_step_id) = (u.id, s.id));
create temp table mark_refusal on commit drop as
select m.actor_id, m.item_id, f.field, f.value, f.reason from old_mark m cross join lateral (values
 ('actor_id', m.actor_id::text, 'actor_not_a_user', m.user_id is null),
 ('item_id', m.item_id, 'waits_for_its_record', m.item_id not like 'next_action:%'),
 ('item_id', m.item_id, 'next_step_not_copied', m.item_id like 'next_action:%' and m.next_step_id is null),
 ('identity_id', m.identity_id::text, 'waiting_on_not_copied', m.identity_id is not null and m.waiting_on_party_id is null),
 ('reason', m.reason, 'waiting_needs_reason', m.identity_id is not null and m.reason !~ '\S')
) f(field, value, reason, refused) where f.refused;
insert into not_copied select actor_id, field, value, reason from mark_refusal;
insert into home_mark (user_id, next_step_id, created_at, disposition, snoozed_until, waiting_on_party_id, waiting_reason,
 changed_by_user_id, changed_at)
select user_id, next_step_id, created_at, disposition, snoozed_until, waiting_on_party_id,
 reason, user_id, changed_at
from old_mark m where not exists (select from mark_refusal r where (r.actor_id, r.item_id) = (m.actor_id, m.item_id));
alter table user_preference enable trigger stamp_change;
alter table home_mark enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
