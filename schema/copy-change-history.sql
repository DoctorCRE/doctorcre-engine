-- Owner-only, one transaction, new schema on search_path; load attribution and record copies first.
-- Public is read-only. No native history or current business row is changed.
set local time zone 'UTC';
alter table imported_change disable trigger stamp_imported_change;
create temp table listed (old_id uuid, field text, reason text) on commit drop;
create temp table history_field on commit drop as
select * from (values
 ('party', 'party', 'name', 'name'), ('party', 'party', 'npi', 'npi'), ('deal', 'deal', 'owner', 'owner_user_id'),
 ('deal', 'deal', 'won_value', 'closed_value'), ('deal', 'deal', 'city', 'market_id'),
 ('deal', 'deal', 'operating_state', 'parking_reason'), ('deal', 'deal', 'attention', 'needs_attention'),
 ('deal', 'activity', 'note', 'summary'),
 ('lead', 'party_role', 'stage', 'stage'), ('lead', 'party_role', 'owner', 'owner_user_id'),
 ('lead', 'party_role', 'owner_id', 'owner_user_id'), ('lead', 'party_role', 'lane', 'lane'),
 ('lead', 'party_role', 'segment', 'segment'), ('lead', 'party_role', 'est_lease_event', 'estimated_lease_on'),
 ('lead', 'party_role', 'event_source', 'lease_estimate_source'),
 ('lead', 'party_role', 'event_confidence', 'lease_estimate_confidence'),
 ('client', 'client', 'status', 'status'), ('client', 'client', 'client_type', 'client_type'),
 ('vendor', 'party_role', 'stage', 'stage'), ('vendor', 'party_role', 'offers', 'offers'),
 ('vendor', 'party_role', 'seeking', 'seeking'), ('vendor', 'activity', 'intro_notes', 'summary')
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

create temp table deal_note_event on commit drop as
select event_id, note_id from (
 select e.id as event_id, n.id as note_id,
  count(*) over (partition by e.id) as notes, count(*) over (partition by n.id) as events
 from public.event e join public.deal_note n on n.deal_id = e.subject_id and n.actor_id = e.actor_id
  and n.created_at = e.occurred_at and n.text = e.new_value ->> 'note'
 where e.subject_type = 'deal' and e.field = 'note' and e.verb = 'add-deal-note' and n.kind = 'note'
) pairs where notes = 1 and events = 1;

create temp table history_event on commit drop as
select e.id, e.field as old_field, f.table_name,
 case when e.field = 'operating_state' and payload.has_note then 'parking_note' else f.field end as field, to_jsonb(e) as source_event,
 case when f.table_name = 'party_role' and r.party_id is not null
   then jsonb_build_object('party_id', r.party_id, 'role', r.role)
  when f.table_name = 'client' and c.party_id is not null then jsonb_build_object('party_id', c.party_id)
  when f.table_name = 'party' and p.id is not null then jsonb_build_object('id', p.id)
  when f.table_name = 'deal' and d.id is not null then jsonb_build_object('id', d.id)
  when f.table_name = 'activity' and note.id is not null then jsonb_build_object('id', note.id) end as record,
 e.occurred_at as changed_at, e.old_value is null as old_value_absent, e.new_value is null as new_value_absent, a.*,
 case when actor.id is null then 'unknown_actor'
  when a.changed_by_user_id is not null and u.id is null then 'user_not_copied'
  when a.changed_by_job in ('agent', 'mail_capture') and e.sponsoring_human_slug is not null and sponsor.id is null then 'unknown_sponsor'
  when a.changed_for_user_id is not null and su.id is null then 'sponsor_not_copied' end as actor_problem,
 payload.known_shape = false as unknown_payload,
 e.subject_type = 'deal' and e.verb = 'add-deal-note' and dn.note_id is null as note_not_matched,
 a.changed_by_job = 'agent' and e.sponsoring_human_slug is null as unknown_agent_user
from public.event e
left join deal_history_payload payload on payload.id = e.id
left join history_field f on (f.subject, f.old_field) = (e.subject_type, e.field)
left join outside_id m on m.source = 'old_system' and m.value = e.subject_id::text
left join party p on p.id = m.party_id
left join deal d on d.id = m.deal_id
left join party_role r on r.party_id = m.party_id and r.role = e.subject_type
left join client c on c.party_id = m.party_id
left join deal_note_event dn on dn.event_id = e.id
left join activity note on f.table_name = 'activity'
 and note.id = case when e.subject_type = 'deal' then dn.note_id
  else md5('old_system:vendor:' || e.subject_id || ':intro_notes')::uuid end and note.kind = 'note'
 and exists (select from activity_about about where about.activity_id = note.id
  and (e.subject_type = 'deal' and about.deal_id = d.id or e.subject_type = 'vendor' and about.party_id = m.party_id))
left join public.actor actor on actor.id = e.actor_id
left join public.actor sponsor on sponsor.slug = e.sponsoring_human_slug and sponsor.kind = 'human'
cross join lateral copy_event_attribution(case
 when e.subject_type = 'deal' and e.field = 'owner' and e.cause = 'automation_job' then null
 else e.actor_id end, e.id) a
left join app_user u on u.id = a.changed_by_user_id
left join app_user su on su.id = a.changed_for_user_id;

insert into listed
select id, old_field, problem from history_event
cross join lateral (values
 (case when table_name is null then 'field_has_no_mapping' end),
 (case when table_name is not null and record is null
  then case when note_not_matched then 'note_not_matched' else 'record_not_copied' end end),
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
-- Checklist pings already copy to Home updates.
create temp table deal_history_shape on commit drop as
select * from (values
 ('add-critical-date', null, 'due_on kind'),
 ('add-premises', null, 'building building_created ownership premises spaces'),
 ('backfill-document-attachments', 'document.attachments', 'attachments document_id'),
 ('complete-action', 'status', 'next_action next_action_id outcome status'),
 ('complete-one-action', 'status', 'next_action next_action_id outcome owner_id status version'),
 ('create-national-market-deal', null, 'account_client_id agent_name client_ref market name'),
 ('dismiss-email-proposal', null, 'activity_id kind proposal_id reason'),
 ('import', null, 'summary'),
 ('log-activity', null, 'activity kind'),
 ('log-decision', 'decision', 'decision_event_id decision_id summary'),
 ('new-deal', null, 'client deal_type name phase salesforce_id'),
 ('prepare-document', 'document', 'document_id filled owed template'),
 ('reattach-deal', 'client_id', 'client_name client_ref matched_on party_ref'),
 ('record-counter', null, 'basis rate round side'),
 ('record-finding', 'address', 'expires_on found proposes_correction source'),
 ('record-finding', 'code_requirement', 'expires_on found proposes_correction source'),
 ('record-finding', 'discrepancy', 'expires_on found proposes_correction source'),
 ('record-finding', 'market_study', 'expires_on found proposes_correction source'),
 ('record-finding', 'verified', 'expires_on found proposes_correction source'),
 ('register-client-portal', 'client_portal', 'client_portal_url'),
 ('resolve-post-call-candidate', 'next_action', 'assignee description due_on next_action_id'),
 ('set-lead', null, 'lead'),
 ('set-market-agent', 'market_agent', 'market market_agent'),
 ('set-next-action', 'next_date', 'next_date'),
 ('set-next-action', null, 'dropped_post_call_action_ids due next_action owner set_by summary'),
 ('set-next-step', 'next_step', 'next_date next_step'),
 ('update-deal', 'closed_on', 'closed_on'),
 ('update-deal', 'invoiced_on', 'invoiced_on'),
 ('update-deal', 'lane', 'lane'),
 ('update-deal', 'notes_path', 'notes_path'),
 ('update-deal', 'outcome', 'outcome'),
 ('update-deal', 'phase', 'phase'),
 ('update-deal', 'salesforce_id', 'salesforce_id')
) s(verb, field, keys);

create temp table deal_history_candidate on commit drop as
with candidates as (
 select e.*, d.id as deal_id, a.changed_by_user_id, a.changed_by_job, u.id as user_id,
  string_to_array(s.keys, ' ') as keys
 from public.event e join public.v_deal_room_event visible using (id)
 cross join lateral copy_event_attribution(case
  when e.verb = 'set-lead' and e.field is null and e.cause = 'automation_job' then null
  else e.actor_id end, e.id) a
 left join outside_id m on m.source = 'old_system' and m.value = e.subject_id::text
 left join deal d on d.id = m.deal_id
 left join app_user u on u.id = a.changed_by_user_id
 join deal_history_shape s on s.verb = e.verb and s.field is not distinct from e.field
 where not exists (select from deal_phase_change p
   where p.deal_id = d.id and p.happened_at = e.occurred_at and p.changed_at = e.recorded_at
   and p.phase = case
    when e.field = 'phase' and e.old_value ->> 'phase' is distinct from e.new_value ->> 'phase'
     then e.new_value ->> 'phase'
    when e.field = 'outcome' and e.new_value ->> 'outcome' = 'lost' then 'dead'
    when e.field = 'outcome' and e.new_value ->> 'outcome' = 'won' then 'closed' end)
  and not exists (select from critical_date c join public.critical_date old using (id)
   where e.verb = 'add-critical-date' and c.deal_id = d.id and old.deal_id = e.subject_id
   and c.due_on::text = e.new_value ->> 'due_on' and old.kind = e.new_value ->> 'kind'
   and c.created_at between e.occurred_at - interval '5 seconds' and e.occurred_at + interval '5 seconds')
  and not exists (select from activity_about ab
   where e.verb = 'log-activity' and ab.deal_id = d.id and ab.activity_id::text = e.new_value ->> 'activity')
  and not exists (select from next_step n join public.next_action old using (id)
   where e.verb = 'set-next-action' and e.field is null and n.deal_id = d.id
   and old.subject_type = 'deal' and old.subject_id = e.subject_id
   and ((n.what = regexp_replace(e.new_value ->> 'next_action', '^\s+|\s+$', '', 'g')
     and n.due_on::text is not distinct from e.new_value ->> 'due')
    or (n.created_at = old.created_at
     and old.description = e.new_value ->> 'next_action'
     and old.due_on::text is not distinct from e.new_value ->> 'due'))
   and n.created_at between e.occurred_at - interval '5 seconds' and e.occurred_at + interval '5 seconds')
  and not exists (select from next_step n
   where e.verb = 'resolve-post-call-candidate' and n.deal_id = d.id and n.id::text = e.new_value ->> 'next_action_id')
  and not exists (select from next_step n
   where e.verb in ('complete-action', 'complete-one-action') and n.deal_id = d.id
   and n.id::text = e.new_value ->> 'next_action_id' and n.status = 'done' and n.done_at = e.occurred_at)
  and not exists (select from public.deal_invoice_email old join invoice_email saved using (id)
   where old.invoice_event_id = e.id and saved.deal_id = d.id and saved.payment_change_id is not null)
)
select e.*, cleaned.payloads[1] as plain_old, cleaned.payloads[2] as plain_new,
 cleaned.bare_source, cleaned.file_path, cleaned.row_id, cleaned.placeholder_market,
 case when deal_id is null then 'deal_history_deal_not_copied'
  when changed_by_user_id is not null and user_id is null then 'deal_history_user_not_copied'
  when not checked.valid then 'deal_history_payload_invalid'
  when field in ('salesforce_id', 'notes_path')
   or (cleaned.payloads[1] is null and cleaned.payloads[2] is null
    and (coalesce(e.old_value, '{}') <> '{}' or coalesce(e.new_value, '{}') <> '{}'))
   then 'technical_deal_history'
  when field = 'next_date' and coalesce(e.old_value ->> 'next_date', e.new_value ->> 'next_date') is null
   then 'empty_deal_history' end as refusal
from candidates e
cross join (values (
 '(?<!\S)~/Recordings/[^[:space:]()]+/transcript\.txt(?=$|\s|[),;:.!?](?!\S))[[:blank:]]*',
 '(?:[[:blank:]]+|(?<!\S))\(id [[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}\)(?=$|\s|[,;:.!?](?!\S))'
)) technical(path, row_id)
cross join lateral (select
 case when jsonb_typeof(e.old_value) = 'object'
  and jsonb_populate_record_valid(null::imported_deal_values, e.old_value)
  then jsonb_populate_record(null::imported_deal_values, e.old_value) end as old_snapshot,
 case when jsonb_typeof(e.new_value) = 'object'
  and jsonb_populate_record_valid(null::imported_deal_values, e.new_value)
  then jsonb_populate_record(null::imported_deal_values, e.new_value) end as new_snapshot
) parsed
cross join lateral (
 select bool_and(case when payload is null then true
  when snapshot is null then false
  else payload - e.keys = '{}'::jsonb and jsonb_strip_nulls(payload) = jsonb_strip_nulls(snapshot)
   and (not payload ? 'attachments' or payload -> 'attachments' = snapshot -> 'attachments')
  end) as valid
 from (values (e.old_value, to_jsonb(parsed.old_snapshot)), (e.new_value, to_jsonb(parsed.new_snapshot))) v(payload, snapshot)
) checked
cross join lateral (
 select array_agg(side.payload order by v.position) as payloads,
  bool_or(side.bare_source) as bare_source,
  bool_or(side.file_path) as file_path, bool_or(side.row_id) as row_id,
  bool_or(side.placeholder_market) as placeholder_market
 from (values (1, e.old_value), (2, e.new_value)) v(position, payload)
 cross join lateral (
  select jsonb_object_agg(f.key, plain.value) filter (where plain.value is not null) as payload,
   bool_or(source_kind.bare) as bare_source,
   bool_or(finding.file_path) as file_path, bool_or(finding.row_id) as row_id,
   bool_or(market.placeholder) as placeholder_market
  from jsonb_each(case when checked.valid then v.payload end) f
  cross join lateral (select f.value #>> '{}' as text) raw
  cross join lateral (select f.key = 'source' and raw.text ~*
   '^\s*(carr|https?://\S+|([~.]?/|[a-z]:\\)\S+)\s*$' as bare) source_kind
  cross join lateral (select
   e.verb = 'record-finding' and f.key = 'source' and not source_kind.bare and raw.text ~ technical.path as file_path,
   e.verb = 'record-finding' and f.key = 'source' and not source_kind.bare and raw.text ~* technical.row_id as row_id) finding
  cross join lateral (select f.key = 'market' and copy_unspecified_market(raw.text) as placeholder) market
  left join lateral (
   select written.line
   from public.record_source r
   cross join lateral (select format('imported ''%s'' from panhandle-team-deals.json', r.external_key) as line) written
   where e.verb = 'import' and f.key = 'summary' and r.entity_type = 'deal'
    and r.entity_id = e.subject_id and r.source_system = 'panhandle-team-deals' and r.external_key !~ '[\r\n]'
    and (raw.text = written.line or starts_with(raw.text, written.line || E'\n')
     or starts_with(raw.text, written.line || '; '))
   limit 1
  ) origin on true
  cross join lateral (select case
   when f.key = 'salesforce_id' or source_kind.bare then null
   when finding.file_path or finding.row_id then to_jsonb(nullif(btrim(
    regexp_replace(regexp_replace(raw.text, technical.path, '', 'g'), technical.row_id, '', 'gi')), ''))
   when market.placeholder then null
   when f.key = 'template' and raw.text = 'loi-lease' then to_jsonb('LOI lease'::text)
   when raw.text = origin.line then null
   when origin.line is not null then to_jsonb(nullif(ltrim(substr(raw.text, length(origin.line) + 2), E' \t\r\n'), ''))
   else f.value end as value) plain
 ) side
) cleaned;

insert into listed
select id, field, refusal from deal_history_candidate where refusal is not null;
insert into listed
select id, key, 'technical_deal_history_field' from deal_history_candidate
cross join (values ('salesforce_id'), ('source'), ('summary')) field(key)
where case when key = 'source' then bare_source and (refusal is null or refusal = 'technical_deal_history')
 else refusal is null and (key <> 'summary' or verb = 'import') and
  (old_value -> key, new_value -> key) is distinct from (plain_old -> key, plain_new -> key) end;
insert into listed
select id, f.field, f.reason from deal_history_candidate cross join lateral (values
 ('source', 'technical_finding_path', file_path),
 ('source', 'technical_finding_row_id', row_id),
 ('market', 'placeholder_market', placeholder_market)
) f(field, reason, changed) where f.changed;

insert into imported_deal_history (
 id, deal_id, occurred_at, recorded_at, source_actor_id, source_deal_id, changed_by_user_id, changed_by_job, verb, field,
 old_value, new_value, old_keys, new_keys, cause, human_quote, agent_rationale, idempotency_key, via,
 client_id, sponsoring_human_slug, personal_scope, authorization_class, organization_tenant_id, correlation_id, mutation_order
)
select id, deal_id, occurred_at, recorded_at, actor_id, subject_id, user_id, changed_by_job, verb, field,
 jsonb_populate_record(null::imported_deal_values, plain_old),
 jsonb_populate_record(null::imported_deal_values, plain_new),
 case when plain_old is not null then array(select jsonb_object_keys(plain_old)) end,
 case when plain_new is not null then array(select jsonb_object_keys(plain_new)) end,
 cause, human_quote, agent_rationale, idempotency_key, via, client_id, sponsoring_human_slug,
 personal_scope, authorization_class, organization_tenant_id, correlation_id, mutation_order
from deal_history_candidate where refusal is null
on conflict (id) do nothing;

delete from listed l using imported_deal_history h
where h.id = l.old_id and l.reason not in ('technical_deal_history_field', 'technical_deal_history', 'empty_deal_history',
 'technical_finding_path', 'technical_finding_row_id', 'placeholder_market');
select * from listed order by old_id, field, reason;
