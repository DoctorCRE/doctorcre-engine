-- Run after copy-calls.sql and copy-deal-next-steps.sql, in one owner transaction, with copy-attribution.sql loaded
-- and the new schema on search_path. Only public is read.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table proposal disable trigger decide_proposal, disable trigger stamp_change, disable trigger record_change;
alter table change disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

-- A meeting record is its session's activity, which copy-calls.sql carries, so it is not a suggestion.
create temp table old_suggestion on commit drop as
select s.*, deal.deal_id, source.id as activity_id, source.kind as activity_kind, owner.id as owner, reviewer.id as reviewer,
 case when pg_input_is_valid(s.due_text, 'date') then s.due_text::date end as due_on,
 base.new_value ->> 'phase' as from_phase,
 (select u.id from app_user u where u.id = decided.changed_by_user_id) as decider
from (
 select c.id, c.session_id, case when log_call then 'log_call' else c.kind end as old_kind,
  c.payload ->> (case when log_call then 'ref' else 'deal' end) as target_ref,
  case when log_call then c.payload ->> 'summary' else btrim(c.payload ->> 'text') end as what,
  case when log_call then c.payload ->> 'occurred_at' end as occurred_at,
  c.payload ->> 'next_date' as due_text, null::text as due_source, null as assignee, case when c.payload ->> 'field' = 'phase' then c.payload ->> 'value' end as to_phase,
  c.payload ->> 'base_event_id' as base_event, c.payload ->> 'started_on' as started_on, null::uuid as contact_party_id,
  c.evidence_quote, c.status, c.resolved_by, c.resolved_at, c.resulting_ref, c.resolution_note, c.created_at, c.undone_at
 from public.capture_candidate c
 cross join lateral (select c.kind = 'activity' and c.status = 'pending' and c.payload ->> 'kind' = 'note' as log_call) f
 where c.kind <> 'meeting_record'
 union all
 select c.id, c.session_id, c.kind, c.deal_id::text, btrim(c.action_description), null, c.due_on::text,
  case c.due_defaulted when false then 'stated' when true then 'defaulted' end, c.assignee_slug, null, null, null,
  c.contact_party_id, c.evidence_quote, c.status, c.resolved_by, c.resolved_at, c.resulting_ref, c.resolution_note, c.created_at, null
 from public.capture_post_call_candidate c
) s
left join outside_id deal on deal.source = 'old_system' and deal.value = s.target_ref and deal.deal_id is not null
join public.capture_session session on session.id = s.session_id
join public.actor recorder on recorder.id = session.actor_id
left join app_user reviewer on s.assignee is null and reviewer.slug = case recorder.slug
 when 'quill-joe-mac' then 'joe' when 'quill-joe-studio' then 'joe' when 'quill-dell-mac' then 'dell'
 else case when recorder.kind = 'human' then recorder.slug end end
 and (s.old_kind <> 'log_call' or recorder.slug = 'quill-joe-studio')
-- The same source activity copy-calls.sql chose: the session's logged meeting, else the session itself.
left join activity source on source.id = coalesce((select max(o.id::text)::uuid from public.capture_candidate c
 join public.activity o on o.id::text = c.resulting_ref
 where c.session_id = s.session_id and c.kind = 'meeting_record' and c.status = 'confirmed'), s.session_id)
left join public.actor assignee on assignee.slug = s.assignee
left join outside_id o on o.source = 'old_system' and o.value = assignee.id::text
left join app_user owner on owner.id = o.party_id
left join public.event base on base.id::text = s.base_event and base.subject_id::text = s.target_ref and base.field = 'phase'
cross join lateral copy_event_attribution(s.resolved_by, null) decided;

-- An accepted next step is the copied step it made, or the one it was merged into, never a second one.
create temp table made_step on commit drop as
select s.id, n.id as step_id, m.made from old_suggestion s join next_step n on n.deal_id = s.deal_id
cross join lateral (select exists (select from public.next_action a where a.id = n.id and a.source_ref = 'capture_candidate:' || s.id)
 or exists (select from public.capture_post_call_action a where a.id = n.id and a.candidate_id = s.id) as made) m
where s.status = 'confirmed' and s.old_kind in ('next_step', 'assigned_action') and (n.id::text = s.resulting_ref or m.made);

