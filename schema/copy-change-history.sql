-- Owner-only, one transaction, new schema on search_path; load attribution and record copies first.
-- Public is read-only. No native history or current business row is changed.
set local time zone 'UTC';
alter table imported_change disable trigger stamp_imported_change;
create temp table listed (old_id uuid, field text, reason text) on commit drop;
create temp table history_field on commit drop as
select * from (values
 ('party', 'party', 'name', 'name'), ('party', 'party', 'kind', 'kind'), ('party', 'party', 'npi', 'npi'),
 ('deal', 'deal', 'name', 'name'), ('deal', 'deal', 'owner', 'owner_user_id'),
 ('deal', 'deal', 'won_value', 'closed_value'), ('deal', 'deal', 'city', 'market_id'),
 ('deal', 'deal', 'parking_reason', 'parking_reason'), ('deal', 'deal', 'parking_note', 'parking_note'),
 ('deal', 'deal', 'needs_attention', 'needs_attention'),
 ('deal', 'deal', 'operating_state', 'parking_reason'), ('deal', 'deal', 'attention', 'needs_attention'),
 ('lead', 'party_role', 'stage', 'stage'), ('lead', 'party_role', 'owner', 'owner_user_id'),
 ('lead', 'party_role', 'owner_id', 'owner_user_id'), ('lead', 'party_role', 'lane', 'lane'),
 ('lead', 'party_role', 'segment', 'segment'), ('lead', 'party_role', 'est_lease_event', 'estimated_lease_on'),
 ('lead', 'party_role', 'event_source', 'lease_estimate_source'),
 ('lead', 'party_role', 'event_confidence', 'lease_estimate_confidence'),
 ('client', 'client', 'status', 'status'), ('client', 'client', 'client_type', 'client_type'),
 ('vendor', 'party_role', 'stage', 'stage'), ('vendor', 'party_role', 'relationship_level', 'relationship_level'),
 ('vendor', 'party_role', 'is_target', 'is_target'), ('vendor', 'party_role', 'offers', 'offers'),
 ('vendor', 'party_role', 'seeking', 'seeking'), ('vendor', 'party_role', 'disposition', 'disposition'),
 ('lease', 'lease_version', 'executed_on', 'executed_on'), ('lease', 'lease_version', 'commencement_on', 'commencement_on'),
 ('lease', 'lease_version', 'expiration_on', 'expiration_on'), ('lease', 'lease_version', 'rate_norm_sf_yr', 'rent_per_sf_yr'),
 ('lease', 'lease_version', 'term_months', 'term_months'), ('lease', 'lease_version', 'free_rent_months', 'free_rent_months'),
 ('lease', 'lease_version', 'opex_structure', 'expense_structure')
) f(subject, table_name, old_field, field);

