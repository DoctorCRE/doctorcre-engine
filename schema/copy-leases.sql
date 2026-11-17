-- Load copy-attribution.sql after next.sql first. Run after copy-deals.sql and copy-buildings.sql, in a separate transaction, with search_path set to the new schema.
-- Only reads public. A lease keeps its first old row's id and each version its own, so a repeat adds only new amendments.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table document disable trigger stamp_change;
alter table lease disable trigger stamp_change;
alter table lease_version disable trigger stamp_change;
alter table lease_suite disable trigger stamp_change;
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;

create temp table building_map on commit drop as
with recursive chain as (
 select id as old_id, id, merged_into, array[id] as path from public.building
 union all
 select c.old_id, b.id, b.merged_into, c.path || b.id from chain c
 join public.building b on b.id = c.merged_into where not b.id = any(c.path)
) select old_id, id from chain where merged_into is null;

-- An amendment supersedes the row before it, so each chain is one lease numbered from its first row.
create temp table old_version on commit drop as
with recursive chain as (
 select id, id as lease_id, 1 as new_version, array[id] as path from public.lease where supersedes_lease_id is null
 union all
 select l.id, c.lease_id, c.new_version + 1, c.path || l.id from chain c
 join public.lease l on l.supersedes_lease_id = c.id where not l.id = any(c.path)
)
select c.lease_id, c.new_version, count(*) over (partition by c.lease_id, c.new_version) as same_version,
 l.*, tenant.party_id as tenant_id, place.properties, place.unresolved, place.property_id,
 -- The new column holds less than the old one; a larger quote keeps its wording.
 case when l.rate_norm_sf_yr < 1e8 then l.rate_norm_sf_yr end as rent_per_sf_yr,
 exists (select from lease_version n where (n.id, n.lease_id, n.version) = (l.id, c.lease_id, c.new_version)) as copied,
 a.r2_key, a.deleted_at is not null as file_deleted,
 a.sha256 ~ '^[0-9a-f]{64}$' and a.bytes > 0 and a.r2_key ~ '\S' and a.mime ~ '\S' as file_whole, author.*
from chain c join public.lease l on l.id = c.id
left join public.deal d on d.id = l.deal_id
left join public.client client on client.id = coalesce(l.client_id, d.client_id)
left join outside_id tenant on tenant.source = 'old_system' and tenant.value = client.party_id::text
left join public.attachment a on a.id = l.doc_attachment
cross join lateral (select count(distinct m.id) as properties, count(*) filter (where m.id is null) as unresolved,
 (array_agg(m.id))[1] as property_id
 from public.premises_space ps join public.space s on s.id = ps.space_id left join building_map m on m.old_id = s.building_id
 where ps.premises_id = l.premises_id) place
cross join lateral copy_attribution('lease', l.id, coalesce(l.updated_by, l.created_by)) author;
insert into not_copied select id, 'lease', supersedes_lease_id::text, 'no_first_version' from public.lease
where id not in (select id from old_version);