create temp table suggestion on commit drop as
select case when s.status = 'confirmed' and s.kind = 'next_step'
 then (select case when count(*) = 1 then (array_agg(step_id))[1] end from made_step m where m.id = s.id) else s.id end as proposal_id,
 s.*, case s.status when 'pending' then 'pending' when 'confirmed' then 'accepted' else 'dismissed' end as mapped_status
from (select *, case when old_kind in ('next_step', 'assigned_action') then 'next_step'
 when old_kind in ('phase_move', 'log_call') then old_kind end as kind
 from old_suggestion) s;

insert into not_copied select s.id, f.field, f.value, f.reason from suggestion s cross join lateral (values
 ('kind', s.old_kind, 'kind_has_no_suggestion', s.kind is null),
 ('undone_at', s.undone_at::text, 'undone_after_apply', s.undone_at is not null),
 ('deal', s.target_ref, 'deal_not_copied', s.kind <> 'log_call' and s.deal_id is null),
 ('ref', s.target_ref, 'target_not_copied', s.kind = 'log_call' and s.deal_id is null),
 ('session_id', s.session_id::text, 'source_activity_not_copied', s.activity_id is null),
 ('activity_kind', s.activity_kind, 'source_not_a_call_or_meeting', s.activity_kind not in ('call', 'meeting')),
 ('activity_kind', s.activity_kind, 'source_not_a_call', s.kind = 'log_call' and s.activity_kind = 'meeting'),
 ('deal', s.target_ref, 'call_not_about_deal', s.kind in ('next_step', 'log_call') and s.activity_kind = 'call' and s.deal_id is not null
  and not exists (select from activity_about a where a.activity_id = s.activity_id and a.deal_id = s.deal_id)),
 ('evidence_quote', s.evidence_quote, 'blank_evidence', s.evidence_quote !~ '\S'),
 ('text', s.what, 'blank_next_step', s.kind = 'next_step' and coalesce(s.what, '') !~ '\S'),
 ('summary', s.what, 'blank_call_summary', s.kind = 'log_call' and coalesce(s.what, '') !~ '\S'),
 ('next_date', s.due_text, 'invalid_due_date', s.due_text is not null and s.due_on is null),
 ('assignee_slug', s.assignee, 'assignee_not_a_user', s.assignee is not null and s.owner is null),
 ('value', s.to_phase, 'phase_not_proposable', s.kind = 'phase_move' and (s.to_phase = 'dead' or not exists (select from phase where slug = s.to_phase))),
 ('base_event_id', s.base_event, 'phase_before_call_unknown', s.kind = 'phase_move' and s.from_phase is null),
 ('phase', s.from_phase, 'phase_before_call_unknown', s.kind = 'phase_move' and not exists (select from phase where slug = s.from_phase)
  and s.from_phase is not null),
 ('value', s.to_phase, 'phase_unchanged', s.kind = 'phase_move' and s.from_phase = s.to_phase),
 ('resolved_by', s.resolved_by::text, 'decision_needs_user', s.status <> 'pending' and s.decider is null),
 ('resulting_ref', s.resulting_ref, 'next_step_not_copied', s.kind = 'next_step' and s.status = 'confirmed'
  and not exists (select from made_step m where m.id = s.id)),
 ('resulting_ref', s.resulting_ref, 'several_next_steps', (select count(*) from made_step m where m.id = s.id) > 1),
 ('resulting_ref', s.resulting_ref, 'next_step_shared', exists (select from made_step m join made_step other
  on other.step_id = m.step_id and other.id <> m.id where m.id = s.id and not m.made))
) f(field, value, reason, refused) where f.refused and (s.kind is not null or f.field = 'kind');

create temp table ready on commit drop as
select s.proposal_id as id, s.created_at, s.kind, s.activity_id, s.activity_kind, s.evidence_quote as evidence, s.mapped_status as status,
 case when s.status <> 'pending' then s.decider end as decided_by_user_id, s.resolved_at as decided_at, s.deal_id,
 case when s.status = 'pending' then s.reviewer end as changed_for_user_id,
 case when s.kind in ('next_step', 'log_call') then s.what end as what, s.owner as owner_party_id, case when s.kind = 'next_step' then s.due_on end as due_on,
 case when s.kind = 'next_step' then s.due_source end as due_source,
 case when s.kind = 'phase_move' then s.from_phase end as from_phase, case when s.kind = 'phase_move' then s.to_phase end as to_phase, s.id as old_id
