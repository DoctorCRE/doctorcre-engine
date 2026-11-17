-- Load copy-attribution.sql first. Run after copy-parties.sql and copy-deal-files.sql, in its own transaction in the new schema.
-- Only reads public. Existing R2 objects are reused; no bytes move and a rerun adds only missing links.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;
alter table document disable trigger stamp_change;
alter table party_document disable trigger stamp_change;

create temp table client_map on commit drop as
with recursive chain as (
 select id as old_id, id, party_id, merged_into, array[id] as path from public.client
 union all
 select c.old_id, n.id, n.party_id, n.merged_into, c.path || n.id from chain c
 join public.client n on n.id = c.merged_into where not n.id = any(c.path)
)
select c.old_id, m.party_id from chain c
join outside_id m on m.source = 'old_system' and m.value = c.party_id::text
where c.merged_into is null;

create temp table candidate on commit drop as
select f.*, m.party_id from (
 select id, subject_id as client_id, r2_key, filename as name, mime, sha256, bytes, created_at, created_by
 from public.attachment where subject_type = 'client' and deleted_at is null
 union
 select a.id, g.client_id, a.r2_key, a.filename, a.mime, a.sha256, a.bytes, a.created_at, a.created_by
 from public.document g join public.attachment a on a.id in (g.working_attachment, g.pdf_attachment)
 where g.deal_id is null and g.client_id is not null and a.deleted_at is null
) f left join client_map m on m.old_id = f.client_id;

create temp table file_refusal on commit drop as
select c.id, c.client_id, c.r2_key, f.field, f.value, f.reason from candidate c
left join document n on (n.r2_bucket, n.r2_key) = ('deal_documents', c.r2_key)
cross join lateral (values
 ('client_id', c.client_id::text, 'client_not_copied', c.party_id is null),
 ('r2_key', c.r2_key, 'file_incomplete', not (c.r2_key ~ '\S' and c.mime ~ '\S' and c.sha256 ~ '^[0-9a-f]{64}$' and c.bytes > 0)),
 ('r2_key', c.r2_key, 'file_conflict', n.id is not null and (n.content_type, n.sha256, n.bytes) is distinct from (c.mime, c.sha256, c.bytes)),
 ('id', c.id::text, 'document_id_taken', exists (select from document o where o.id = c.id
  and (o.r2_bucket, o.r2_key) is distinct from ('deal_documents', c.r2_key)))) f(field, value, reason, refused)
where f.refused;
insert into not_copied select distinct id, field, value, reason from file_refusal;
create temp table copyable on commit drop as
select c.* from candidate c where c.party_id is not null
 and not exists (select from file_refusal r where r.r2_key = c.r2_key and r.reason <> 'client_not_copied');

insert into document (id, created_at, name, r2_bucket, r2_key, content_type, sha256, bytes,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select c.id, c.created_at, c.name, 'deal_documents', c.r2_key, c.mime, c.sha256, c.bytes, c.created_at, a.*
from (select distinct on (r2_key) * from copyable order by r2_key, created_at, id) c
cross join lateral copy_attribution('attachment', c.id, c.created_by) a
where not exists (select from document n where (n.r2_bucket, n.r2_key) = ('deal_documents', c.r2_key));
insert into party_document (party_id, document_id, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select c.party_id, n.id, c.created_at, c.created_at, a.*
from (select distinct on (party_id, r2_key) * from copyable order by party_id, r2_key, created_at, id) c
join document n on (n.r2_bucket, n.r2_key) = ('deal_documents', c.r2_key)
cross join lateral copy_attribution('attachment', c.id, c.created_by) a
where not exists (select from party_document p where (p.party_id, p.document_id) = (c.party_id, n.id));

insert into not_copied select id, 'deleted_at', deleted_at::text, 'attachment_deleted' from public.attachment
where subject_type = 'client' and deleted_at is not null;
insert into not_copied select g.id, f.field, f.value, f.reason from public.document g
left join public.attachment w on w.id = g.working_attachment left join public.attachment p on p.id = g.pdf_attachment
left join client_map m on m.old_id = g.client_id
cross join lateral (values
 ('client_id', g.client_id::text, 'client_not_copied', m.party_id is null),
 ('working_attachment', w.id::text, 'file_deleted', w.deleted_at is not null),
 ('pdf_attachment', p.id::text, 'file_deleted', p.deleted_at is not null),
 ('id', g.id::text, 'no_file', w.id is null and p.id is null),
 ('note', g.note, 'generated_note', g.note ~ '\S')) f(field, value, reason, refused)
where g.deal_id is null and g.client_id is not null and f.refused;
alter table document enable trigger stamp_change;
alter table party_document enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