create temp table version_refusal on commit drop as
select v.id, v.lease_id, v.new_version, f.field, f.value, f.reason from old_version v
join old_version first on first.lease_id = v.lease_id and first.new_version = 1
left join deal d on d.id = v.deal_id
cross join lateral (values
 ('deal_id', v.deal_id::text, 'deal_not_copied', v.deal_id is not null and d.id is null),
 ('deal_id', v.deal_id::text, 'several_leases_on_deal', exists (select from public.lease o where o.deal_id = v.deal_id
  and o.supersedes_lease_id is null and o.id <> v.lease_id) or exists (select from lease n where n.deal_id = v.deal_id and n.id <> v.lease_id)),
 ('client_id', v.client_id::text, 'tenant_not_copied', v.tenant_id is null),
 ('client_id', v.client_id::text, 'tenant_not_deal_client', d.id is not null and v.tenant_id is not null
  and not exists (select from deal_party p where (p.deal_id, p.party_id, p.role) = (v.deal_id, v.tenant_id, 'client'))),
 ('premises_id', v.premises_id::text, 'no_property', v.properties = 0),
 ('premises_id', v.premises_id::text, 'several_properties', v.properties > 1),
 ('premises_id', v.premises_id::text, 'building_merge_unresolved', v.unresolved > 0),
 ('premises_id', v.premises_id::text, 'property_not_copied', v.properties = 1
  and not exists (select from property p where p.id = v.property_id)),
 ('premises_id', v.premises_id::text, 'property_not_on_deal', d.id is not null and v.properties = 1
  and not exists (select from deal_property p where (p.deal_id, p.property_id) = (v.deal_id, v.property_id))),
 ('supersedes_lease_id', v.supersedes_lease_id::text, 'version_changes_lease',
  (v.deal_id, v.tenant_id, v.property_id) is distinct from (first.deal_id, first.tenant_id, first.property_id)),
 ('supersedes_lease_id', v.supersedes_lease_id::text, 'several_amendments', v.same_version > 1),
 ('expiration_on', null, 'no_expiration', v.expiration_on is null),
 ('expiration_on', concat_ws(' ', v.executed_on, v.commencement_on, v.expiration_on), 'dates_out_of_order',
  v.expiration_on <= v.commencement_on or v.expiration_on < v.executed_on),
 ('doc_attachment', concat_ws(': ', v.evidence_kind, v.evidence_ref), 'no_source_file', v.r2_key is null),
 ('doc_attachment', v.doc_attachment::text, 'source_file_deleted', v.file_deleted),
 ('doc_attachment', v.doc_attachment::text, 'source_file_incomplete', not v.file_whole),
 ('doc_attachment', v.doc_attachment::text, 'source_file_conflict', exists (select from public.attachment a, document n
  where a.id = v.doc_attachment and (n.id = a.id or (n.r2_bucket, n.r2_key) = ('deal_documents', a.r2_key))
  and (n.r2_bucket, n.r2_key, n.sha256, n.bytes, n.content_type) is distinct from ('deal_documents', a.r2_key, a.sha256, a.bytes, a.mime))
  or exists (select from public.attachment a join public.attachment o on o.r2_key = a.r2_key
  where a.id = v.doc_attachment and (o.sha256, o.bytes, o.mime) is distinct from (a.sha256, a.bytes, a.mime) and o.deleted_at is null)),
 ('id', v.lease_id::text, 'lease_id_taken', exists (select from lease n where n.id = v.lease_id
  and (n.deal_id, n.party_id, n.property_id) is distinct from (first.deal_id, first.tenant_id, first.property_id))),
 ('id', v.id::text, 'version_id_taken', exists (select from lease_version n where n.id = v.id)),
 ('version', v.new_version::text, 'version_number_taken',
  exists (select from lease_version n where (n.lease_id, n.version) = (v.lease_id, v.new_version)))) f(field, value, reason, refused)
-- A copied lease whose deal, tenant or building has since changed is listed, not passed over.
where f.refused and (not v.copied or f.reason = 'lease_id_taken');
insert into not_copied select id, field, value, reason from version_refusal;
insert into not_copied select v.id, 'supersedes_lease_id', v.supersedes_lease_id::text, 'earlier_version_not_copied' from old_version v
where not exists (select from version_refusal r where r.id = v.id)
 and exists (select from version_refusal r where r.lease_id = v.lease_id and r.new_version < v.new_version);
create temp table copyable on commit drop as
select * from old_version v where not v.copied
 and not exists (select from version_refusal r where r.lease_id = v.lease_id and r.new_version <= v.new_version);