from suggestion s where not exists (select from not_copied n where n.old_id = s.id);

-- A copied proposal is left as it is; a changed suggestion, or two with one payload, waits for a user.
insert into not_copied select r.old_id, 'proposal', r.id::text, 'existing_proposal_conflicts' from ready r
where exists (select from proposal p where (p.id = r.id) <> ((p.activity_id, p.kind, p.deal_id, p.what, p.owner_party_id, p.due_on, p.from_phase, p.to_phase)
 is not distinct from (r.activity_id, r.kind, r.deal_id, r.what, r.owner_party_id, r.due_on, r.from_phase, r.to_phase))
 or p.id = r.id and (p.created_at, p.proposed_by_job, p.evidence, p.status, p.decided_by_user_id, p.decided_at, p.changed_for_user_id)
  is distinct from (r.created_at, 'old_system', r.evidence, r.status, r.decided_by_user_id, r.decided_at, r.changed_for_user_id))
 or exists (select from ready other where other.old_id <> r.old_id and (other.id = r.id
  or (other.activity_id, other.kind, other.deal_id, other.what, other.owner_party_id, other.due_on, other.from_phase, other.to_phase)
  is not distinct from (r.activity_id, r.kind, r.deal_id, r.what, r.owner_party_id, r.due_on, r.from_phase, r.to_phase)));

insert into not_copied select s.id, f.field, f.value, f.reason from suggestion s cross join lateral (values
 ('resolution_note', s.resolution_note, 'note_has_no_place', s.resolution_note ~ '\S'),
 ('started_on', s.started_on, 'start_date_has_no_place', s.kind = 'phase_move' and s.started_on is not null),
 ('contact_party_id', s.contact_party_id::text, 'contact_has_no_place', s.contact_party_id is not null),
 ('occurred_at', s.occurred_at, 'uses_recorded_call_time', s.occurred_at is not null)
) f(field, value, reason, listed) where f.listed and exists (select from ready r where r.old_id = s.id)
 and not exists (select from not_copied n where n.old_id = s.id and n.reason = 'existing_proposal_conflicts');

create temp table copied on commit drop as
with inserted as (
 insert into proposal (id, created_at, kind, activity_id, activity_kind, evidence, proposed_by_job, status, decided_by_user_id, decided_at,
  deal_id, what, owner_party_id, due_on, due_source, from_phase, to_phase, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
 select id, created_at, kind, activity_id, activity_kind, evidence, 'old_system', status, decided_by_user_id,
  case when status <> 'pending' then decided_at end, deal_id, what, owner_party_id, due_on, due_source, from_phase, to_phase,
  decided_by_user_id, case when status = 'pending' then 'old_system' end, changed_for_user_id, case when status = 'pending' then created_at else decided_at end
 from ready r where not exists (select from not_copied n where n.old_id = r.old_id and n.reason = 'existing_proposal_conflicts')
 on conflict do nothing returning *
) select * from inserted;

-- History is written from today's times: the old system proposed it, and the user decided it later.
insert into change (table_name, record, action, old_value, new_value, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'proposal', jsonb_build_object('id', id), 'insert', null, to_jsonb(p) - array['changed_by_user_id', 'changed_by_job', 'changed_for_user_id', 'changed_at']
 || '{"status": "pending", "decided_by_user_id": null, "decided_at": null}', null, 'old_system', changed_for_user_id, created_at from copied p;
insert into change (table_name, record, action, old_value, new_value, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'proposal', jsonb_build_object('id', id), 'update', '{"status": "pending", "decided_by_user_id": null, "decided_at": null}',
 jsonb_build_object('status', status, 'decided_by_user_id', decided_by_user_id, 'decided_at', decided_at), decided_by_user_id, null, null, decided_at
from copied where status <> 'pending';

set constraints all immediate;
alter table proposal enable trigger decide_proposal, enable trigger stamp_change, enable trigger record_change;
alter table change enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
