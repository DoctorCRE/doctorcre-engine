-- Run after copy-emails.sql, in its own owner transaction with the new schema on search_path. Only reads public and ops.
-- The intake marks each attachment it filed with an attach-deal-file event, and names the email of an outside sender's one in a reply proposal.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;

-- One row per emailed attachment and the email a proposal names; rows naming one key are one file, as in the deal-file copy.
create temp table emailed on commit drop as
select a.id, n.id as document_id, p.activity_id, o.email_activity_id
from public.attachment a
join document n on (n.r2_bucket, n.r2_key, n.deal_id) = ('deal_documents', a.r2_key, a.subject_id)
left join ops.requirement_reply_proposal p on p.attachment_id = a.id
left join outside_id o on (o.source, o.value) = ('old_system', p.activity_id::text)
where a.subject_type = 'deal' and a.deleted_at is null and (p.id is not null or exists (select from public.event v
 where v.verb = 'attach-deal-file' and v.new_value ->> 'attachment_id' = a.id::text));

insert into email_document (email_activity_id, document_id)
select email_activity_id, document_id from emailed where email_activity_id is not null
on conflict do nothing;

insert into not_copied
select f.id, case when f.activity_id is null then 'email' else 'activity_id' end, f.activity_id::text,
 case when f.activity_id is null then 'email_unknown' else 'email_not_copied' end
from emailed f where not exists (select from email_document ed where ed.document_id = f.document_id);
select * from not_copied order by old_id, field, value, reason;
