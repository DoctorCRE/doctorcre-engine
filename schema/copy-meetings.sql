-- Owner transaction after copy-activity.sql and attribution, new schema on search_path. Only public and ops are read.
set local time zone 'UTC';
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
create temp table if not exists copy_meeting_activity (meeting_id uuid primary key, activity_id uuid not null unique) on commit drop;
create temp table if not exists copy_meeting_distinct (meeting_id uuid, activity_id uuid, primary key (meeting_id, activity_id)) on commit drop;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;
alter table activity disable trigger stamp_change;
alter table activity disable trigger record_change;
alter table imported_change disable trigger stamp_imported_change;

-- Neither native identity nor activation state identifies a business record or a logged activity.
insert into not_copied
select m.id, 'activity_id', a.id::text, 'possible_duplicate' from ops.meeting m join public.activity a
 on a.kind in ('meeting','tour') and (a.occurred_at between m.started_at - interval '24 hours' and m.started_at + interval '24 hours'
 or (a.occurred_at at time zone 'UTC')::date = (m.started_at at time zone 'America/Chicago')::date
 or a.summary = m.title)
where not exists (select from pg_temp.copy_meeting_distinct x where (x.meeting_id,x.activity_id) = (m.id,a.id))
 and not exists (select from pg_temp.copy_meeting_activity x where x.meeting_id = m.id)
 and not exists (select from imported_change i where i.id = m.id and i.source_event ->> 'source_table' = 'ops.meeting');

create temp table meeting_edit on commit drop as
select n.*, row_number() over (partition by meeting_id order by created_at, note_number, revision, id) as position
from ops.meeting_note n;
create temp table meeting_history (like imported_change including defaults) on commit drop;

do $$
declare
 m ops.meeting;
 n record;
 target uuid;
 saved imported_change;
 latest imported_change;
 mapped boolean;
 base text;
 summary_before text;
 summary_after text;
 actor record;
 failure text;
begin
 for m in select * from ops.meeting order by started_at, id loop
  begin
   if exists (select from not_copied where old_id = m.id and reason = 'possible_duplicate') then
    continue;
   end if;
   select * into saved from imported_change where id = m.id;
   select x.activity_id into target from pg_temp.copy_meeting_activity x where x.meeting_id = m.id;
   mapped := found or (saved.id is not null and saved.record <> jsonb_build_object('id', m.id));
   target := coalesce(target, (saved.record ->> 'id')::uuid, m.id);
   if mapped then
    if not exists (select from public.activity where id = target and kind in ('meeting','tour')) then
     raise check_violation using constraint = 'mapping_not_a_logged_meeting';
    end if;
    if not exists (select from activity where id = target and kind = 'meeting') then
     raise check_violation using constraint = 'mapped_activity_not_copied';
    end if;
   elsif exists (select from activity where id = target) and saved.id is null then
    raise check_violation using constraint = 'activity_id_taken';
   end if;
   if exists (select from imported_change i where i.table_name = 'activity' and i.record = jsonb_build_object('id', target)
    and i.id <> m.id and i.source_event ->> 'source_table' = 'ops.meeting') then
    raise check_violation using constraint = 'activity_already_has_meeting';
   end if;
   if exists (select from meeting_edit e where e.meeting_id = m.id and exists
    (select from meeting_edit p where p.meeting_id = m.id and p.note_number = e.note_number
     and p.revision < e.revision and p.position >= e.position)) then
    raise check_violation using constraint = 'note_history_out_of_order';
   end if;
   summary_before := case when saved.id is not null then saved.source_event -> 'old_value' ->> 'summary'
    when mapped then (select summary from activity where id = target) end;
   base := concat_ws(E'\n\n', m.title, case when summary_before is distinct from m.title then summary_before end);
   summary_after := base;
   delete from meeting_history;
   for n in
    select m.id, m.started_by_actor as author, m.started_at as happened_at, 0::bigint as position,
     null::integer as note_number, null::integer as revision, 'ops.meeting' as source_table
    union all
    select e.id, e.author_actor, e.created_at, e.position, e.note_number, e.revision, 'ops.meeting_note'
    from meeting_edit e where e.meeting_id = m.id order by position
   loop
    select * into actor from copy_event_attribution(n.author, null);
    if not exists (select from public.actor where id = n.author)
     or actor.changed_by_user_id is not null and not exists (select from app_user where id = actor.changed_by_user_id) then
     raise check_violation using constraint = 'author_not_copied';
    end if;
    if n.position > 0 then
     select base || coalesce(E'\n\n' || string_agg('Note ' || note_number || E'\n' || body, E'\n\n' order by note_number), '')
      into summary_after from (select distinct on (note_number) note_number, body from meeting_edit
       where meeting_id = m.id and position <= n.position order by note_number, revision desc) current_notes;
    end if;
    insert into meeting_history (id, table_name, record, field, source_event, old_value_absent, new_value_absent,
     changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
    values (n.id, 'activity', jsonb_build_object('id', target), 'summary',
     jsonb_build_object('id', n.id, 'verb', 'import-meeting-edit', 'cause', 'old_system_import',
      'actor_id', n.author, 'source_table', n.source_table, 'meeting_id', m.id,
      'note_number', n.note_number, 'revision', n.revision,
      'old_value', case when summary_before is not null then jsonb_build_object('summary', summary_before) end,
      'new_value', jsonb_build_object('summary', summary_after)), summary_before is null, false,
     n.happened_at, actor.changed_by_user_id, actor.changed_by_job, actor.changed_for_user_id);
    summary_before := summary_after;
   end loop;
   if exists (select from meeting_history h join imported_change i using (id)
    where to_jsonb(h) is distinct from to_jsonb(i)) then
    raise check_violation using constraint = 'existing_history_conflicts';
   end if;
   -- A copied meeting is frozen; new source revisions wait rather than overwrite a user's later edits.
   if saved.id is not null and exists (select from meeting_history h where not exists (select from imported_change i where i.id = h.id)) then
    raise check_violation using constraint = 'meeting_changed_since_copy';
   end if;
   if saved.id is null then
    select h.* into latest from meeting_history h left join meeting_edit e on e.id = h.id
     order by coalesce(e.position, 0) desc limit 1;
    if exists (select from activity where id = target) then
     update activity set summary = summary_after where id = target;
     update activity set changed_at = latest.changed_at, changed_by_user_id = latest.changed_by_user_id,
      changed_by_job = latest.changed_by_job, changed_for_user_id = latest.changed_for_user_id
      where id = target and changed_at < latest.changed_at;
    else
     insert into activity (id, kind, happened_at, summary, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
     values (target, 'meeting', m.started_at, summary_after, latest.changed_at,
      latest.changed_by_user_id, latest.changed_by_job, latest.changed_for_user_id);
    end if;
    insert into imported_change select * from meeting_history order by changed_at, id;
   end if;
   insert into not_copied select m.id, 'activity', target::text, 'about_nothing_copied'
    where not exists (select from activity_about where activity_id = target);
   insert into not_copied select h.id, 'changed_for_user_id', null, 'agent_user_unknown'
    from meeting_history h where h.changed_by_job = 'agent' and h.changed_for_user_id is null;
  exception when check_violation or foreign_key_violation or unique_violation or not_null_violation then
   get stacked diagnostics failure = constraint_name;
   insert into not_copied values (m.id, 'meeting', m.id::text, failure);
  end;
 end loop;
end $$;
set constraints all immediate;
alter table activity enable trigger stamp_change;
alter table activity enable trigger record_change;
alter table imported_change enable trigger stamp_imported_change;
select * from not_copied order by old_id, field, value, reason;
