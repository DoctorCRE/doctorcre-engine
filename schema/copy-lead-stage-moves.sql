-- Run after copy-leads-clients.sql and the activity copy in a separate owner transaction.
-- Load copy-attribution.sql first and put the new schema on search_path. Only public is read.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table lead_stage_move disable trigger apply_lead_stage_move;
alter table lead_stage_move disable trigger stamp_change;
alter table lead_stage_move disable trigger record_change;
alter table proposal disable trigger decide_proposal;
alter table proposal disable trigger stamp_change;
alter table proposal disable trigger record_change;
alter table change disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

create temp table old_move on commit drop as
select m.*, p.party_id, a.kind as activity_kind,
 case m.from_stage when 'nurture_drip' then 'nurture' else m.from_stage end as mapped_from,
 case m.to_stage when 'nurture_drip' then 'nurture' else m.to_stage end as mapped_to
from public.lead_stage_move m
left join outside_id p on p.source = 'old_system' and p.value = m.lead_id::text
left join activity a on a.id = m.activity_id;
create temp table move_problem on commit drop as
select m.id, f.field, f.value, f.reason from old_move m cross join lateral (values
 ('lead_id', m.lead_id::text, 'lead_not_copied', not exists (select from party_role where party_id = m.party_id and role = 'lead')),
 ('activity_id', m.activity_id::text, 'activity_not_copied', m.activity_kind is null),
 ('activity_id', m.activity_id::text, 'activity_not_about_lead', m.activity_kind is not null and not exists
  (select from activity_about where activity_id = m.activity_id and party_id = m.party_id)),
 ('activity_id', m.activity_id::text, 'proposal_source_not_supported', (m.status = 'proposed' or m.approved_by is not null) and m.activity_kind = 'note'),
 ('evidence_ref', m.evidence_ref, 'blank_evidence', m.evidence_ref !~ '\S'),
 ('reason', m.reason, 'blank_reason', m.reason !~ '\S'),
 ('stage', concat_ws(' ', m.from_stage, m.to_stage), 'contradictory_stages', m.mapped_from = m.mapped_to or not exists
  (select from stage where role = 'lead' and slug = m.mapped_from) or not exists
  (select from stage where role = 'lead' and slug = m.mapped_to)),
 ('status', m.status, 'contradictory_status', m.status = 'proposed' and m.approved_at is not null),
 ('approved_by', m.approved_by::text, 'incomplete_approval', (m.approved_by is null) <> (m.approved_at is null)),
 ('created_at', m.created_at::text, 'contradictory_dates', m.approved_at < m.created_at or m.undone_at < coalesce(m.approved_at, m.created_at)),
 ('stage', m.from_stage, 'pending_stage_differs', m.status = 'proposed' and exists
  (select from party_role where party_id = m.party_id and role = 'lead' and stage <> m.mapped_from)),
 ('stage', m.mapped_to, 'duplicate_mapped_evidence', exists (select from old_move other where other.id <> m.id
  and (other.party_id, other.mapped_from, other.mapped_to, other.activity_id) = (m.party_id, m.mapped_from, m.mapped_to, m.activity_id)))
) f(field, value, reason, refused) where f.refused;

create temp table move_actor on commit drop as
select m.id, v.kind, v.actor_id, v.happened_at, a.*
from old_move m cross join lateral (values ('creation', m.created_by, m.created_at),
 ('approval', m.approved_by, m.approved_at), ('undo', m.undone_by, m.undone_at)) v(kind, actor_id, happened_at)
cross join lateral copy_event_attribution(v.actor_id, (select e.id from public.event e
 where e.subject_type = 'lead' and e.subject_id = m.lead_id and e.actor_id = v.actor_id
 and (e.new_value ->> 'move_id' = m.id::text or e.new_value ->> 'undone_move_id' = m.id::text)
 order by e.mutation_order desc limit 1)) a
where v.actor_id is not null;
insert into move_problem
select m.id, a.kind, a.actor_id::text, 'unknown_actor' from old_move m join move_actor a on a.id = m.id
where not exists (select from public.actor where id = a.actor_id)
 or a.changed_by_user_id is not null and not exists (select from app_user where id = a.changed_by_user_id)
 or a.changed_for_user_id is not null and not exists (select from app_user where id = a.changed_for_user_id);
