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
			join public.email e on e.id = a.email_id where e.message_id is not null';
	end if;
end $$;

create temp table activity_event on commit drop as select * from copy_activity_event();
create temp table old_link on commit drop as select * from copy_activity_link();

-- Today an email filed to several records is one row per record, and mail both partners filed is a row per mailbox.
-- Deleting is per mailbox, so a row is live on its own.
create temp table old_email on commit drop as
select o.*, jsonb_build_array(o.kind,
  case when o.mailbox_item is null then o.occurred_at else min(o.occurred_at) over (partition by o.kind, o.mailbox_item) end,
  o.sender, case o.kind when 'email_in' then o.subject else o.summary end) as content_key
from (select a.id, a.kind, a.occurred_at, a.recorded_at, a.updated_at, a.summary, a.detail, m.message_id,
 a.email_context #>> '{lifecycle,state}' as lifecycle, coalesce(a.email_context #>> '{lifecycle,state}', 'live') = 'live' as live,
 case when a.email_identity ->> 'item_id' is not null
  then array[a.email_identity ->> 'mailbox_account', a.email_identity ->> 'item_id'] end as mailbox_item,
 lower(coalesce(a.email_context #>> '{sender,email}', a.email_source ->> 'sender_email',
  case when a.kind = 'email_out' then a.email_identity ->> 'mailbox_account' end)) as sender,
 coalesce(a.email_context ->> 'subject', substring(a.summary from '^Email (?:from|to) [^:]*: (.*)$'), a.summary) as subject, s.*
 from public.activity a left join old_message_id m on m.activity_id = a.id left join activity_event e on e.activity_id = a.id
 cross join lateral copy_event_attribution(coalesce(a.updated_by, a.actor_id), e.event_id) s
 where a.kind in ('email_in', 'email_out')) o;

-- One email per Message-ID. Without one, rows with the same content key are one email,
-- which takes the Message-ID of the only such email that has one.
-- A rerun keeps the row it copied, so a row filed since never starts a second copy.
create temp table email_group on commit drop as
select k.*, first_value(k.id) over (partition by k.email_key
  order by k.id in (select activity_id from email) desc, k.live desc, k.recorded_at, k.id) as email_id
from (select o.*, coalesce(to_jsonb(o.found_id), o.content_key) as email_key
 from (select o.*, coalesce(o.message_id, case when min(o.message_id) over w = max(o.message_id) over w
   then min(o.message_id) over w end) as found_id
  from old_email o window w as (partition by o.content_key)) o) k;

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
insert into email (activity_id, message_id, sender, subject, body, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select id, found_id, email_sender::email_address, subject, body, changed_by_user_id, changed_by_job, changed_for_user_id, updated_at
from ready_email on conflict (activity_id) do nothing;
-- Each live row filed it to its records; links are retried, so a record copied since then gains its link.
insert into activity_about (activity_id, deal_id, party_id, created_at, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select distinct on (g.email_id, l.deal_id, l.party_id) g.email_id, l.deal_id, l.party_id, g.recorded_at,
 g.changed_by_user_id, g.changed_by_job, g.changed_for_user_id, g.updated_at
from email_group g join ready_email using (email_id) join old_link l on l.id = g.id
where g.live and (l.deal_id is not null or l.party_id is not null)
order by g.email_id, l.deal_id, l.party_id, g.recorded_at, g.id
on conflict do nothing;

set constraints all immediate;
alter table activity enable trigger stamp_change;
alter table activity_about enable trigger stamp_change;
alter table email enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
