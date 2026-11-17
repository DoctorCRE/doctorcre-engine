-- Run after copy-emails.sql, in one owner transaction, with copy-attribution.sql loaded and the new schema on search_path.
-- Only public is read.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table reply_draft disable trigger reply_draft_delivery, disable trigger stamp_change, disable trigger record_change;
alter table change disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

-- public.email arrives with carr-system #3233. The email copy may keep the other mailbox's row of a draft's email.
create temp table old_message_id (activity_id uuid primary key, message_id text not null) on commit drop;
do $$ begin
	if to_regclass('public.email') is not null then
		execute 'insert into old_message_id select a.id, e.message_id from public.activity a
			join public.email e on e.id = a.email_id where e.message_id is not null';
	end if;
end $$;

-- Production holds only pending, dismissed and failed drafts. A failed draft was submitted, and what was submitted was approved.
create temp table old_draft on commit drop as
select p.id, p.activity_id, p.owner, p.evidence_quote, p.status, p.created_at, p.resolved_by, p.resolved_at, p.resolution_reason,
 p.resolution_note, p.deferred_until, p.result_recorded_at, owner.id as owner_user_id,
 case when p.status in ('pending', 'dismissed', 'failed') then p.status end as new_status,
 coalesce(p.submitted_email ->> 'subject', p.draft_subject) as subject, coalesce(p.submitted_email ->> 'body', p.draft_body) as body,
 p.submitted_email -> 'to' as to_list, p.submitted_email -> 'cc' as cc_list, p.submitted_email -> 'attachments' as attachments,
 p.send_result ->> 'reason' as failure_reason,
 coalesce((select activity_id from email where activity_id = p.activity_id),
  (select e.activity_id from email e join old_message_id m using (message_id) where m.activity_id = p.activity_id)) as email_activity_id,
 (select u.id from app_user u where u.id = decided.changed_by_user_id) as decider, decided.changed_by_user_id as decided_by_user,
 decided.changed_by_job as decided_by_job, decided.changed_for_user_id as decided_for_user
from public.email_proposal p
left join public.actor a on a.slug = p.owner
left join outside_id o on o.source = 'old_system' and o.value = a.id::text
left join app_user owner on owner.id = o.party_id
cross join lateral copy_event_attribution(p.resolved_by, null) decided
where p.kind = 'reply_draft';

insert into not_copied select d.id, f.field, f.value, f.reason from old_draft d cross join lateral (values
 ('status', d.status, 'status_not_copied', d.new_status is null),
 ('owner', d.owner, 'owner_not_a_user', d.owner_user_id is null),
 ('activity_id', d.activity_id::text, 'email_not_copied', d.email_activity_id is null),
 ('evidence_quote', d.evidence_quote, 'blank_evidence', d.evidence_quote !~ '\S'),
 ('subject', d.subject, 'blank_subject', d.subject !~ '\S'),
 ('body', d.body, 'blank_body', d.body !~ '\S'),
 ('resolved_by', d.resolved_by::text, 'decision_needs_user', d.decided_by_user is not null and d.decider is null),
 ('resolved_by', d.resolved_by::text, 'approval_needs_its_owner', d.new_status = 'failed' and d.decider is distinct from d.owner_user_id),
 ('submitted_email', d.to_list::text || ' ' || d.cc_list::text, 'recipients_not_one_each', d.new_status = 'failed'
  and not (d.to_list = jsonb_build_array(d.to_list ->> 0) and d.cc_list = jsonb_build_array(d.cc_list ->> 0)
   and pg_input_is_valid(lower(d.to_list ->> 0), 'email_address') and pg_input_is_valid(lower(d.cc_list ->> 0), 'email_address'))),
 -- Today's attachments are paths on a partner's computer, not stored documents.
 ('submitted_email', d.attachments::text, 'attachment_not_a_document', coalesce(d.attachments, '[]') <> '[]'),
 ('send_result', d.failure_reason, 'failure_without_reason', d.new_status = 'failed' and coalesce(d.failure_reason, '') !~ '\S'),
 ('result_recorded_at', null, 'failure_time_unknown', d.new_status = 'failed' and d.result_recorded_at is null)
) f(field, value, reason, refused) where f.refused and (d.new_status is not null or f.field = 'status');