insert into move_problem
select m.id, 'created_by', m.created_by::text, 'proposal_needs_job' from old_move m join move_actor a on a.id = m.id and a.kind = 'creation'
where (m.status = 'proposed' or m.approved_by is not null) and a.changed_by_job is null;
insert into move_problem
select m.id, 'approved_by', m.approved_by::text, 'approval_needs_user' from old_move m join move_actor a on a.id = m.id and a.kind = 'approval'
where a.changed_by_user_id is null;
insert into move_problem
select m.id, 'lead_stage_move', m.id::text, 'existing_evidence_conflicts' from old_move m
where exists (select from lead_stage_move x where (x.id = m.id or
 (x.party_id,x.from_stage,x.to_stage,x.activity_id) = (m.party_id,m.mapped_from,m.mapped_to,m.activity_id))
 and (x.id,x.party_id,x.from_stage,x.to_stage,x.activity_id,x.evidence_ref,x.strength,x.reason) is distinct from
 (m.id,m.party_id,m.mapped_from,m.mapped_to,m.activity_id,m.evidence_ref,m.strength,m.reason));
insert into move_problem
select m.id, 'proposal', m.id::text, 'existing_proposal_conflicts' from old_move m
where exists (select from proposal p where (p.id = m.id or (p.kind = 'lead_stage_move' and
 (p.party_id,p.from_stage,p.to_stage,p.activity_id) = (m.party_id,m.mapped_from,m.mapped_to,m.activity_id)))
 and (p.id,p.kind,p.party_id,p.from_stage,p.to_stage,p.activity_id,p.evidence,p.strength,p.reason,p.status) is distinct from
 (m.id,'lead_stage_move',m.party_id,m.mapped_from,m.mapped_to,m.activity_id,m.evidence_ref,m.strength,m.reason,
 case when m.status = 'proposed' then 'pending' else 'accepted' end));
create temp table ready_move on commit drop as
select m.* from old_move m where not exists (select from move_problem p where p.id = m.id);

