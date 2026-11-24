-- Both partners see every call (docs/decisions.md). Removes the call read policies from a database that has
-- schema/add-call-read-policies.sql, leaving it as schema/next.sql builds it. Safe to apply twice.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

-- Stop moving call text out of history before putting it back.
drop trigger if exists separate_call_audit_evidence on change;
drop function if exists separate_call_audit_evidence();

do $$ begin
	if to_regclass('next.call_audit_evidence') is not null then
		-- The old trigger left the key with a JSON null, so only rows that kept the key get the text back.
		execute $sql$
			update change c set
				old_value = case when c.old_value ? e.field
					then jsonb_set(c.old_value, array[e.field], coalesce(e.old_value, 'null'), false) else c.old_value end,
				new_value = case when c.new_value ? e.field
					then jsonb_set(c.new_value, array[e.field], coalesce(e.new_value, 'null'), false) else c.new_value end
			from call_audit_evidence e where e.change_id = c.id
		$sql$;
	end if;
end $$;
drop table if exists call_audit_evidence;

-- Without cascade, so anything else that depends on these views stops the migration.
drop view if exists next_partner.deal_next_date;
drop view if exists next_partner.deal_imported_history;
drop view if exists next_partner.imported_change;
drop view if exists next_partner.change;
drop view if exists next_partner.home_update;
drop view if exists next_partner.lead_stage_move;
drop view if exists next_partner.proposal;
drop view if exists next_partner.imported_automatic_phase_move;
drop view if exists next_partner.deal_phase_change;
drop view if exists next_partner.next_step;
drop view if exists next_partner.activity;

drop trigger if exists zz_keep_call_audience on activity;
drop function if exists keep_call_audience();
drop trigger if exists stamp_step_proposal_call on next_step;
drop function if exists stamp_step_proposal_call();
drop function if exists accepted_step_call(uuid);
drop table if exists step_call_provenance;
drop function if exists call_step_visible_to(uuid, uuid, uuid);
drop function if exists call_source_visible(uuid, uuid);
drop function if exists call_visible_to(activity, uuid);
drop function if exists call_visible_to(uuid, text, uuid, uuid);

alter table activity drop column if exists call_shared;

-- Named to run after stamp_change, so a new call's recorder comes from its stamp.
create or replace function keep_call_recorder() returns trigger
language plpgsql set search_path = next, pg_temp as $$
begin
	if tg_op = 'INSERT' then
		new.call_owner_user_id := case when new.kind = 'call' then coalesce(new.changed_by_user_id, new.changed_for_user_id) end;
		return new;
	end if;
	if old.kind = 'call' and current_user = 'engine' and new.from_party_id is distinct from old.from_party_id
		and not exists (select from app_user where id = nullif(current_setting('engine.user_id', true), '')::uuid
			and is_account_partner) then
		raise exception 'only a partner can correct a call''s caller' using errcode = 'insufficient_privilege';
	end if;
	new.call_owner_user_id := old.call_owner_user_id;
	return new;
end $$;
create or replace trigger zz_keep_call_recorder before insert or update on activity
	for each row execute function keep_call_recorder();
revoke execute on function keep_call_recorder() from public;

create or replace function activity_entry(a activity) returns jsonb
language sql stable
begin atomic
	select to_jsonb(a) - 'calendar_review_key' - 'calendar_review_user_id' - 'call_owner_user_id' || jsonb_build_object('email', (
		select to_jsonb(e) - array['activity_id', 'activity_kind', 'imported', 'conversation_id', 'authored', 'history'] || jsonb_build_object('documents', (
			select coalesce(jsonb_agg(to_jsonb(doc) order by doc.name, doc.id), '[]')
			from email_document ed join document doc on doc.id = ed.document_id
			where ed.email_activity_id = e.activity_id
		)) from email e where e.activity_id = a.id
	));
end;

-- From here to the end, the same text as schema/next.sql.
-- The partner login reads through these views, never the tables. Both partners see every call.
create schema if not exists next_partner;
grant usage on schema next_partner to engine, engine_reader;

create view next_partner.activity as
	select a.* from activity a;

create view next_partner.next_step as
	select s.call_activity_id, s.call_contact_party_id, s.call_kind, s.changed_at, s.changed_by_job,
		s.changed_by_user_id, s.changed_for_user_id, s.created_at, s.deal_id, s.done_at, s.due_on, s.hold_until,
		s.home_call_follow_up_id, s.home_step_id, s.id, s.item_bullets, s.item_title, s.owner_party_id, s.party_id,
		s.property_id, s.resolution, s.resolution_event_id, s.resolved_at, s.source_ref,
		s.status, s.what, s.call_evidence_quote, s.resolution_reason
	from next_step s;