-- The row names whoever made its latest change: the old system drafting it, its decider, or the owner's mailbox recording the try.
create temp table ready on commit drop as
select d.id, d.created_at, d.email_activity_id, d.owner_user_id, d.evidence_quote as evidence, d.subject, d.body, d.new_status as status,
 case when d.new_status <> 'pending' then d.resolved_at end as decided_at,
 case when d.new_status = 'dismissed' then d.resolution_reason end as dismiss_reason,
 case when d.new_status = 'failed' then lower(d.to_list ->> 0) end as to_address,
 case when d.new_status = 'failed' then lower(d.cc_list ->> 0) end as cc_address,
 case when d.new_status = 'failed' then d.failure_reason end as failure_reason,
 case when d.new_status = 'dismissed' then d.decided_by_user end as changed_by_user_id,
 case when d.new_status = 'dismissed' then d.decided_by_job else 'old_system' end as changed_by_job,
 case d.new_status when 'dismissed' then d.decided_for_user when 'failed' then d.owner_user_id end as changed_for_user_id,
 case d.new_status when 'pending' then d.created_at when 'dismissed' then d.resolved_at else d.result_recorded_at end as changed_at
from old_draft d where not exists (select from not_copied n where n.old_id = d.id);

-- A copied draft is left as it is; a changed draft, or two drafts of one reply, wait for a user.
insert into not_copied select r.id, 'reply_draft', r.id::text, 'existing_draft_conflicts' from ready r
where exists (select from reply_draft x where (x.id = r.id) <> ((x.email_activity_id, x.owner_user_id) = (r.email_activity_id, r.owner_user_id))
 or x.id = r.id and (x.created_at, x.proposed_by_job, x.evidence, x.subject, x.body, x.status, x.decided_at, x.dismiss_reason,
  x.to_address, x.cc_address, x.failure_reason) is distinct from (r.created_at, 'old_system', r.evidence,
  r.subject, r.body, r.status, r.decided_at, r.dismiss_reason, r.to_address, r.cc_address, r.failure_reason))
 or exists (select from ready other where other.id <> r.id
  and (other.email_activity_id, other.owner_user_id) = (r.email_activity_id, r.owner_user_id));

insert into not_copied select d.id, f.field, f.value, f.reason from old_draft d cross join lateral (values
 ('deferred_until', d.deferred_until::text, 'snooze_waits_for_home_marks', d.deferred_until is not null),
 ('resolution_note', d.resolution_note, 'note_has_no_place', d.resolution_note ~ '\S')
) f(field, value, reason, listed) where f.listed and exists (select from ready r where r.id = d.id)
 and not exists (select from not_copied n where n.old_id = d.id and n.reason = 'existing_draft_conflicts');

create temp table copied on commit drop as
with inserted as (
 insert into reply_draft (id, created_at, email_activity_id, owner_user_id, proposed_by_job, evidence, subject, body, status, decided_at,
  dismiss_reason, to_address, cc_address, failure_reason, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
 select id, created_at, email_activity_id, owner_user_id, 'old_system', evidence, subject, body, status, decided_at,
  dismiss_reason, to_address, cc_address, failure_reason, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at
 from ready r where not exists (select from not_copied n where n.old_id = r.id and n.reason = 'existing_draft_conflicts')
 on conflict (id) do nothing returning *
) select * from inserted;

-- History is written from today's times: drafted pending, then decided, then the owner's mailbox's try.
insert into change (table_name, record, action, old_value, new_value, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'reply_draft', jsonb_build_object('id', d.id), 'insert', null,
 to_jsonb(d) - array['changed_by_user_id', 'changed_by_job', 'changed_for_user_id', 'changed_at'] || '{"status": "pending"}'
  || (select jsonb_object_agg(k, null::jsonb)
   from unnest(array['decided_at', 'dismiss_reason', 'to_address', 'cc_address', 'failure_reason']) k),
 null, 'old_system', null, d.created_at
from copied d;
insert into change (table_name, record, action, old_value, new_value, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'reply_draft', jsonb_build_object('id', d.id), 'update',
 (select jsonb_object_agg(k, null::jsonb) from unnest(s.fields) k) || jsonb_build_object('status', s.was),
 (select jsonb_object_agg(k, to_jsonb(d) -> k) from unnest(s.fields) k) || jsonb_build_object('status', s.became),
 s.by_user, s.by_job, s.for_user, s.at
from copied d cross join lateral (values
 ('pending', 'dismissed', array['decided_at', 'dismiss_reason'], d.changed_by_user_id, d.changed_by_job, d.changed_for_user_id, d.decided_at),
 ('pending', 'approved', array['decided_at', 'to_address', 'cc_address'], d.owner_user_id, null, null, d.decided_at),
 ('approved', 'failed', array['failure_reason'], null, 'old_system', d.owner_user_id, d.changed_at)
) s(was, became, fields, by_user, by_job, for_user, at)
where d.status = s.became or d.status = 'failed' and s.became = 'approved';

set constraints all immediate;
alter table reply_draft enable trigger reply_draft_delivery, enable trigger stamp_change, enable trigger record_change;
alter table change enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
