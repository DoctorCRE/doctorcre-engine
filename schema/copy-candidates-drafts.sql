-- Copies today's lead candidates and outreach drafts with their decisions, approvals and history. Run it after
-- schema/copy-leads-clients.sql, in its own owner transaction with search_path set to the new schema.
-- It only reads today's tables in public, and ends by listing each value it did not copy, for a user to fix there.
-- A copied row keeps its old id, so a second run copies only rows that are new.

select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);

-- Off until the end: rows keep their old authors and times, and their history is written below from today's records.
alter table candidate disable trigger stamp_change, disable trigger record_change, disable trigger candidate_review;
alter table lead_contact_draft disable trigger stamp_change, disable trigger record_change;
alter table proposal disable trigger stamp_change, disable trigger record_change;
alter table change disable trigger stamp_change;

create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;
create temp table copied_history (table_name text, id uuid, action text, was jsonb, became jsonb,
	changed_at timestamptz, changed_by_user_id uuid, changed_by_job text, changed_for_user_id uuid) on commit drop;

-- A lead copied before, at the record its party became.
create temp table copied_lead on commit drop as
select o.value as old_id, o.party_id from outside_id o
join party_role r on r.party_id = o.party_id and r.role = 'lead' where o.source = 'old_system';

create temp table old_draft on commit drop as
select d.*, l.party_id as mapped_id, u.id as owner, count(*) over (partition by l.party_id) as copies,
	made.changed_by_user_id as made_by_user_id, made.changed_by_job as made_by_job, made.changed_for_user_id as made_for_user_id,
	approval.changed_by_user_id as approved_by_user_id, approval.changed_by_job as approved_by_job,
	approval.changed_for_user_id as approved_for_user_id,
	(select id from app_user where id = coalesce(approval.changed_by_user_id, approval.changed_for_user_id)) as approver
from public.lead_contact_draft d
left join copied_lead l on l.old_id = d.lead_id::text
left join outside_id o on o.source = 'old_system' and o.value = d.owner_id::text
left join app_user u on u.id = o.party_id
cross join lateral copy_event_attribution(d.created_by, null) made
cross join lateral copy_event_attribution(d.approved_by, (select e.id from public.event e
	where e.verb = 'approve-lead-draft' and e.subject_type = 'lead' and e.subject_id = d.lead_id and e.new_value ->> 'draft_id' = d.id::text
	order by e.mutation_order desc limit 1)) approval;

insert into not_copied
select d.id, f.field, f.value, f.reason from old_draft d cross join lateral (values
	('lead_id', d.lead_id::text, 'lead_not_copied', d.mapped_id is null),
	('lead_id', d.lead_id::text, 'several_drafts_on_one_lead', d.copies > 1 and d.mapped_id is not null),
	('owner_id', d.owner_id::text, 'owner_not_a_user', d.owner_id is not null and d.owner is null),
	('subject', d.subject, 'blank_subject', d.subject !~ '\S'),
	('body', d.body, 'blank_body', d.body !~ '\S'),
	('time_zone', d.time_zone, 'blank_time_zone', d.time_zone !~ '\S'),
	('approved_by', d.approved_by::text, 'approval_needs_user', d.approved_at is not null and d.approver is null),
	('lead_id', d.lead_id::text, 'lead_has_another_draft',
		exists (select from lead_contact_draft n where n.party_id = d.mapped_id and n.id <> d.id))
) f (field, value, reason, refused) where f.refused;

create temp table ready_draft on commit drop as
select * from old_draft d where not exists (select from not_copied n where n.old_id = d.id)
	and not exists (select from lead_contact_draft n where n.id = d.id);

