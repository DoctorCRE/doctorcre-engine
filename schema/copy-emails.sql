-- Run after copy-activity.sql, in one owner transaction. Load copy-attribution.sql first and put the new schema on search_path.
-- Only public is read.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table activity disable trigger stamp_change;
alter table activity_about disable trigger stamp_change;
alter table email disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

-- public.email arrives with carr-system #3233; until production has it, no email has a Message-ID.
create temp table old_message_id (activity_id uuid primary key, message_id text not null) on commit drop;
do $$ begin
	if to_regclass('public.email') is not null then
		execute 'insert into old_message_id select a.id, e.message_id from public.activity a
			join public.email e on e.id = a.email_id where e.message_id ~ ''\S''';
	end if;
end $$;

create temp table activity_event on commit drop as select * from copy_activity_event();
create temp table old_link on commit drop as select * from copy_activity_link();

-- Today an email filed to several records is one row per record, and mail both partners filed is a row per mailbox.
-- Deleting is per mailbox, so a row is live on its own.
create temp table old_email on commit drop as
select a.id, a.kind, a.occurred_at, a.recorded_at, a.updated_at, a.summary, a.detail, m.message_id,
 nullif(a.email_context ->> 'conversation_id', '') as conversation_id,
 a.email_context #>> '{lifecycle,state}' as lifecycle, coalesce(a.email_context #>> '{lifecycle,state}', 'live') = 'live' as live,
 lower(coalesce(a.email_context #>> '{sender,email}', a.email_source ->> 'sender_email',
  case when a.kind = 'email_out' then a.email_identity ->> 'mailbox_account' end)) as sender,
 coalesce(a.email_context ->> 'subject', substring(a.summary from '^Email (?:from|to) [^:]*: (.*)$'), a.summary) as subject, s.*
from public.activity a left join old_message_id m on m.activity_id = a.id left join activity_event e on e.activity_id = a.id
cross join lateral copy_event_attribution(coalesce(a.updated_by, a.actor_id), e.event_id) s
where a.kind in ('email_in', 'email_out');

-- Without its Message-ID, a row matches by sender, the exact sent time and subject (owner ruling 2026-11-17).
-- The subject ignores case only, as today's intake does when it tells two emails apart.
alter table old_email add match_key jsonb;
update old_email set match_key = jsonb_build_array(sender, occurred_at, lower(subject)) where sender is not null;
-- A row without one joins the email whose Message-ID its match finds, if it finds only one.
update old_email o set message_id = k.message_id
from (select match_key, min(message_id) as message_id from old_email where message_id is not null
 group by match_key having count(distinct message_id) = 1) k
where o.message_id is null and o.match_key = k.match_key;

-- One email per Message-ID, else per match; a rerun keeps the row it copied, so a row filed since never starts a second copy.
create temp table email_group on commit drop as
select o.*, first_value(o.id) over (partition by coalesce(to_jsonb(o.message_id), o.match_key)
  order by o.id in (select activity_id from email) desc, o.live desc, o.recorded_at, o.id) as email_id
from old_email o where o.message_id is not null
 or o.match_key is not null and not exists (select from old_email k where k.match_key = o.match_key and k.message_id is not null);

-- The intake files a preview first, then the full text as a note naming it; older notes match by time and subject.
create temp table full_text on commit drop as
select n.id, n.detail, array(select distinct g.email_id from email_group g
 where g.id::text = n.email_context ->> 'source_activity_id' or n.email_context ->> 'source_activity_id' is null
  and g.occurred_at = n.occurred_at and right(g.summary, length(t.subject) + 2) = ': ' || t.subject) as emails
from public.activity n cross join lateral (select substr(n.summary, length('Full text of email: ') + 1) as subject) t
where n.kind = 'note' and n.summary like 'Full text of email: %';

create temp table mapped_email on commit drop as
select g.*, coalesce((select f.detail from full_text f where f.emails = array[g.email_id] and f.detail is not null
  order by length(f.detail) desc limit 1),
 (select m.detail from email_group m where m.email_id = g.email_id and m.detail is not null order by length(m.detail) desc limit 1),
 '') as body,
 (select m.sender from email_group m where m.email_id = g.email_id and pg_input_is_valid(m.sender, 'email_address')
  order by m.id <> g.id, m.recorded_at, m.id limit 1) as email_sender,
 (select m.conversation_id from email_group m where m.email_id = g.email_id and m.live and m.conversation_id is not null
  order by m.id <> g.id, m.recorded_at, m.id limit 1) as email_conversation_id,
 exists (select from email_group m where m.email_id = g.email_id and m.live) as live_somewhere,
 exists (select from email_group m join old_link l using (id) where m.email_id = g.email_id and m.live
  and (l.deal_id is not null or l.party_id is not null)) as is_about
from email_group g where g.id = g.email_id;

insert into not_copied select g.id, f.field, f.value, f.reason from email_group g join mapped_email e using (email_id)
cross join lateral (values
 ('email_context', g.lifecycle, 'email_not_live', not g.live),
 ('sender', g.sender, 'sender_unknown', g.id = e.id and e.email_sender is null),
 ('activity', g.id::text, 'about_nothing_copied', g.id = e.id and e.live_somewhere and not e.is_about)
) f(field, value, reason, listed) where f.listed;
insert into not_copied select id, case when match_key is null then 'sender' else 'message_id' end, null,
 case when match_key is null then 'no_message_id_or_sender' else 'matches_several_message_ids' end
from old_email where id not in (select id from email_group);
insert into not_copied select l.id, l.field, l.value::text, replace(l.field, '_id', '') || '_not_copied'
from old_link l join email_group g using (id) where g.live and l.deal_id is null and l.party_id is null;
insert into not_copied select id, 'activity', id::text, 'full_text_without_its_email' from full_text where cardinality(emails) <> 1;
insert into not_copied select id, 'kind', kind, 'mail_note_has_no_place' from public.activity
where email_context is not null and kind not in ('email_in', 'email_out') and not (kind = 'note' and summary like 'Full text of email: %');

create temp table ready_email on commit drop as
select * from mapped_email where email_sender is not null and live_somewhere and is_about;
insert into activity (id, kind, happened_at, summary, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select id, 'email', occurred_at, summary, changed_by_user_id, changed_by_job, changed_for_user_id, updated_at
from ready_email on conflict (id) do nothing;
insert into email (activity_id, message_id, conversation_id, sender, subject, body, imported, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select id, message_id, email_conversation_id, email_sender::email_address, subject, body, true,
 changed_by_user_id, changed_by_job, changed_for_user_id, updated_at
from ready_email
-- A row filed since can bring a mailbox fact the copied email lacked.
on conflict (activity_id) do update set message_id = coalesce(email.message_id, excluded.message_id),
 conversation_id = coalesce(email.conversation_id, excluded.conversation_id)
where (email.message_id is null and excluded.message_id is not null)
 or (email.conversation_id is null and excluded.conversation_id is not null);
-- Each live row filed it to its records; links are retried, so a record copied since then gains its link.
insert into activity_about (activity_id, deal_id, party_id, created_at, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select distinct on (g.email_id, l.deal_id, l.party_id) g.email_id, l.deal_id, l.party_id, g.recorded_at,
 g.changed_by_user_id, g.changed_by_job, g.changed_for_user_id, g.updated_at
from email_group g join ready_email using (email_id) join old_link l on l.id = g.id
where g.live and (l.deal_id is not null or l.party_id is not null)
order by g.email_id, l.deal_id, l.party_id, g.recorded_at, g.id
on conflict do nothing;
-- Later copies find the email each of today's rows became.
insert into outside_id (source, value, email_activity_id)
select 'old_system', g.id::text, g.email_id from email_group g join email e on e.activity_id = g.email_id
on conflict do nothing;

set constraints all immediate;
alter table activity enable trigger stamp_change;
alter table activity_about enable trigger stamp_change;
alter table email enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
