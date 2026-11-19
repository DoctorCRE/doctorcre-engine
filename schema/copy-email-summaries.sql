-- Run after copy-emails.sql, in one owner transaction with the new schema on search_path.
create temp table mapped_email_summary on commit drop as
select o.email_activity_id as activity_id, s.activity_id as source_activity_id, s.source_hash, s.generator_version,
 s.status, s.text, s.provenance, s.updated_at as recorded_at
from public.email_message_summary s
left join outside_id o on o.source = 'old_system' and o.value = s.activity_id::text;

insert into email_summary (activity_id, source_activity_id, source_hash, generator_version, status, text, provenance, recorded_at)
select activity_id, source_activity_id, source_hash, generator_version, status, text, provenance, recorded_at
from mapped_email_summary where activity_id is not null
on conflict (source_activity_id, source_hash, generator_version) do nothing;

create temp table not_copied on commit drop as
select m.source_activity_id as old_id, 'email_summary'::text as field, m.generator_version || ':' || m.source_hash as value,
 case when m.activity_id is null then 'email_not_copied' else 'summary_copy_conflict' end as reason
from mapped_email_summary m
left join email_summary s using (source_activity_id, source_hash, generator_version)
where m.activity_id is null or (m.activity_id, m.status, m.text, m.provenance, m.recorded_at)
 is distinct from (s.activity_id, s.status, s.text, s.provenance, s.recorded_at);

select * from not_copied order by old_id, field, value, reason;
