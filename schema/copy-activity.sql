-- Run after copy-parties.sql and copy-deals.sql, and before copy-lead-stage-moves.sql, in one owner transaction.
-- Load copy-attribution.sql first and put the new schema on search_path. Only public is read.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table activity disable trigger stamp_change;
alter table activity_about disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

create temp table activity_event on commit drop as select * from copy_activity_event();

create temp table old_activity on commit drop as
select a.id, a.kind as old_kind, a.occurred_at as happened_at, a.recorded_at as created_at, a.updated_at as changed_at,
 a.summary, a.detail, a.owed, a.connected, a.kind = 'note' and a.deal_id is not null as is_deal_note,
 -- The mail intake files an email's full text as a note, sometimes without context; copy-emails.sql copies it.
 a.kind in ('email_in', 'email_out') or a.email_context is not null
  or a.kind = 'note' and a.summary like 'Full text of email: %' as is_mail, s.*
from public.activity a left join activity_event e on e.activity_id = a.id
cross join lateral copy_event_attribution(coalesce(a.updated_by, a.actor_id), e.event_id) s
where not (a.kind = 'note' and a.source = 'import' and a.summary = 'last-touch stamp (imported)')
union all
-- A written next step is history only: it opens with its label and makes no next step.
select n.id, n.kind, n.created_at, n.created_at, n.created_at,
 concat(case when n.kind = 'next_step' then E'Recorded next step\n\n' end, n.text), null, null, null, n.kind = 'note', false, s.*
from public.deal_note n left join copy_next_step_event() p on p.note_id = n.id
cross join lateral copy_event_attribution(n.actor_id, case n.kind when 'note' then (select e.id from public.event e
 -- Adding a note writes its event in the same transaction, so the times match.
 where e.verb = 'add-deal-note' and e.subject_type = 'deal' and e.subject_id = n.deal_id
  and e.actor_id = n.actor_id and e.occurred_at = n.created_at and e.new_value ->> 'note' = n.text
 order by e.mutation_order desc limit 1) else p.event_id end) s;

insert into not_copied
select id, 'kind', kind, 'imported_last_touch_stamp'
from public.activity where kind = 'note' and source = 'import' and summary = 'last-touch stamp (imported)';

create temp table old_link on commit drop as select * from copy_activity_link();

create temp table dated_deal_note on commit drop as
with dated_item(pattern) as (
 -- The old spreadsheet import wrote Python strings, with either quote around the text.
 values ($re$\{\s*'date'\s*:\s*'([^'\\]*)'\s*,\s*'text'\s*:\s*('[^'\\]*'|"[^"\\]*")\s*\}$re$)
), note_list as (
 select a.id, case
  when a.summary is json array with unique keys then a.summary::jsonb
  when a.summary ~ ('^\s*\[\s*(?:' || p.pattern || '\s*,\s*)*' || p.pattern || '\s*\]\s*$')
  then (select jsonb_agg(jsonb_build_object('date', r.parts[1],
    'text', substr(r.parts[2], 2, length(r.parts[2]) - 2)) order by r.position)
   from regexp_matches(a.summary, p.pattern, 'g') with ordinality r(parts, position))
  end as items
 from old_activity a cross join dated_item p
 where a.is_deal_note and not a.is_mail and a.summary ~ '^\s*\[\s*[{]'
)
select l.id, case when bool_and(case when jsonb_typeof(entry.item) = 'object' then
 coalesce(entry.date_label is not null and jsonb_typeof(entry.item -> 'text') = 'string'
  and entry.item ->> 'text' ~ '\S' and entry.item - array['date', 'text'] = '{}'::jsonb, false)
 else false end)
 then string_agg(entry.date_label || E'\n' || (entry.item ->> 'text'), E'\n\n' order by entry.position)
 end as summary
from note_list l
left join lateral (
 select item, position, case
  when date_text ~ '^\d{4}-\d\d-\d\d$' and pg_input_is_valid(date_text, 'date')
   then to_char(date_text::date, 'FMMonth FMDD, YYYY')
  when date_text ~ '^[[:alnum:] .–—,-]+$' and date_text ~*
   '\m(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?|early|mid|late|around|before|after|week|spring|summer|fall|winter)\M'
   then date_text end as date_label
 from jsonb_array_elements(l.items) with ordinality e(item, position)
 cross join lateral (select item ->> 'date' as date_text) d
) entry on true
group by l.id;

create temp table mapped_activity on commit drop as
select a.*, case when a.is_mail then null else m.kind end as kind,
 nullif(concat_ws(E'\n\n', case when m.keeps_word then k.label end,
  case when dated.id is not null then dated.summary
   when a.summary ~ '\S' and not (a.is_deal_note and a.summary ~ '^\s*\[\s*\]\s*$') then a.summary end,
  case when a.detail ~ '\S' and a.detail is not json object then a.detail end,
  case when a.owed ~ '\S' then E'Information still missing\n' || a.owed end), '') as text,
 dated.id is not null and dated.summary is null as unreadable_list,
 exists (select from old_link l where l.id = a.id and (l.deal_id is not null or l.party_id is not null)) as is_about
from old_activity a
left join (values ('call', 'call', false), ('meeting', 'meeting', false), ('tour', 'meeting', false), ('note', 'note', false),
 ('next_step', 'note', false), ('text', 'note', true), ('analysis', 'note', true), ('loi', 'note', true),
 ('counter_sent', 'note', true), ('counter_received', 'note', true), ('lease_signed', 'note', true)) m(old_kind, kind, keeps_word) using (old_kind)
-- A kind with no place of its own becomes a note that opens with its old label, so the partners' word survives.
left join public.activity_kind k on k.slug = a.old_kind
left join dated_deal_note dated on dated.id = a.id;

insert into not_copied select a.id, f.field, f.value, f.reason from mapped_activity a cross join lateral (values
 ('kind', a.old_kind, 'kind_has_no_place', a.kind is null and not a.is_mail),
 ('activity', a.id::text, 'about_nothing_copied', a.kind is not null and not a.is_about),
 ('summary', null, 'unreadable_dated_note', a.unreadable_list),
 ('summary', null, 'empty_deal_note', a.kind = 'note' and a.is_deal_note and a.text is null and not a.unreadable_list),
 ('detail', a.detail, 'structured_detail_not_copied', a.kind is not null and a.detail is json object),
 ('changed_for_user_id', null, 'agent_user_unknown', a.kind is not null and a.changed_by_job = 'agent' and a.changed_for_user_id is null)
) f(field, value, reason, listed) where f.listed;
insert into not_copied select l.id, l.field, l.value::text, replace(l.field, '_id', '') || '_not_copied'
from old_link l join mapped_activity a using (id)
where a.kind is not null and l.deal_id is null and l.party_id is null;

create temp table ready_activity on commit drop as
select * from mapped_activity where kind is not null and is_about and (not is_deal_note or text is not null);
insert into activity (id, kind, happened_at, summary, reached, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select id, kind, happened_at, copy_note_text(text, kind = 'note'), connected, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at
from ready_activity on conflict do nothing;
-- Links are retried for activities copied earlier, so a record copied since then gains its link.
insert into activity_about (activity_id, deal_id, party_id, created_at, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select distinct a.id, l.deal_id, l.party_id, a.created_at, a.changed_by_user_id, a.changed_by_job, a.changed_for_user_id, a.changed_at
from ready_activity a join old_link l using (id) where l.deal_id is not null or l.party_id is not null
on conflict do nothing;

set constraints all immediate;
alter table activity enable trigger stamp_change;
alter table activity_about enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