-- The Deal Room writer wraps both values in the old field name.
create temp table deal_history_payload on commit drop as
select e.id, bool_and(coalesce(
 jsonb_typeof(v.payload) = 'object' and v.payload - e.field = '{}'::jsonb and
 case when e.field = 'attention' then jsonb_typeof(v.payload -> e.field) = 'boolean'
 else jsonb_typeof(v.payload -> e.field) = 'object'
  and (v.payload -> e.field) ?& array['state', 'reason', 'note']
  and (v.payload -> e.field) - array['state', 'reason', 'note'] = '{}'::jsonb
  and case v.payload #>> '{operating_state,state}'
   when 'active' then v.payload #> '{operating_state,reason}' = 'null'::jsonb
    and v.payload #> '{operating_state,note}' = 'null'::jsonb
   when 'parked' then v.payload #>> '{operating_state,reason}' in ('prospect_never_active', 'client_paused', 'other')
    and jsonb_typeof(v.payload #> '{operating_state,note}') in ('string', 'null')
   else false end
 end, false)) as known_shape,
 bool_or(jsonb_typeof(v.payload #> '{operating_state,note}') = 'string') as has_note
from public.event e cross join lateral (values (e.old_value), (e.new_value)) v(payload)
where e.subject_type = 'deal' and e.field in ('operating_state', 'attention')
group by e.id;

create temp table history_event on commit drop as
select e.id, e.field as old_field, f.table_name,
 case when e.field = 'operating_state' and payload.has_note then 'parking_note' else f.field end as field, to_jsonb(e) as source_event,
 case when f.table_name = 'party_role' and r.party_id is not null
   then jsonb_build_object('party_id', r.party_id, 'role', r.role)
  when f.table_name = 'client' and c.party_id is not null then jsonb_build_object('party_id', c.party_id)
  when f.table_name = 'party' and p.id is not null then jsonb_build_object('id', p.id)
  when f.table_name = 'deal' and d.id is not null then jsonb_build_object('id', d.id)
  when f.table_name = 'lease_version' and l.id is not null then jsonb_build_object('id', l.id) end as record,
 e.occurred_at as changed_at, e.old_value is null as old_value_absent, e.new_value is null as new_value_absent, a.*,
 case when actor.id is null then 'unknown_actor'
  when a.changed_by_user_id is not null and u.id is null then 'user_not_copied'
  when a.changed_by_job in ('agent', 'mail_capture') and e.sponsoring_human_slug is not null and sponsor.id is null then 'unknown_sponsor'
  when a.changed_for_user_id is not null and su.id is null then 'sponsor_not_copied' end as actor_problem,
 payload.known_shape = false as unknown_payload,
 a.changed_by_job = 'agent' and e.sponsoring_human_slug is null as unknown_agent_user
from public.event e
left join deal_history_payload payload on payload.id = e.id
left join history_field f on (f.subject, f.old_field) = (e.subject_type, e.field)
left join outside_id m on m.source = 'old_system' and m.value = e.subject_id::text
left join party p on p.id = m.party_id
left join deal d on d.id = m.deal_id
left join party_role r on r.party_id = m.party_id and r.role = e.subject_type
left join client c on c.party_id = m.party_id
left join lease_version l on l.id = e.subject_id and e.subject_type = 'lease'
left join public.actor actor on actor.id = e.actor_id
left join public.actor sponsor on sponsor.slug = e.sponsoring_human_slug and sponsor.kind = 'human'
cross join lateral copy_event_attribution(e.actor_id, e.id) a
left join app_user u on u.id = a.changed_by_user_id
left join app_user su on su.id = a.changed_for_user_id;

insert into listed
select id, old_field, problem from history_event
cross join lateral (values
 (case when table_name is null then 'field_has_no_mapping' end),
 (case when table_name is not null and record is null then 'record_not_copied' end),
 (case when unknown_payload then 'payload_shape_unknown' end),
 (actor_problem), (case when unknown_agent_user then 'agent_user_unknown' end)
) p(problem) where problem is not null;
insert into listed
select e.id, e.old_field, 'existing_history_conflicts'
from history_event e join imported_change i using (id)
where (i.table_name, i.record, i.field, i.source_event, i.changed_at,
 i.changed_by_user_id, i.changed_by_job, i.changed_for_user_id, i.old_value_absent, i.new_value_absent) is distinct from
 (e.table_name, e.record, e.field,
 case when cardinality(i.erased_fields) = 0 then e.source_event else e.source_event - array['human_quote', 'agent_rationale']
  - case when e.field = any(i.erased_fields) then array['old_value', 'new_value'] else '{}'::text[] end end, e.changed_at,
 e.changed_by_user_id, e.changed_by_job, e.changed_for_user_id, e.old_value_absent, e.new_value_absent);

insert into imported_change (id, table_name, record, field, source_event, changed_at,
 changed_by_user_id, changed_by_job, changed_for_user_id, old_value_absent, new_value_absent)
select id, table_name, record, field, source_event, changed_at,
 changed_by_user_id, changed_by_job, changed_for_user_id, old_value_absent, new_value_absent from history_event
where table_name is not null and record is not null and actor_problem is null
 and not coalesce(unknown_payload, false)
on conflict (id) do nothing;
alter table imported_change enable trigger stamp_imported_change;
select * from listed order by old_id, field, reason;
