-- Run after copy-meetings.sql and the next-step copies, in one owner transaction, with copy-attribution.sql loaded
-- and the new schema on search_path. Only public and ops are read.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table proposal disable trigger decide_proposal, disable trigger stamp_change, disable trigger record_change;
alter table change disable trigger stamp_change;
alter table imported_change disable trigger stamp_imported_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

create temp table action_edit on commit drop as
select r.*, lag(btrim(r.summary)) over (partition by r.meeting_id, r.action_number order by r.revision) as summary_before, a.*
from ops.meeting_action_revision r cross join lateral copy_event_attribution(r.proposed_by_actor, null) a;

-- An action is its current revision; only a next-step command is a suggestion the queue holds.
create temp table suggestion on commit drop as
select a.*, cur.id as old_id, btrim(cur.summary) as evidence, cur.created_at, s.*, source.id as activity_id, source.kind as activity_kind,
 target.deal_id, target.party_id, owner.id as owner, case when s.due_text ~ '^\d{4}-\d{2}-\d{2}$' and pg_input_is_valid(s.due_text, 'date') then s.due_text::date end as due_on,
 case when s.verb in ('set-next-action', 'set-next-step') then 'next_step' end as kind,
 case when a.state in ('accepted', 'executed', 'delegated') then 'accepted' when a.state = 'declined' then 'dismissed' else 'pending' end as status,
 (select u.id from app_user u where u.id = decided.changed_by_user_id) as decider,
 exists (select from ops.meeting_action_decision_request d where d.request @> jsonb_build_object('meeting_id', a.meeting_id,
  'action_number', a.action_number, 'base_revision', a.decided_revision, 'actor_id', a.decided_by_actor,
  'decision', case when a.state = 'declined' then 'decline' else 'accept' end)) as requested,
 (select r.proposed_by_actor from action_edit r where (r.meeting_id, r.action_number) = (a.meeting_id, a.action_number)
  and r.changed_by_user_id is not null and not exists (select from app_user u where u.id = r.changed_by_user_id) limit 1) as unknown_author,
 case when a.state in ('accepted', 'executed', 'delegated') then made.id else first.id end as proposal_id
from ops.meeting_action a
join ops.meeting_action_revision cur on (cur.meeting_id, cur.action_number, cur.revision) = (a.meeting_id, a.action_number, a.current_revision)
join ops.meeting_action_revision first on (first.meeting_id, first.action_number, first.revision) = (a.meeting_id, a.action_number, 1)
cross join lateral (select cur.command -> 'args' as args, cur.command ->> 'verb' = 'set-next-step' as deal_room,
 case when cur.command ->> 'verb' = 'set-next-step' then 'text' else 'description' end as text_key) c
-- Each verb reads only its own arguments; the old system never checked a command's args against its verb.
cross join lateral (select cur.command ->> 'verb' as verb, c.args ->> case when c.deal_room then 'deal' else 'ref' end as ref,
 case when jsonb_typeof(c.args -> c.text_key) = 'string' then btrim(c.args ->> c.text_key) end as what,
 c.args ->> case when c.deal_room then 'next_date' else 'due_on' end as due_text,
 case when not c.deal_room then lower(btrim(c.args ->> 'owner')) end as owner_slug,
 -- The dispatch's own result names the step it made; that receipt expires after 30 days, the deal room's event does not.
 coalesce((select (t.response ->> 'next_action_id')::uuid from public.tool_call t
  where t.idempotency_key = a.operation_key::text and t.verb = cur.command ->> 'verb'),
  (select (e.new_value ->> 'next_action_id')::uuid from public.event e
  where e.idempotency_key = a.operation_key::text and e.verb = 'set-next-step' and e.field = 'next_step' limit 1)) as made_id) s
