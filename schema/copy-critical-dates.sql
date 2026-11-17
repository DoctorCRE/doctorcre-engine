-- Load copy-attribution.sql after next.sql first. Run after copy-deals.sql, in a separate transaction, with search_path set to the new schema.
-- Only reads public. Dates keep their ids, so a repeat leaves copied dates alone.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
-- The owner's load keeps known users and times, which the transition trigger leaves to the database.
alter table critical_date disable trigger stamp_change;
alter table critical_date disable trigger critical_date_transition;
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;

-- A partner who added a date confirmed it; an agent's date waits for a user.
create temp table old_date on commit drop as
select c.*, author_user.id as author_user_id, resolution.*, a.*
from public.critical_date c
left join public.actor author on author.id = c.created_by and author.kind = 'human'
left join outside_id author_map on author_map.source = 'old_system' and author_map.value = author.id::text
left join app_user author_user on author_user.id = author_map.party_id
left join lateral (
 select true as resolution_logged, e.occurred_at as resolved_at, u.id as resolved_by_user_id,
  coalesce(nullif(btrim(e.new_value ->> 'reason'), ''), nullif(btrim(e.human_quote), '')) as resolution_reason
 from public.event e
 left join public.actor resolver on resolver.id = e.actor_id and resolver.kind = 'human'
 left join outside_id m on m.source = 'old_system' and m.value = resolver.id::text
 left join app_user u on u.id = m.party_id
 where e.subject_type = 'deal' and e.subject_id = c.deal_id and e.field = 'status'
  and e.new_value ->> 'critical_date_id' = c.id::text and e.new_value ->> 'status' = c.status
 order by e.occurred_at desc, e.mutation_order desc limit 1) resolution on true
cross join lateral copy_attribution('critical_date', c.id, coalesce(c.updated_by, c.created_by)) a
where not exists (select from critical_date n where (n.id, n.deal_id) = (c.id, c.deal_id));

create temp table date_refusal on commit drop as
select d.id, f.field, f.value, f.reason from old_date d cross join lateral (values
 ('deal_id', d.deal_id::text, 'deal_not_copied', not exists (select from deal n where n.id = d.deal_id)),
 ('id', d.id::text, 'id_taken', exists (select from critical_date n where n.id = d.id)),
 ('source', d.source, 'no_source', d.source !~ '\S'),
 ('status', d.status, 'resolution_without_evidence', d.status <> 'open'
  and (d.resolution_logged is null or d.resolved_by_user_id is not null and d.resolution_reason is null)),
 ('status', d.status, 'resolved_by_a_job', d.status <> 'open' and d.resolution_logged and d.resolved_by_user_id is null),
 ('status', d.status, 'confirmation_without_evidence', d.status in ('done', 'cleared', 'passed') and d.author_user_id is null)
) f(field, value, reason, refused) where f.refused;
insert into not_copied select * from date_refusal;

insert into critical_date (id, created_at, deal_id, kind, due_on, source, note, status, confirmed_by_user_id, confirmed_at,
 resolved_by_user_id, resolved_at, resolution_reason, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select d.id, d.created_at, d.deal_id, k.kind, d.due_on, d.source,
 case when k.kind = 'other' and d.kind <> 'other' then concat_ws(E'\n', 'Kind: ' || d.kind, d.note) else d.note end,
 case d.status when 'open' then case when d.author_user_id is null then 'proposed' else 'open' end when 'cleared' then 'done' else d.status end,
 d.author_user_id, case when d.author_user_id is not null then d.created_at end,
 case when d.status <> 'open' then d.resolved_by_user_id end, case when d.status <> 'open' then d.resolved_at end,
 case when d.status <> 'open' then d.resolution_reason end,
 d.updated_at, d.changed_by_user_id, d.changed_by_job, d.changed_for_user_id
from old_date d
cross join lateral (select case when d.kind = 'option_window' then 'option_notice'
 when d.kind in ('loi_expiry', 'option_notice', 'rent_start', 'lease_end', 'due_diligence') then d.kind else 'other' end as kind) k
where not exists (select from date_refusal r where r.id = d.id);
alter table critical_date enable trigger stamp_change;
alter table critical_date enable trigger critical_date_transition;
select * from not_copied order by old_id, field, value, reason;
