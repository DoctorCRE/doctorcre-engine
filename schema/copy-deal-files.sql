-- Load copy-attribution.sql after next.sql first. Run after copy-deals.sql and copy-leases.sql, in a separate transaction, with search_path set to the new schema.
-- Only reads public and ops. A file keeps its old id and R2 key, and a repeat files only what is not yet on its deal. No bytes move.
-- Optional pg_temp.copy_template_kind maps a reviewed template slug to the kind of every file it generated.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
create temp table if not exists copy_template_kind (template_slug text primary key, kind text not null) on commit drop;
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;
alter table document disable trigger stamp_change;
insert into document_kind (slug, label) values ('loi', 'LOI'), ('counter', 'Counter'), ('lease', 'Lease'),
 ('amendment', 'Amendment'), ('invoice', 'Invoice'), ('other', 'Other') on conflict do nothing;
insert into not_copied select t.id, 'slug', t.slug, 'unknown_kind' from public.doc_template t
join copy_template_kind m on m.template_slug = t.slug where m.kind not in (select slug from document_kind);

-- A deliverable's version counts its sharing changes, not replacements, so each file is its own first version.
create temp table candidate on commit drop as
select f.*, exists (select from deal n where n.id = f.deal_id) as deal_copied from (
 select v.id, v.deal_id, v.object_key as r2_key, v.filename as name, v.mime, v.sha256, v.bytes,
  v.created_at, v.finalized_at as changed_at, a.id as author_id, null as kind
 from ops.deal_deliverable v left join public.actor a on a.slug = v.created_by where v.state = 'finalized'
 union all
 select id, subject_id, r2_key, filename, mime, sha256, bytes, created_at, created_at, created_by, null
 from public.attachment where subject_type = 'deal' and deleted_at is null
 union all
 select a.id, g.deal_id, a.r2_key, a.filename, a.mime, a.sha256, a.bytes, a.created_at, a.created_at, a.created_by, m.kind
 from public.document g join public.attachment a on a.id in (g.working_attachment, g.pdf_attachment) and a.deleted_at is null
 left join public.doc_template t on t.id = g.template_id
 left join copy_template_kind m on m.template_slug = t.slug and m.kind in (select slug from document_kind)
 where g.deal_id is not null
) f;

-- Old rows naming one key are one file, so they must agree with each other and with a file already stored there.
create temp table file_refusal on commit drop as
select c.id, c.r2_key, f.field, f.value, f.reason from candidate c
left join document n on (n.r2_bucket, n.r2_key) = ('deal_documents', c.r2_key)
cross join lateral (values
 ('deal_id', c.deal_id::text, 'deal_not_copied', not c.deal_copied),
 ('r2_key', c.r2_key, 'file_incomplete', not (c.r2_key ~ '\S' and c.mime ~ '\S' and c.sha256 ~ '^[0-9a-f]{64}$' and c.bytes > 0)),
 ('r2_key', c.r2_key, 'file_conflict', exists (select from candidate o where o.r2_key = c.r2_key
  and (o.deal_id, o.mime, o.sha256, o.bytes) is distinct from (c.deal_id, c.mime, c.sha256, c.bytes))
  or (coalesce(n.deal_id, c.deal_id), coalesce(n.content_type, c.mime), coalesce(n.sha256, c.sha256), coalesce(n.bytes, c.bytes))
  is distinct from (c.deal_id, c.mime, c.sha256, c.bytes)),
 ('kind', c.kind, 'several_kinds', exists (select from candidate o where o.r2_key = c.r2_key and o.kind <> c.kind)),
 ('id', c.id::text, 'document_id_taken', exists (select from document o where o.id = c.id
  and (o.r2_bucket, o.r2_key) is distinct from ('deal_documents', c.r2_key)))) f(field, value, reason, refused)
where f.refused;
insert into not_copied select distinct id, field, value, reason from file_refusal;
create temp table copyable on commit drop as
select distinct on (c.r2_key) c.*, coalesce(max(c.kind) over (partition by c.r2_key), 'other') as file_kind
from candidate c where not exists (select from file_refusal r where r.r2_key = c.r2_key)

order by c.r2_key, c.created_at, c.id;

insert into document (id, created_at, name, r2_bucket, r2_key, content_type, sha256, bytes, deal_id, kind,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select c.id, c.created_at, c.name, 'deal_documents', c.r2_key, c.mime, c.sha256, c.bytes, c.deal_id, c.file_kind, c.changed_at, a.*
from copyable c cross join lateral copy_attribution('attachment', c.id, c.author_id) a
where not exists (select from document n where (n.r2_bucket, n.r2_key) = ('deal_documents', c.r2_key));
-- A lease's source file was stored without its deal.
update document n set deal_id = c.deal_id, kind = c.file_kind, content_type = c.mime, sha256 = c.sha256, bytes = c.bytes
from copyable c where (n.r2_bucket, n.r2_key) = ('deal_documents', c.r2_key) and n.deal_id is null;
insert into not_copied select distinct n.id, 'kind', n.kind, 'kind_unclassified' from document n
join candidate c on (n.r2_bucket, n.r2_key, n.deal_id) = ('deal_documents', c.r2_key, c.deal_id) where n.kind = 'other';
insert into not_copied select id, 'deleted_at', deleted_at::text, 'attachment_deleted' from public.attachment
where subject_type = 'deal' and deleted_at is not null;

insert into outside_id (source, value, deal_id)
select distinct 'old_generated_document', g.id::text, g.deal_id from public.document g
join public.attachment a on a.id in (g.working_attachment, g.pdf_attachment)
join document n on (n.r2_bucket, n.r2_key, n.deal_id) = ('deal_documents', a.r2_key, g.deal_id)
on conflict do nothing;
insert into not_copied select g.id, f.field, f.value, f.reason from public.document g
left join public.attachment w on w.id = g.working_attachment left join public.attachment p on p.id = g.pdf_attachment
cross join lateral (values
 ('client_id', g.client_id::text, 'no_deal', g.deal_id is null),
 ('working_attachment', w.id::text, 'file_deleted', w.deleted_at is not null),
 ('pdf_attachment', p.id::text, 'file_deleted', p.deleted_at is not null),
 ('id', g.id::text, 'no_file', w.id is null and p.id is null),
 ('id', g.id::text, 'outside_id_taken', exists (select from outside_id o
  where (o.source, o.value) = ('old_generated_document', g.id::text) and o.deal_id is distinct from g.deal_id)),
 ('note', g.note, 'generated_note', g.note ~ '\S')) f(field, value, reason, refused)
where f.refused;
alter table document enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
