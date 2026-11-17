-- Run after copy-emails.sql, in one owner transaction, with copy-attribution.sql loaded and the new schema on search_path.
-- Only public is read.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table proposal disable trigger decide_proposal, disable trigger stamp_change, disable trigger record_change;
alter table change disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;
create temp table old_link on commit drop as select * from copy_activity_link();

-- Filing, new-deal and reply-draft cards have their own copies, and mail never proposed a phase move.
create temp table suggestion on commit drop as
select p.id, p.created_at, p.activity_id as old_activity_id, p.deal_id as old_deal_id, p.evidence_quote as evidence, btrim(p.task_text) as what,
 p.next_date as due_on, p.owner as owner_slug, p.status as old_status, p.resolved_by, p.resolved_at, p.resolution_reason, p.resolution_note,
 p.deferred_until, case when p.status in ('pending', 'dismissed') then p.status end as status, email.activity_id, deal.deal_id,
 subject.party_id, owner.id as owner, (select u.id from app_user u where u.id = decided.changed_by_user_id) as decider
from public.email_proposal p
left join email on email.activity_id = p.activity_id
left join outside_id deal on deal.source = 'old_system' and deal.value = p.deal_id::text and deal.deal_id is not null
-- Without a deal, a step is for its email's one client, lead or vendor, as today's review shows it.
left join lateral (select case when count(*) = 1 then (array_agg(l.party_id))[1] end as party_id from old_link l
 where p.deal_id is null and l.id = p.activity_id and l.field in ('deal_id', 'client_id', 'lead_id', 'vendor_id')
 having bool_and(l.field <> 'deal_id')) subject on true
left join public.actor owner_actor on owner_actor.slug = p.owner
left join outside_id o on o.source = 'old_system' and o.value = owner_actor.id::text
left join app_user owner on owner.id = o.party_id
cross join lateral copy_event_attribution(p.resolved_by, null) decided
where p.kind = 'next_step';

insert into not_copied select s.id, f.field, f.value, f.reason from suggestion s cross join lateral (values
 ('status', s.old_status, 'accepted_not_copied', s.status is null),
 ('activity_id', s.old_activity_id::text, 'email_not_copied', s.activity_id is null),
 (case when s.old_deal_id is null then 'activity_id' else 'deal_id' end, coalesce(s.old_deal_id, s.old_activity_id)::text, 'record_not_copied',
  s.deal_id is null and s.party_id is null),
 ('activity_id', s.old_activity_id::text, 'email_not_about_record', s.party_id is not null and s.activity_id is not null
  and not exists (select from activity_about b where (b.activity_id, b.party_id) = (s.activity_id, s.party_id))),
 ('evidence_quote', s.evidence, 'blank_evidence', s.evidence !~ '\S'),
 ('owner', s.owner_slug, 'owner_not_a_user', s.owner is null),
 ('resolved_by', s.resolved_by::text, 'decision_needs_user', s.status = 'dismissed' and s.decider is null)
) f(field, value, reason, refused) where f.refused;

create temp table ready on commit drop as
select s.id, s.created_at, s.activity_id, s.evidence, s.status, s.decider as decided_by_user_id, s.resolved_at as decided_at,
 s.deal_id, s.party_id, s.what, s.owner as owner_party_id, s.due_on
from suggestion s where not exists (select from not_copied n where n.old_id = s.id);

-- A copied proposal is left as it is; a suggestion changed since, or another's payload, waits for a user.
insert into not_copied select r.id, 'proposal', r.id::text, 'existing_proposal_conflicts' from ready r
where exists (select from proposal p where (p.id = r.id) <> ((p.activity_id, p.kind, p.deal_id, p.party_id, p.what, p.owner_party_id, p.due_on)
 is not distinct from (r.activity_id, 'next_step', r.deal_id, r.party_id, r.what, r.owner_party_id, r.due_on))
 or p.id = r.id and (p.created_at, p.proposed_by_job, p.evidence, p.status, p.decided_by_user_id, p.decided_at)
  is distinct from (r.created_at, 'old_system', r.evidence, r.status, r.decided_by_user_id, r.decided_at));

insert into not_copied select s.id, f.field, f.value, f.reason from suggestion s cross join lateral (values
 ('resolution_reason', s.resolution_reason, 'reason_has_no_place', s.resolution_reason is not null),
 ('resolution_note', s.resolution_note, 'note_has_no_place', s.resolution_note ~ '\S'),
 ('deferred_until', s.deferred_until::text, 'snooze_has_no_place', s.deferred_until is not null)
) f(field, value, reason, listed) where f.listed and exists (select from ready r where r.id = s.id)
 and not exists (select from not_copied n where n.old_id = s.id and n.reason = 'existing_proposal_conflicts');

-- The intake kept only a hash of a not-business message's local mailbox key, so neither the email nor its sender can be found.
insert into not_copied select null, 'message_hash', message_hash, 'message_not_stored' from public.email_lead_exclusion;

create temp table copied on commit drop as
with inserted as (
 insert into proposal (id, created_at, kind, activity_id, activity_kind, evidence, proposed_by_job, status, decided_by_user_id, decided_at,
  deal_id, party_id, what, owner_party_id, due_on, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
 select id, created_at, 'next_step', activity_id, 'email', evidence, 'old_system', status, decided_by_user_id, decided_at,
  deal_id, party_id, what, owner_party_id, due_on, decided_by_user_id, case when status = 'pending' then 'old_system' end, null,
  coalesce(decided_at, created_at)
 from ready r where not exists (select from not_copied n where n.old_id = r.id and n.reason = 'existing_proposal_conflicts')
 on conflict (id) do nothing returning *
) select * from inserted;

-- History is written from today's times: the old system proposed it, and the user decided it later.
insert into change (table_name, record, action, old_value, new_value, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'proposal', jsonb_build_object('id', id), 'insert', null, to_jsonb(p) - array['changed_by_user_id', 'changed_by_job', 'changed_for_user_id', 'changed_at']
 || '{"status": "pending", "decided_by_user_id": null, "decided_at": null}', null, 'old_system', null, created_at from copied p;
insert into change (table_name, record, action, old_value, new_value, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select 'proposal', jsonb_build_object('id', id), 'update', '{"status": "pending", "decided_by_user_id": null, "decided_at": null}',
 jsonb_build_object('status', status, 'decided_by_user_id', decided_by_user_id, 'decided_at', decided_at), decided_by_user_id, null, null, decided_at
from copied where status <> 'pending';

set constraints all immediate;
alter table proposal enable trigger decide_proposal, enable trigger stamp_change, enable trigger record_change;
alter table change enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