-- Filed to its deal later, by the deal-file copy, which knows each file's kind.
insert into document (id, created_at, name, r2_bucket, r2_key, content_type, sha256, bytes,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select distinct on (a.r2_key) a.id, a.created_at, a.filename, 'deal_documents', a.r2_key, a.mime, a.sha256, a.bytes, a.created_at, author.*
from public.attachment a join copyable c on c.doc_attachment = a.id
cross join lateral copy_attribution('attachment', a.id, a.created_by) author
order by a.r2_key, a.created_at, a.id on conflict do nothing;
insert into lease (id, created_at, party_id, property_id, deal_id, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select lease_id, created_at, tenant_id, property_id, deal_id, updated_at, changed_by_user_id, changed_by_job, changed_for_user_id
from copyable c where new_version = 1 and not exists (select from lease n where n.id = c.lease_id);
insert into lease_version (id, created_at, lease_id, version, document_id, executed_on, commencement_on, expiration_on,
 rent_per_sf_yr, term_months, free_rent_months, expense_structure, other_terms,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select v.id, v.created_at, v.lease_id, v.new_version, n.id, v.executed_on, v.commencement_on, v.expiration_on,
 v.rent_per_sf_yr, v.term_months, case when v.free_rent_months >= 0 then v.free_rent_months end,
 case when v.opex_structure ~ '\S' then v.opex_structure end,
 nullif(concat_ws(E'\n',
 case when v.rent_per_sf_yr is null and v.rate_amount is not null then concat('Rent: ', v.rate_amount, ' ', v.rate_basis) end,
 case when v.ti_amount is not null then 'TI: ' || v.ti_amount end,
 case when v.free_rent_months < 0 then 'Free rent months: ' || v.free_rent_months end,
 case when v.escalator ~ '\S' then 'Escalator: ' || v.escalator end,
 case when v.options_note ~ '\S' then 'Options: ' || v.options_note end), ''),
 v.updated_at, v.changed_by_user_id, v.changed_by_job, v.changed_for_user_id
from copyable v join document n on (n.r2_bucket, n.r2_key) = ('deal_documents', v.r2_key);

-- Every copied version still on its lease links the suites its premises cover in its lease's building.
create temp table version_space on commit drop as
select n.id as lease_version_id, n.lease_id, l.property_id, ps.space_id, m.id as space_property_id,
 n.created_at, n.changed_at, n.changed_by_user_id, n.changed_by_job, n.changed_for_user_id
from old_version v join lease_version n on (n.id, n.lease_id, n.version) = (v.id, v.lease_id, v.new_version)
join lease l on l.id = n.lease_id join public.premises_space ps on ps.premises_id = v.premises_id
join public.space s on s.id = ps.space_id left join building_map m on m.old_id = s.building_id
where not exists (select from version_refusal r where r.lease_id = v.lease_id and r.new_version <= v.new_version);
insert into lease_suite (lease_version_id, lease_id, property_id, suite_id, created_at,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select v.lease_version_id, v.lease_id, v.property_id, v.space_id, v.created_at,
 v.changed_at, v.changed_by_user_id, v.changed_by_job, v.changed_for_user_id
from version_space v join suite s on (s.id, s.property_id) = (v.space_id, v.property_id)
where v.space_property_id = v.property_id on conflict do nothing;
insert into not_copied select v.space_id, 'lease_suite', v.lease_version_id::text, 'suite_not_copied' from version_space v
where v.space_property_id is distinct from v.property_id
 or not exists (select from suite s where (s.id, s.property_id) = (v.space_id, v.property_id));

-- Each option needs its own kind, terms and notice date before it can be an option row.
insert into not_copied select l.id, 'options_note', l.options_note, 'option_terms_unparsed'
from old_version l join lease_version n on (n.id, n.lease_id, n.version) = (l.id, l.lease_id, l.new_version) where l.options_note ~ '\S';
insert into not_copied select l.id, 'evidence', f.value::text, 'no_typed_destination'
from old_version l join lease_version n on (n.id, n.lease_id, n.version) = (l.id, l.lease_id, l.new_version)
cross join lateral (select jsonb_strip_nulls(jsonb_build_object('source', l.source, 'evidence_kind',
 case when l.deal_id is null or l.evidence_kind not in ('executed_lease', 'lease_amendment') then l.evidence_kind end,
 'evidence_ref', l.evidence_ref, 'status', case when l.status = 'legacy_unverified' then l.status end)) as value) f
where f.value <> '{}'::jsonb;
alter table document enable trigger stamp_change;
alter table lease enable trigger stamp_change;
alter table lease_version enable trigger stamp_change;
alter table lease_suite enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