create view next_partner.deal_phase_change as
	-- Plain columns let a deal filter reach the table instead of checking every row.
	select m.deal_id, m.happened_at, m.phase, m.reason,
		m.call_activity_id, m.call_move_id, m.call_kind, m.changed_by_user_id, m.changed_by_job,
		m.changed_for_user_id, m.changed_at
	from deal_phase_change m;

create view next_partner.imported_automatic_phase_move as
	select c.source_event_id, c.deal_id, c.happened_at, c.prior_phase, c.reason
	from imported_automatic_phase_move c;

create view next_partner.proposal as
	select p.activity_id, p.activity_kind, p.call_deal_id, p.candidate_id, p.changed_at, p.changed_by_job,
		p.changed_by_user_id, p.changed_for_user_id, p.created_at, p.deal_id, p.decided_at, p.decided_by_user_id,
		p.due_on, p.due_source, p.filed_deal_id, p.filed_vendor_id, p.filing_reason,
		p.filing_scope, p.from_phase, p.from_stage, p.held_deal_id, p.how_found, p.id, p.keeps_deal_date, p.kind,
		p.lead_role, p.merged_step_id, p.next_step_id, p.owner_party_id, p.party_id, p.phase_on, p.phase_stated,
		p.property_id, p.proposed_by_job, p.status, p.step_seen_at, p.strength, p.superseded_reason, p.to_phase,
		p.to_stage, p.evidence, p.reason, p.dismiss_reason, p.what
	from proposal p;

create view next_partner.lead_stage_move as
	select m.* from lead_stage_move m;

-- Each partner reads only their own updates. A checklist update whose item is gone keeps no wording.
create view next_partner.home_update with (security_barrier = true) as
	select visible.* from home_update u left join next_step s on s.deal_id = u.deal_id
		and 'deal-item:' || s.id = u.checklist_item_ref
	cross join lateral jsonb_populate_record(u, jsonb_build_object('what',
		case when u.checklist_item_ref like 'deal-item:%' and s.id is null
			then 'A deal checklist item is due. Open the deal checklist for details.'
			else u.what end)) visible
	where u.user_id = nullif(current_setting('engine.user_id', true), '')::uuid;

create view next_partner.change with (security_barrier = true) as
	-- Preserve audit keys so the planner can use the table-name index condition.
	select c.id, c.table_name, c.record, c.action,
		case when c.table_name = 'home_update' then c.old_value - 'what' else c.old_value end as old_value,
		case when c.table_name = 'home_update' then c.new_value - 'what' else c.new_value end as new_value,
		c.merge_of, c.changed_by_user_id, c.changed_by_job, c.changed_for_user_id, c.changed_at
	from change c
	where case
	when c.table_name = 'lead_stage_move' then exists (
		select from lead_stage_move m left join next_partner.activity a on a.id = m.activity_id
		where m.id = (c.record ->> 'id')::uuid and (m.activity_id is null or a.id is not null))
	when c.table_name = 'home_update' then exists (
		select from next_partner.home_update u where u.id = (c.record ->> 'id')::uuid)
	else true end;

create view next_partner.imported_change as
	select visible.* from imported_change c
	cross join lateral jsonb_populate_record(c, jsonb_build_object('source_event',
		c.source_event - array['human_quote', 'agent_rationale'])) visible;

alter view deal_imported_history set (security_invoker = false);
create view next_partner.deal_imported_history as
	select h.deal_id, h.events from deal_imported_history h;

create view next_partner.deal_next_date as
	select distinct on (s.deal_id) s.deal_id, s.due_on from next_partner.next_step s
	where s.deal_id is not null and s.item_title is null and (s.status = 'open' or exists (
		select from next_partner.proposal p where p.next_step_id = s.id and p.keeps_deal_date and p.decided_at = s.done_at
		and not exists (select from next_partner.next_step newer where newer.deal_id = s.deal_id
			and newer.item_title is null and newer.created_at > p.decided_at)))
	order by s.deal_id, s.created_at desc, s.id desc;

revoke all on activity, next_step, proposal, deal_phase_change, lead_stage_move, change, imported_change,
	imported_automatic_phase_move, imported_deal_history, deal_imported_history, home_update, doc_turn
	from public, engine_reader;
revoke select (deal_id, happened_at, phase, call_activity_id, call_kind, call_move_id,
	changed_at, changed_by_user_id, changed_by_job, changed_for_user_id) on deal_phase_change from engine_reader;
revoke execute on function everything_about_deal(uuid), everything_about_party(uuid), activity_entry(activity)
	from public, engine_reader;
grant execute on function everything_about_deal(uuid), everything_about_party(uuid), activity_entry(activity) to engine;
grant select on next_partner.activity, next_partner.next_step, next_partner.deal_phase_change,
	next_partner.imported_automatic_phase_move, next_partner.proposal, next_partner.lead_stage_move,
	next_partner.home_update, next_partner.change, next_partner.imported_change,
	next_partner.deal_imported_history, next_partner.deal_next_date to engine_reader;
grant select on next_partner.home_update to engine;

commit;
