-- Run after copy-emails.sql, in its own owner transaction with the new schema on search_path. Only reads public and ops.
-- The intake marks each attachment it filed with an attach-deal-file event, and names the email of an outside sender's one in a reply proposal.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;

-- One row per emailed attachment and the email a proposal names, even when the attachment reused an earlier filing.
create temp table emailed on commit drop as
with event_attachment as (
 select case when pg_input_is_valid(new_value ->> 'attachment_id', 'uuid')
  then (new_value ->> 'attachment_id')::uuid end as attachment_id
 from public.event where verb = 'attach-deal-file'
), source_link as (
 select attachment_id, activity_id from ops.requirement_reply_proposal
 union
 select e.attachment_id, null::uuid from event_attachment e where e.attachment_id is not null
 and not exists (select from ops.requirement_reply_proposal p where p.attachment_id = e.attachment_id)
)
select s.attachment_id as id, a.id is null as attachment_missing, a.deleted_at,
 n.id as document_id, s.activity_id, o.email_activity_id
from source_link s
left join public.attachment a on a.id = s.attachment_id
left join lateral (
 select d.id from document d
 where a.subject_type = 'deal' and a.deleted_at is null
 and d.r2_bucket = 'deal_documents' and d.deal_id = a.subject_id
 and (d.r2_key = a.r2_key or (d.sha256, d.bytes) = (a.sha256, a.bytes))
 order by (d.r2_key = a.r2_key) desc, d.created_at, d.id limit 1
) n on true
left join outside_id o on (o.source, o.value) = ('old_system', s.activity_id::text);

insert into email_document (email_activity_id, document_id)
select email_activity_id, document_id from emailed where email_activity_id is not null and document_id is not null
on conflict do nothing;

insert into not_copied
select f.id, case when f.activity_id is null then 'email' else 'activity_id' end, f.activity_id::text,
 issue.reason
from emailed f cross join lateral (values
 ('attachment_missing', f.attachment_missing),
 ('attachment_deleted', f.deleted_at is not null),
 ('document_not_copied', not f.attachment_missing and f.deleted_at is null and f.document_id is null),
 ('email_unknown', f.activity_id is null),
 ('email_not_copied', f.activity_id is not null and f.email_activity_id is null)
) issue(reason, missing) where issue.missing;
select * from not_copied order by old_id, field, value, reason;