left join imported_change meeting on meeting.id = a.meeting_id and meeting.source_event ->> 'source_table' = 'ops.meeting'
left join activity source on source.id = (meeting.record ->> 'id')::uuid
left join outside_id target on target.source = 'old_system' and target.value = s.ref and (s.verb = 'set-next-action' or target.deal_id is not null)
left join public.actor owner_actor on owner_actor.slug = s.owner_slug
left join outside_id o on o.source = 'old_system' and o.value = owner_actor.id::text
left join app_user owner on owner.id = o.party_id
left join next_step made on made.id = s.made_id and (made.deal_id, made.party_id) is not distinct from (target.deal_id, target.party_id)
cross join lateral copy_event_attribution(a.decided_by_actor, null) decided;

insert into not_copied select s.old_id, f.field, f.value, f.reason from suggestion s
-- Imported history shares one id space across sources, so a revision id another copy holds waits.
left join lateral (select e.id::text from action_edit e join imported_change i using (id)
 where (e.meeting_id, e.action_number) = (s.meeting_id, s.action_number)
 and (i.table_name, i.record) is distinct from ('proposal', jsonb_build_object('id', s.proposal_id)) limit 1) taken on true
cross join lateral (values
 ('command', s.verb, 'kind_has_no_suggestion', s.kind is null),
 ('revision', taken.id, 'existing_history_conflicts', taken.id is not null),
 ('meeting_id', s.meeting_id::text, 'meeting_not_copied', s.activity_id is null),
 ('ref', s.ref, 'record_not_copied', s.deal_id is null and s.party_id is null),
 ('ref', s.ref, 'meeting_not_about_record', s.party_id is not null and s.activity_id is not null
  and not exists (select from activity_about b where (b.activity_id, b.party_id) = (s.activity_id, s.party_id))),
 ('summary', s.evidence, 'blank_evidence', s.evidence !~ '\S'),
 (case when s.verb = 'set-next-step' then 'text' else 'description' end, s.what, 'blank_next_step', coalesce(s.what, '') !~ '\S'),
 (case when s.verb = 'set-next-step' then 'next_date' else 'due_on' end, s.due_text, 'invalid_due_date', s.due_text is not null and s.due_on is null),
 ('owner', s.owner_slug, 'owner_not_a_user', s.owner_slug is not null and s.owner is null),
 ('proposed_by_actor', s.unknown_author::text, 'author_not_a_user', s.unknown_author is not null),
 ('decided_by_actor', s.decided_by_actor::text, 'decision_needs_user', s.status <> 'pending' and s.decider is null),
 -- An explicit instruction accepted itself, so only a partner's decision request is a user's decision.
 ('decided_revision', s.decided_revision::text, 'decision_not_requested', s.status <> 'pending' and not s.requested),
 ('operation_key', s.made_id::text, 'next_step_not_copied', s.status = 'accepted' and s.proposal_id is null)
) f(field, value, reason, refused) where f.refused and (s.kind is not null or f.field = 'command');

create temp table ready on commit drop as
select s.proposal_id as id, s.created_at, s.kind, s.activity_id, s.activity_kind, s.evidence, s.status,
 case when s.status <> 'pending' then s.decider end as decided_by_user_id, s.decided_at, s.deal_id, s.party_id,
 s.what, s.owner as owner_party_id, s.due_on, s.old_id, s.meeting_id, s.action_number
from suggestion s where not exists (select from not_copied n where n.old_id = s.old_id);

-- A copied proposal is left as it is; a changed action, or two with one payload, waits for a user.
insert into not_copied select r.old_id, 'proposal', r.id::text, 'existing_proposal_conflicts' from ready r
where exists (select from proposal p where (p.id = r.id) <> ((p.activity_id, p.kind, p.deal_id, p.party_id, p.what, p.owner_party_id, p.due_on)
 is not distinct from (r.activity_id, r.kind, r.deal_id, r.party_id, r.what, r.owner_party_id, r.due_on))
 or p.id = r.id and (p.created_at, p.proposed_by_job, p.evidence, p.status, p.decided_by_user_id, p.decided_at)
  is distinct from (r.created_at, 'old_system', r.evidence, r.status, r.decided_by_user_id, r.decided_at))
 or exists (select from ready other where other.old_id <> r.old_id and (other.id = r.id
  or (other.activity_id, other.kind, other.deal_id, other.party_id, other.what, other.owner_party_id, other.due_on)
  is not distinct from (r.activity_id, r.kind, r.deal_id, r.party_id, r.what, r.owner_party_id, r.due_on)));

