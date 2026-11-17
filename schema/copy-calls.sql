-- Run after copy-activity.sql, in one owner transaction, with copy-attribution.sql loaded and the new schema on search_path.
-- Only public is read.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table activity disable trigger stamp_change;
alter table activity_about disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

-- A meeting capture whose record was logged is that activity, which copy-activity.sql copies.
create temp table old_call on commit drop as
select s.id, coalesce(logged.id, s.id) as activity_id, logged.id is not null as is_logged,
 case when s.post_call then 'call' else 'meeting' end as kind, s.started_at as happened_at,
 s.created_at, s.state_at as changed_at, s.state, p.sha256 as recording, r.report_sha256,
 p.studio_status ->> 'state' as review_state,
 coalesce(nullif(concat_ws(E'\n\n', nullif(btrim(p.projection ->> 'summary'), ''),
  (select 'Decisions:' || string_agg(E'\n- ' || btrim(d.value), '' order by d.n)
   from jsonb_array_elements_text(p.projection -> 'decisions') with ordinality d(value, n) where d.value ~ '\S'),
  (select 'Open questions:' || string_agg(E'\n- ' || btrim(q.value), '' order by q.n)
   from jsonb_array_elements_text(p.projection -> 'open_questions') with ordinality q(value, n) where q.value ~ '\S')), ''),
  case when logged.id is null then record.text end) as summary, record.records,
 a.*
from public.capture_session s
left join public.phone_call_session p using (id)
left join public.capture_post_call_report r on r.session_id = s.id
-- Of several logged records, today's session screen shows the greatest.
cross join lateral (select max(o.id::text)::uuid as id from public.capture_candidate c join public.activity o on o.id::text = c.resulting_ref
 where c.session_id = s.id and c.kind = 'meeting_record' and c.status = 'confirmed') logged
cross join lateral (select count(*) as records, case when count(*) = 1 then max(concat_ws(E'\n\n',
  case when c.payload ->> 'summary' ~ '\S' then c.payload ->> 'summary' end,
  case when c.payload ->> 'detail' ~ '\S' then c.payload ->> 'detail' end)) end as text
 from public.capture_candidate c where c.session_id = s.id and c.kind = 'meeting_record' and c.status <> 'skipped'
  and (c.payload ->> 'summary' ~ '\S' or c.payload ->> 'detail' ~ '\S')) record
cross join lateral copy_attribution('capture_session', s.id, s.actor_id) a;

-- A call is about each record its suggestions name; a client, lead or vendor is about its person or company.
create temp table old_link on commit drop as
select distinct k.id, k.field, k.value, o.deal_id, o.party_id
from (
 select session_id as id, 'deal_id' as field, deal_id::text as value from public.capture_post_call_candidate
 union all
 select c.session_id, f.field, f.value from public.capture_candidate c
 cross join lateral (values ('deal', c.payload ->> 'deal'), ('ref', c.payload ->> 'ref')) f(field, value)
 where f.value is not null
) k
join old_call using (id)
left join public.client c on c.id::text = k.value
left join public.lead l on l.id::text = k.value
left join public.vendor v on v.id::text = k.value
left join outside_id o on o.source = 'old_system' and o.value = coalesce(c.party_id::text, l.party_id::text, v.party_id::text, k.value);

insert into not_copied select c.id, f.field, f.value, f.reason from old_call c cross join lateral (values
 ('activity', c.id::text, 'about_nothing_copied', not c.is_logged
  and not exists (select from old_link l where l.id = c.id and (l.deal_id is not null or l.party_id is not null))),
 ('activity', c.activity_id::text, 'source_activity_not_copied', c.is_logged
  and not exists (select from activity a where a.id = c.activity_id)),
 ('meeting_record', c.records::text, 'several_meeting_records', not c.is_logged and c.records > 1),
 ('state', c.state, 'capture_unfinished', c.state <> 'done'),
 ('recording', c.recording, 'recording_not_copied', c.recording is not null),
 ('report_sha256', c.report_sha256, 'report_text_not_stored', c.report_sha256 is not null and c.summary is null),
 ('review_state', c.review_state, 'review_state_has_no_place', c.review_state is not null)
) f(field, value, reason, listed) where f.listed;
insert into not_copied select id, field, value, replace(field, '_id', '') || '_not_copied' from old_link where deal_id is null and party_id is null;
insert into not_copied select c.session_id, 'meeting_record', c.id::text, 'meeting_record_skipped'
from public.capture_candidate c join old_call o on o.id = c.session_id
where c.kind = 'meeting_record' and c.status = 'skipped' and (c.payload ->> 'summary' ~ '\S' or c.payload ->> 'detail' ~ '\S');

-- A logged meeting gains the links of its session's other suggestions once the activity copy has carried it.
create temp table ready_call on commit drop as
select * from old_call c where case when is_logged then exists (select from activity a where a.id = c.activity_id)
 else exists (select from old_link l where l.id = c.id and (l.deal_id is not null or l.party_id is not null)) end;
insert into activity (id, kind, happened_at, summary, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select id, kind, happened_at, summary, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at
from ready_call where not is_logged on conflict do nothing;
-- Links are retried for calls copied earlier, so a record copied since then gains its link.
insert into activity_about (activity_id, deal_id, party_id, created_at, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select distinct c.activity_id, l.deal_id, l.party_id, c.created_at, c.changed_by_user_id, c.changed_by_job, c.changed_for_user_id, c.changed_at
from ready_call c join old_link l using (id) where l.deal_id is not null or l.party_id is not null
on conflict do nothing;

set constraints all immediate;
alter table activity enable trigger stamp_change;
alter table activity_about enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