-- Today's draft has no change time of its own; its approval, when there is one, came after its last edit.
insert into lead_contact_draft (id, party_id, created_at, owner_user_id, subject, body, scheduled_for, time_zone,
	revision, approved, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select id, mapped_id, created_at, owner, subject, body, scheduled_for, time_zone, revision, approved_at is not null,
	coalesce(approved_at, created_at),
	case when approved_at is null then made_by_user_id else approved_by_user_id end,
	case when approved_at is null then made_by_job else approved_by_job end,
	case when approved_at is null then made_for_user_id else approved_for_user_id end
from ready_draft;

insert into copied_history
select 'lead_contact_draft', d.id, 'insert', null, to_jsonb(n) - '{changed_by_user_id,changed_by_job,changed_for_user_id,changed_at}'::text[]
	|| '{"approved": false}', d.created_at, d.made_by_user_id, d.made_by_job, d.made_for_user_id
from ready_draft d join lead_contact_draft n using (id);
insert into copied_history
select 'lead_contact_draft', id, 'update', '{"approved": false}', '{"approved": true}',
	approved_at, approved_by_user_id, approved_by_job, approved_for_user_id
from ready_draft where approved_at is not null;

-- Clear the deck records each drop as one batch event naming the candidates it expired.
create temp table deck_drop on commit drop as
select distinct on (r ->> 'id') (r ->> 'id')::uuid as candidate_id, e.id, e.actor_id, e.occurred_at
from public.event e cross join jsonb_array_elements(e.new_value -> 'rows') r
where e.subject_type = 'clear_the_deck' and e.verb = 'clear-the-deck-apply'
	and e.new_value ->> 'kind' = 'candidate' and e.new_value ->> 'action' = 'drop'
order by r ->> 'id', e.mutation_order desc;

-- Promotion and email confirmation record their decision as a status event; a decline names its user on the row.
create temp table old_candidate on commit drop as
select p.*, case p.status when 'pool' then 'unreviewed' when 'suppressed_dup' then 'suppressed'
		when 'expired' then 'suppressed' else p.status end as mapped_status,
	case p.status when 'declined' then case when p.decline_reason ~ '\S' then p.decline_reason end
		when 'suppressed_dup' then case when p.dup_basis ~ '\S' then p.dup_basis end when 'expired' then 'Expired by Clear the deck' end as reason,
	l.party_id as lead_party_id, e.id as event_id, e.new_value as event_value,
	case p.status when 'declined' then p.declined_at when 'expired' then coalesce(x.occurred_at, p.updated_at)
		else e.occurred_at end as decided_at,
	made.changed_by_user_id as made_by_user_id, made.changed_by_job as made_by_job, made.changed_for_user_id as made_for_user_id,
	decided.changed_by_user_id as decided_by_user_id, decided.changed_by_job as decided_by_job,
	decided.changed_for_user_id as decided_for_user_id, (select id from app_user where id = coalesce(decided.changed_by_user_id, decided.changed_for_user_id)) as decider,
	(select id from app_user where id = confirmed.changed_by_user_id) as confirmer
from public.candidate_pool p
left join copied_lead l on l.old_id = p.promoted_lead_id::text
left join lateral (select * from public.event e where e.subject_type = 'candidate_pool' and e.subject_id = p.id
	and e.field = 'status' and e.new_value ->> 'status' = p.status order by e.mutation_order desc limit 1) e on true
left join deck_drop x on x.candidate_id = p.id
-- The creating transaction's own event, such as mail capture's proposal, names its job and sponsor.
cross join lateral copy_event_attribution(p.created_by, (select e.id from public.event e where e.subject_type = 'candidate_pool'
	and e.subject_id = p.id and e.actor_id = p.created_by and e.recorded_at = p.created_at order by e.mutation_order limit 1)) made
cross join lateral copy_event_attribution(case p.status when 'declined' then p.declined_by
	when 'expired' then coalesce(x.actor_id, p.updated_by) else e.actor_id end, case when p.status = 'expired' then x.id else e.id end) decided
cross join lateral copy_event_attribution(p.confirmed_by, null) confirmed;

insert into not_copied
select c.id, f.field, f.value, f.reason from old_candidate c cross join lateral (values
	('status', jsonb_build_object('party_id', c.event_value -> 'party_id', 'deal_id', c.event_value -> 'deal_id')::text,
		'confirmed_without_lead', c.status = 'confirmed'),
	('source', c.source, 'untrimmed_or_blank_source', c.source <> btrim(c.source) or c.source !~ '\S'),
	('source_key', c.source_key, 'untrimmed_or_blank_source', c.source_key <> btrim(c.source_key) or c.source_key !~ '\S'),
	('source_key', c.source_key, 'source_key_taken', exists (select from candidate n
		where n.source = c.source and n.source_key = c.source_key and n.id <> c.id)),
	('name', c.name, 'blank_name', c.name !~ '\S'),
	('score_basis', c.score_basis, 'missing_qualification', coalesce(c.score_basis, '') !~ '\S'),
	('status', c.status, 'rejection_needs_reason', c.status in ('declined', 'suppressed_dup') and c.reason is null),
	('status', c.status, 'decision_needs_user', c.status in ('promoted', 'declined') and c.decider is null),
	('promoted_lead_id', c.promoted_lead_id::text, 'promoted_lead_not_copied', c.status = 'promoted' and c.lead_party_id is null)
) f (field, value, reason, refused) where f.refused;
-- Listed, and the candidate copies without them.
insert into not_copied
select c.id, f.field, f.value, f.reason from old_candidate c cross join lateral (values
	('est_lease_event', c.est_lease_event::text, 'estimate_needs_source', c.est_lease_event is not null and coalesce(c.est_basis, '') !~ '\S'),
	('est_basis', c.est_basis, 'source_without_estimate', c.est_lease_event is null and c.est_basis ~ '\S'),
	('confirmed_by', c.confirmed_by::text, 'confirmation_needs_user', c.confirmed_at is not null and c.confirmer is null)
) f (field, value, reason, refused) where f.refused and c.status <> 'confirmed';

create temp table pending_email_candidate on commit drop as
select c.id, owner.id as mailbox_user_id, lower(btrim(c.email)) as address
from old_candidate c
left join app_user owner on owner.slug = c.source_row ->> 'mailbox_owner'
where c.source = 'outlook-intake' and c.status = 'pool'
	and not exists (select from proposal p where p.candidate_id = c.id);

create temp table ready_candidate on commit drop as
select c.*, c.est_lease_event is not null and c.est_basis ~ '\S' as sourced, p.mailbox_user_id, p.address as sender_address,
	case when p.mailbox_user_id is null then c.made_by_user_id end as copied_by_user_id,
	case when p.mailbox_user_id is not null then 'mail_capture' else c.made_by_job end as copied_by_job,
	coalesce(p.mailbox_user_id, c.made_for_user_id) as copied_for_user_id
from old_candidate c left join pending_email_candidate p using (id)
where not exists (select from not_copied n where n.old_id = c.id and n.reason not in
		('estimate_needs_source', 'source_without_estimate', 'confirmation_needs_user'))
	and not exists (select from candidate n where n.id = c.id);

-- A candidate last changed with the latest of its finding, decision and confirmation.
insert into candidate (id, created_at, source, source_key, source_row, name, qualification, estimated_lease_on,
	lease_estimate_source, status, reason, promoted_party_id, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select c.id, c.created_at, c.source, c.source_key,
	jsonb_build_object('row', c.source_row, 'pool', to_jsonb(p) - 'source_row')
	|| case when c.mailbox_user_id is not null then jsonb_build_object('address', c.sender_address,
		'message_ref', c.source_row -> 'message_ref', 'first_seen_at', c.source_row -> 'first_seen_at',
		'reading', c.source_row -> 'reading') else '{}'::jsonb end,
	c.name, c.score_basis, case when c.sourced then c.est_lease_event end, case when c.sourced then c.est_basis end,
	c.mapped_status, c.reason, case when c.status = 'promoted' then c.lead_party_id end, s.*
from ready_candidate c join public.candidate_pool p using (id)
cross join lateral (select at, by_user, by_job, for_user from (values
	(c.created_at, c.copied_by_user_id, c.copied_by_job, c.copied_for_user_id, true),
	(c.decided_at, c.decided_by_user_id, c.decided_by_job, c.decided_for_user_id, c.status in ('promoted', 'declined', 'expired')),
	(c.confirmed_at, c.confirmer, null, null, c.confirmer is not null)
) e (at, by_user, by_job, for_user, happened) where happened order by at desc limit 1) s;

-- A decided candidate was unreviewed when it was found; its decision is the change to what it is now.
create temp table copied_candidate on commit drop as
select c.*, r.now_row, case when c.status in ('promoted', 'declined', 'expired') then r.now_row
	|| '{"status": "unreviewed", "reason": null, "promoted_party_id": null, "lead_role": null}' else r.now_row end as found_row
from ready_candidate c cross join lateral (select to_jsonb(n)
	- '{changed_by_user_id,changed_by_job,changed_for_user_id,changed_at}'::text[] as now_row from candidate n where n.id = c.id) r;
insert into copied_history
select 'candidate', id, 'insert', null, found_row, created_at, copied_by_user_id, copied_by_job, copied_for_user_id
from copied_candidate;
insert into copied_history
select 'candidate', c.id, 'update', d.was, d.became, c.decided_at, c.decided_by_user_id, c.decided_by_job, c.decided_for_user_id
from copied_candidate c cross join lateral (select jsonb_object_agg(k, c.found_row -> k) as was, jsonb_object_agg(k, v) as became
	from jsonb_each(c.now_row) f (k, v) where c.found_row -> k is distinct from v) d
where c.status in ('promoted', 'declined', 'expired');
insert into copied_history
select 'candidate', id, 'update', '{"confirmed_at": null, "confirmed_by": null}',
	jsonb_build_object('confirmed_at', confirmed_at, 'confirmed_by', confirmed_by), confirmed_at, confirmer, null, null
from copied_candidate where confirmer is not null;

-- These refusals apply to the suggestion alone, after the candidate has been copied.
insert into not_copied
select p.id, f.field, null, f.reason from pending_email_candidate p cross join lateral (values
	('mailbox_owner', 'mailbox_not_copied', p.mailbox_user_id is null),
	('email', 'invalid_sender_address', p.address is null or not pg_input_is_valid(p.address, 'email_address')),
	('email', 'known_party', exists (select from party_email where address = p.address))
) f (field, reason, refused) where f.refused;

create temp table ready_email_suggestion on commit drop as
select id, mailbox_user_id, created_at,
	regexp_replace(regexp_replace(score_basis, '^Inbound email: ', ''),
		case source_row #>> '{reading,applies_to}'
			when 'existing_deal' then '^(.*) Applies to open deal .+\.$'
			when 'existing_party' then '^(.*) Likely a new address for .+\.$'
			when 'new_matter' then '^(.*) Possible new lead or matter\.$'
			else '^(.*)$'
		end, '\1') as summary
from copied_candidate c
where c.mailbox_user_id is not null
	and not exists (select from not_copied n where n.old_id = c.id and n.field in ('email', 'mailbox_owner'));

do $$
declare
	mailbox uuid;
begin
	perform set_config('engine.job', 'mail_capture', true);
	for mailbox in select distinct mailbox_user_id from ready_email_suggestion loop
		perform set_config('engine.user_id', mailbox::text, true);
		with inserted as (
			insert into proposal (kind, candidate_id, created_at, evidence, proposed_by_job, changed_at, changed_by_job, changed_for_user_id)
			select 'email_lead', id, created_at, summary, 'mail_capture', created_at, 'mail_capture', mailbox
			from ready_email_suggestion where mailbox_user_id = mailbox returning *
		)
		insert into copied_history
		select 'proposal', p.id, 'insert', null,
			to_jsonb(p) - '{changed_by_user_id,changed_by_job,changed_for_user_id,changed_at}'::text[],
			p.changed_at, p.changed_by_user_id, p.changed_by_job, p.changed_for_user_id from inserted p;
	end loop;
	perform set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
end $$;

insert into change (table_name, record, action, old_value, new_value, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select table_name, jsonb_build_object('id', id), action, was, became, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id
from copied_history order by changed_at, action = 'update', id;

set constraints all immediate;
alter table candidate enable trigger stamp_change, enable trigger record_change, enable trigger candidate_review;
alter table lead_contact_draft enable trigger stamp_change, enable trigger record_change;
alter table proposal enable trigger stamp_change, enable trigger record_change;
alter table change enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