insert into not_copied select s.old_id, 'assignee_actor', s.assignee_actor::text, 'delegation_has_no_place' from suggestion s
where s.disposition = 'delegate' and exists (select from ready r where r.old_id = s.old_id)
 and not exists (select from not_copied n where n.old_id = s.old_id);
insert into not_copied select e.id, 'changed_for_user_id', null, 'agent_user_unknown' from ready r join action_edit e using (meeting_id, action_number)
where e.changed_by_job = 'agent' and e.changed_for_user_id is null
 and not exists (select from not_copied n where n.old_id = r.old_id and n.reason = 'existing_proposal_conflicts');

create temp table copied on commit drop as
with inserted as (
 insert into proposal (id, created_at, kind, activity_id, activity_kind, evidence, proposed_by_job, status, decided_by_user_id, decided_at,
  deal_id, party_id, what, owner_party_id, due_on, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
 select id, created_at, kind, activity_id, activity_kind, evidence, 'old_system', status, decided_by_user_id,
  case when status <> 'pending' then decided_at end, deal_id, party_id, what, owner_party_id, due_on,
  decided_by_user_id, case when status = 'pending' then 'old_system' end, null, case when status = 'pending' then created_at else decided_at end
 from ready r where not exists (select from not_copied n where n.old_id = r.old_id and n.reason = 'existing_proposal_conflicts')
 on conflict do nothing returning *
) select c.*, r.meeting_id, r.action_number from inserted c join ready r using (id);

-- History is written from today's times: the old system proposed it, and the user decided it later.
insert into change (table_name, record, action, old_value, new_value, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'proposal', jsonb_build_object('id', id), 'insert', null, to_jsonb(p) - array['changed_by_user_id', 'changed_by_job', 'changed_for_user_id', 'changed_at',
 'meeting_id', 'action_number'] || '{"status": "pending", "decided_by_user_id": null, "decided_at": null}', null, 'old_system', null, created_at from copied p;
insert into change (table_name, record, action, old_value, new_value, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'proposal', jsonb_build_object('id', id), 'update', '{"status": "pending", "decided_by_user_id": null, "decided_at": null}',
 jsonb_build_object('status', status, 'decided_by_user_id', decided_by_user_id, 'decided_at', decided_at), decided_by_user_id, null, null, decided_at
from copied where status <> 'pending';

-- Each revision, the current one too, keeps its words, command, author and time as imported history (decision 81).
insert into imported_change (id, table_name, record, field, source_event, old_value_absent, new_value_absent,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select r.id, 'proposal', jsonb_build_object('id', c.id), 'evidence', jsonb_build_object('id', r.id, 'verb', 'import-meeting-action-revision',
 'cause', 'old_system_import', 'actor_id', r.proposed_by_actor, 'source_table', 'ops.meeting_action_revision', 'meeting_id', r.meeting_id,
 'action_number', r.action_number, 'revision', r.revision, 'command', r.command, 'basis', r.basis, 'source', r.source,
 'old_value', case when r.summary_before is not null then jsonb_build_object('evidence', r.summary_before) end,
 'new_value', jsonb_build_object('evidence', btrim(r.summary))), r.summary_before is null, false,
 r.created_at, r.changed_by_user_id, r.changed_by_job, r.changed_for_user_id
from copied c join action_edit r using (meeting_id, action_number) order by r.created_at, r.id;

set constraints all immediate;
alter table proposal enable trigger decide_proposal, enable trigger stamp_change, enable trigger record_change;
alter table change enable trigger stamp_change;
alter table imported_change enable trigger stamp_imported_change;
select * from not_copied order by old_id, field, value, reason;
