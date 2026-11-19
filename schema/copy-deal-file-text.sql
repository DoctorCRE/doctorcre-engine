-- Load copy-attribution.sql after next.sql first. Run after copy-deal-files.sql, in a separate transaction, with search_path set to the new schema.
-- Only reads public and ops. Each old page text and fact receipt becomes an attempt on the deal file its attachment became, and a repeat adds only what is not yet there.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;
alter table document_extraction disable trigger stamp_change;

-- A page text has no id or author of its own; it is listed by its attachment.
create temp table attempt on commit drop as
select row_number() over () as n, c.*, a.deleted_at, d.id as document_id, d.deal_id, d.sha256, w.* from (
 select t.document_ref as old_id, null::uuid as id, t.document_ref, t.entity_ref::text as entity_ref, t.content_hash,
  t.created_at as extracted_at, 'text_layer' as method, 'page-text.v1' as extractor_version, null as model,
  t.text_format_version, t.status, t.pages as old_pages,
  array(select p from jsonb_array_elements_text(t.pages) with ordinality e(p, i) order by i) as pages, null::jsonb as receipt, null::uuid as author_id
 from ops.deal_document_text t
 union all
 select j.id, j.id, j.document_ref, j.entity_ref, j.content_hash, j.recorded_at, 'legacy_fact_receipt',
  j.contract->>'extractor_version', j.contract->>'model', 'fact-receipt.v1', 'receipt_only', '[]', '{}',
  jsonb_build_object('contract', j.contract, 'receipt', j.receipt), j.actor_id
 from ops.deal_extraction_job j
) c join public.attachment a on a.id = c.document_ref
left join lateral (
 select d.id, d.deal_id, d.sha256 from document d
 where d.r2_bucket = 'deal_documents' and d.deal_id::text = c.entity_ref and a.deleted_at is null
 and (d.r2_key = a.r2_key or (d.sha256, d.bytes) = (a.sha256, a.bytes))
 order by (d.r2_key = a.r2_key) desc, d.created_at, d.id limit 1
) d on true
cross join lateral copy_event_attribution(c.author_id, null) w;

create temp table refusal on commit drop as
select c.n, f.field, f.value, f.reason from attempt c cross join lateral (values
 ('deleted_at', c.deleted_at::text, 'attachment_deleted', c.deleted_at is not null),
 ('document_ref', c.document_ref::text, 'document_not_copied', c.deleted_at is null and c.document_id is null),
 ('content_hash', c.content_hash, 'hash_mismatch', c.content_hash <> c.sha256),
 ('contract', c.extractor_version, 'contract_incomplete',
  not (coalesce(c.extractor_version ~ '\S', false) and coalesce(c.model ~ '\S', true))),
 ('pages', null, 'pages_not_text', jsonb_path_exists(c.old_pages, 'strict $[*] ? (@.type() != "string")'))) f(field, value, reason, refused)
where f.refused;

-- A file holds one attempt per method, extractor, model and format. Old jobs without a model could repeat one.
insert into refusal select c.n, 'id', coalesce(c.id, c.document_id)::text, 'extraction_conflict' from attempt c
where not exists (select from refusal r where r.n = c.n) and (
 exists (select from attempt o where not exists (select from refusal r where r.n = o.n)
  and o.n <> c.n and (o.document_id, o.method, o.extractor_version, o.model, o.text_format_version)
   is not distinct from (c.document_id, c.method, c.extractor_version, c.model, c.text_format_version))
 or exists (select from document_extraction e where (e.document_id, e.method, e.extractor_version, e.model, e.text_format_version)
   is not distinct from (c.document_id, c.method, c.extractor_version, c.model, c.text_format_version)
  and (coalesce(c.id, e.id), c.extracted_at, c.status, c.pages, c.receipt, c.changed_by_user_id, c.changed_by_job, c.changed_for_user_id)
   is distinct from (e.id, e.extracted_at, e.status, e.pages, e.receipt, e.changed_by_user_id, e.changed_by_job, e.changed_for_user_id))
 or exists (select from document_extraction e where e.id = c.id
  and (e.document_id, e.method, e.extractor_version, e.model, e.text_format_version)
   is distinct from (c.document_id, c.method, c.extractor_version, c.model, c.text_format_version)));
insert into not_copied select distinct c.old_id, r.field, r.value, r.reason from refusal r join attempt c using (n);

-- The old table holds pages its writer checked; one the new rules refuse is listed rather than abort the copy.
do $$
declare
	c record;
	broken text;
begin
	for c in select * from attempt o where not exists (select from refusal r where r.n = o.n)
		and not exists (select from document_extraction e where (e.document_id, e.method, e.extractor_version, e.model, e.text_format_version)
			is not distinct from (o.document_id, o.method, o.extractor_version, o.model, o.text_format_version)) loop
		begin
			insert into document_extraction (id, created_at, document_id, deal_id, extracted_at, method, extractor_version, model,
				text_format_version, status, pages, receipt, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
			values (coalesce(c.id, gen_random_uuid()), c.extracted_at, c.document_id, c.deal_id, c.extracted_at, c.method,
				c.extractor_version, c.model, c.text_format_version, c.status, c.pages, c.receipt, c.extracted_at,
				c.changed_by_user_id, c.changed_by_job, c.changed_for_user_id);
		exception when check_violation then
			get stacked diagnostics broken = constraint_name;
			insert into not_copied values (c.old_id, 'pages', broken, 'text_refused');
		end;
	end loop;
end $$;
alter table document_extraction enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