create temp table copied_proposal on commit drop as
with copied as (
 insert into proposal (id, created_at, kind, activity_id, activity_kind, evidence, proposed_by_job, party_id,
  from_stage, to_stage, strength, reason, status, decided_by_user_id, decided_at,
  changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
 select m.id, m.created_at, 'lead_stage_move', m.activity_id, m.activity_kind, m.evidence_ref, c.changed_by_job, m.party_id,
  m.mapped_from, m.mapped_to, m.strength, m.reason, case when m.status = 'proposed' then 'pending' else 'accepted' end,
  a.changed_by_user_id, m.approved_at, coalesce(a.changed_by_user_id, c.changed_by_user_id),
  case when a.id is null then c.changed_by_job end, case when a.id is null then c.changed_for_user_id end,
  coalesce(m.approved_at, m.created_at)
 from ready_move m join move_actor c on c.id = m.id and c.kind = 'creation'
 left join move_actor a on a.id = m.id and a.kind = 'approval'
 where m.status = 'proposed' or m.approved_by is not null
 on conflict do nothing returning *
) select * from copied;
create temp table copied_move on commit drop as
with copied as (
 insert into lead_stage_move (id, party_id, from_stage, to_stage, activity_id, evidence_ref, strength, reason,
  changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
 select m.id, m.party_id, m.mapped_from, m.mapped_to, m.activity_id, m.evidence_ref, m.strength, m.reason,
  a.changed_by_user_id, a.changed_by_job, a.changed_for_user_id, a.happened_at
 from ready_move m join move_actor a on a.id = m.id and a.kind = case when m.approved_by is null then 'creation' else 'approval' end
 where m.status <> 'proposed' on conflict do nothing returning *
) select * from copied;

-- History is loaded explicitly so import time never replaces creation, approval or undo time.
insert into change (table_name, record, action, new_value, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'proposal', jsonb_build_object('id', p.id), 'insert',
 to_jsonb(p) - array['changed_by_user_id','changed_by_job','changed_for_user_id','changed_at']
 || jsonb_build_object('status','pending','decided_by_user_id',null,'decided_at',null),
 a.changed_by_user_id, a.changed_by_job, a.changed_for_user_id, a.happened_at
from copied_proposal p join move_actor a on a.id = p.id and a.kind = 'creation';
insert into change (table_name, record, action, old_value, new_value, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'proposal', jsonb_build_object('id', p.id), 'update', jsonb_build_object('status','pending'),
 jsonb_build_object('status','accepted','decided_by_user_id',p.decided_by_user_id,'decided_at',p.decided_at),
 a.changed_by_user_id, a.changed_by_job, a.changed_for_user_id, a.happened_at
from copied_proposal p join move_actor a on a.id = p.id and a.kind = 'approval';
insert into change (table_name, record, action, new_value, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'lead_stage_move', jsonb_build_object('id', m.id), 'insert',
 to_jsonb(m) - array['changed_by_user_id','changed_by_job','changed_for_user_id','changed_at'],
 m.changed_by_user_id, m.changed_by_job, m.changed_for_user_id, m.changed_at from copied_move m;
insert into change (table_name, record, action, new_value, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'lead_stage_move', jsonb_build_object('id', m.id), 'update',
 jsonb_build_object('undone_at', a.happened_at, 'undone_by', a.actor_id),
 a.changed_by_user_id, a.changed_by_job, a.changed_for_user_id, a.happened_at
from copied_move m join move_actor a on a.id = m.id and a.kind = 'undo';

insert into not_copied select id, field, value, reason from move_problem;
insert into not_copied
select m.id, 'stage', r.stage, 'current_stage_differs' from old_move m join party_role r on r.party_id = m.party_id and r.role = 'lead'
where m.status <> 'proposed' and r.stage <> case when m.status = 'undone' then m.mapped_from else m.mapped_to end
 and not exists (select from public.event e where e.subject_type = 'lead' and e.subject_id = m.lead_id and e.field = 'stage'
  and e.occurred_at > coalesce(m.undone_at, m.approved_at, m.created_at))
 and not exists (select from old_move later where later.party_id = m.party_id
  and coalesce(later.undone_at, later.approved_at, later.created_at) > coalesce(m.undone_at, m.approved_at, m.created_at));

-- Ordinary stage edits are history only. The old event id identifies a repeat import.
create temp table stage_event on commit drop as
select e.id, p.party_id, e.occurred_at, a.*,
 case e.old_value ->> 'stage' when 'nurture_drip' then 'nurture' else e.old_value ->> 'stage' end as was,
 case e.new_value ->> 'stage' when 'nurture_drip' then 'nurture' else e.new_value ->> 'stage' end as became,
 actor.id as actor_id
from public.event e
left join outside_id p on p.source = 'old_system' and p.value = e.subject_id::text
left join public.actor actor on actor.id = e.actor_id
cross join lateral copy_event_attribution(e.actor_id, e.id) a
where e.subject_type = 'lead' and e.field = 'stage';
insert into not_copied
select e.id, 'stage_event', e.became, 'stage_event_unresolved' from stage_event e
where e.party_id is null or e.actor_id is null
 or e.changed_by_user_id is not null and not exists (select from app_user where id = e.changed_by_user_id)
 or e.changed_for_user_id is not null and not exists (select from app_user where id = e.changed_for_user_id)
 or not exists (select from stage where role = 'lead' and slug = e.became)
 or e.was is not null and not exists (select from stage where role = 'lead' and slug = e.was);
insert into change (table_name, record, action, old_value, new_value,
 changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'party_role', jsonb_build_object('party_id',e.party_id,'role','lead'), 'update',
 jsonb_build_object('stage',e.was), jsonb_build_object('stage',e.became,'old_event_id',e.id),
 e.changed_by_user_id, e.changed_by_job, e.changed_for_user_id, e.occurred_at
from stage_event e where not exists (select from not_copied where old_id = e.id)
 and not exists (select from change where table_name = 'party_role' and new_value ->> 'old_event_id' = e.id::text);

set constraints all immediate;
alter table lead_stage_move enable trigger apply_lead_stage_move;
alter table lead_stage_move enable trigger stamp_change;
alter table lead_stage_move enable trigger record_change;
alter table proposal enable trigger decide_proposal;
alter table proposal enable trigger stamp_change;
alter table proposal enable trigger record_change;
alter table change enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
