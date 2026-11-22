begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table activity
	add column if not exists call_owner_user_id uuid references app_user,
	add column if not exists call_shared boolean;

create or replace function call_visible_to(source activity, viewer uuid default nullif(current_setting('engine.user_id', true), '')::uuid)
returns boolean language sql stable set search_path = next, pg_temp as $$
	select call_visible_to(source.call_owner_user_id,
		case when source.call_shared then 'old_system' end, null, viewer);
$$;

create or replace function keep_call_audience() returns trigger
language plpgsql set search_path = next, pg_temp as $$
declare viewer uuid := nullif(current_setting('engine.user_id', true), '')::uuid;
begin
	if tg_op = 'INSERT' then
		if new.kind = 'call' then
			new.call_owner_user_id := coalesce(new.changed_by_user_id, new.changed_for_user_id);
			new.call_shared := new.changed_by_job is not distinct from 'old_system' and new.call_owner_user_id is null;
		end if;
	elsif old.call_shared is not null then
		if current_user = 'engine' and new.from_party_id is distinct from old.from_party_id and (
			not call_visible_to(old, viewer) or not exists (select from app_user where id = viewer and is_account_partner)
		) then
			raise exception 'only a partner who can see the call can correct its caller'
				using errcode = 'insufficient_privilege';
		end if;
		new.call_owner_user_id := old.call_owner_user_id;
		new.call_shared := old.call_shared;
	end if;
	return new;
end $$;

-- Native inserts keep the original actor in audit. A later edit can obscure the original stamp of a copied call.
alter table activity disable trigger stamp_change, disable trigger record_change;
with original as (
	select a.id, case when c.id is null or c.changed_by_job = 'old_system'
		then coalesce(a.changed_by_user_id, a.changed_for_user_id)
		else coalesce(c.changed_by_user_id, c.changed_for_user_id) end as owner_id,
		case when c.id is null or c.changed_by_job = 'old_system'
		then a.changed_by_job else c.changed_by_job end as job
	from activity a left join lateral (
		select id, changed_by_user_id, changed_for_user_id, changed_by_job from change
		where table_name = 'activity' and record = jsonb_build_object('id', a.id) and action = 'insert'
		order by id limit 1
	) c on true where a.kind = 'call' and a.call_shared is null
), corrected_copy as (
	select o.id from original o join change c
		on c.table_name = 'activity' and c.record = jsonb_build_object('id', o.id)
	where c.action = 'insert' and c.changed_by_job = 'old_system'
		and exists (select from change edit where edit.table_name = c.table_name and edit.record = c.record
			and edit.action = 'update' and edit.changed_by_job is distinct from 'old_system')
)
update activity a set call_owner_user_id = case when copy.id is null then original.owner_id end,
	call_shared = copy.id is null and original.job is not distinct from 'old_system' and original.owner_id is null
from original left join corrected_copy copy using (id) where original.id = a.id;
alter table activity enable trigger stamp_change, enable trigger record_change;

create or replace trigger zz_keep_call_audience before insert or update on activity
	for each row execute function keep_call_audience();

create or replace function call_source_visible(source uuid, viewer uuid default nullif(current_setting('engine.user_id', true), '')::uuid)
returns boolean language sql stable security definer set search_path = next, pg_temp as $$
	select exists (select from activity a where a.id = source and call_visible_to(a, viewer));
$$;

create or replace function call_step_visible_to(source uuid, owner uuid, viewer uuid default nullif(current_setting('engine.user_id', true), '')::uuid)
returns boolean language sql stable set search_path = next, pg_temp as $$
	select source is null or coalesce(owner = viewer, false) or call_source_visible(source, viewer);
$$;

revoke execute on function call_visible_to(activity, uuid), keep_call_audience(),
	call_source_visible(uuid, uuid), call_step_visible_to(uuid, uuid, uuid) from public;
grant execute on function call_visible_to(activity, uuid), call_source_visible(uuid, uuid),
	call_step_visible_to(uuid, uuid, uuid) to engine, engine_reader;

create table if not exists call_audit_evidence (
	change_id bigint primary key references change,
	field text not null,
	old_value jsonb,
	new_value jsonb
);

create or replace function separate_call_audit_evidence() returns trigger
language plpgsql set search_path = next, pg_temp as $$
declare protected_field text;
begin
	if new.action = 'erase' then
		delete from call_audit_evidence e using change c
		where c.id = e.change_id and c.table_name = new.table_name and c.record = new.record
			and new.new_value -> 'fields' ? e.field;
		return null;
	end if;
	protected_field := case
		when new.table_name = 'next_step' then 'call_evidence_quote'
		when new.table_name = 'deal_phase_change'
			and coalesce(new.old_value ->> 'call_activity_id', new.new_value ->> 'call_activity_id') is not null then 'reason'
	end;
	if coalesce(new.old_value ->> protected_field, new.new_value ->> protected_field) is not null then
		insert into call_audit_evidence values (new.id, protected_field,
			new.old_value -> protected_field, new.new_value -> protected_field);
		-- Keep the keys so erase_change can still erase these fields.
		update change set old_value = jsonb_set(new.old_value, array[protected_field], 'null', false),
			new_value = jsonb_set(new.new_value, array[protected_field], 'null', false) where id = new.id;
	end if;
	return null;
end $$;
create or replace trigger separate_call_audit_evidence after insert or update on change
	for each row execute function separate_call_audit_evidence();
revoke execute on function separate_call_audit_evidence() from public;

create schema if not exists next_partner;
grant usage on schema next_partner to engine_reader;

create or replace view next_partner.activity with (security_barrier = true) as
	select a.* from activity a where a.kind <> 'call' or call_visible_to(a);

create or replace view next_partner.next_step with (security_barrier = true) as
	select s.call_activity_id, s.call_contact_party_id, s.call_kind, s.changed_at, s.changed_by_job,
		s.changed_by_user_id, s.changed_for_user_id, s.created_at, s.deal_id, s.done_at, s.due_on, s.hold_until,
		s.home_call_follow_up_id, s.home_step_id, s.id, s.item_bullets, s.item_title, s.owner_party_id, s.party_id,
		s.property_id, s.resolution, s.resolution_event_id, s.resolved_at, s.source_ref,
		s.status, s.what,
		case when call_source_visible(s.call_activity_id) then s.call_evidence_quote end as call_evidence_quote,
		case when s.call_activity_id is null or call_source_visible(s.call_activity_id) then s.resolution_reason end as resolution_reason
	from next_step s
	where call_step_visible_to(s.call_activity_id, s.owner_party_id);

create or replace view next_partner.deal_phase_change with (security_barrier = true) as
	select visible.* from deal_phase_change m cross join lateral jsonb_populate_record(m, jsonb_build_object('reason',
		case when (m.call_activity_id is null or call_source_visible(m.call_activity_id))
			and (call_visible_to(m.changed_by_user_id, m.changed_by_job, m.changed_for_user_id) or not exists (
				select from imported_automatic_phase_move c where (c.deal_id, c.happened_at) = (m.deal_id, m.happened_at)))
			and not exists (
			select from proposal p where p.kind = 'phase_move' and p.status = 'accepted' and p.deal_id = m.deal_id
				and p.activity_kind = 'call' and p.to_phase = m.phase and p.reason = m.reason
				and not call_source_visible(p.activity_id)
		) then m.reason end)) visible;

create or replace view next_partner.imported_automatic_phase_move as
	select c.source_event_id, c.deal_id, c.happened_at, c.prior_phase,
		case when call_visible_to(p.changed_by_user_id, p.changed_by_job, p.changed_for_user_id)
			then c.reason end as reason
	from imported_automatic_phase_move c join deal_phase_change p using (deal_id, happened_at);

create or replace view next_partner.proposal with (security_barrier = true) as
	select p.activity_id, p.activity_kind, p.call_deal_id, p.candidate_id, p.changed_at, p.changed_by_job,
		p.changed_by_user_id, p.changed_for_user_id, p.created_at, p.deal_id, p.decided_at, p.decided_by_user_id,
		p.due_on, p.due_source, p.filed_deal_id, p.filed_vendor_id, p.filing_reason,
		p.filing_scope, p.from_phase, p.from_stage, p.held_deal_id, p.how_found, p.id, p.keeps_deal_date, p.kind,
		p.lead_role, p.merged_step_id, p.next_step_id, p.owner_party_id, p.party_id, p.phase_on, p.phase_stated,
		p.property_id, p.proposed_by_job, p.status, p.step_seen_at, p.strength, p.superseded_reason, p.to_phase,
		p.to_stage,
		case when access.evidence then p.evidence else '' end as evidence,
		case when access.evidence then p.reason end as reason,
		case when access.evidence then p.dismiss_reason end as dismiss_reason,
		case when access.evidence or (p.kind = 'next_step'
			and call_step_visible_to(p.activity_id, p.owner_party_id)) then p.what end as what
	from proposal p
	cross join lateral (select p.activity_kind is distinct from 'call' or call_source_visible(p.activity_id) as evidence) access;

create or replace view next_partner.lead_stage_move with (security_barrier = true) as
	select visible.* from lead_stage_move m left join activity a on a.id = m.activity_id
	cross join lateral jsonb_populate_record(m, jsonb_build_object(
		'evidence_ref', case when a.kind is distinct from 'call' or call_visible_to(a) then m.evidence_ref end,
		'reason', case when a.kind is distinct from 'call' or call_visible_to(a) then m.reason end)) visible;

create or replace view next_partner.home_update with (security_barrier = true) as
	select visible.* from home_update u left join next_step s on s.deal_id = u.deal_id
		and 'deal-item:' || s.id = u.checklist_item_ref
	cross join lateral jsonb_populate_record(u, jsonb_build_object('what',
		case when u.checklist_item_ref like 'deal-item:%' and s.id is null
			then 'A deal checklist item is due. Open the deal checklist for details.'
			else u.what end)) visible
	where u.user_id = nullif(current_setting('engine.user_id', true), '')::uuid
		and (s.id is null or call_step_visible_to(s.call_activity_id, s.owner_party_id));

create or replace view next_partner.change with (security_barrier = true) as
	select visible.* from change c
	cross join lateral (select case
		when c.table_name = 'home_update' then 'what'
		when c.table_name = 'next_step' then 'resolution_reason'
		when c.table_name = 'deal_phase_change' and coalesce(c.old_value ->> 'reason', c.new_value ->> 'reason') is not null
			and not exists (select from next_partner.deal_phase_change m
				where m.deal_id = (c.record ->> 'deal_id')::uuid
					and m.happened_at = (c.record ->> 'happened_at')::timestamptz and m.reason is not null) then 'reason'
	end as field) redact
	cross join lateral jsonb_populate_record(c, case when redact.field is null then '{}'::jsonb else
		jsonb_build_object('old_value', c.old_value - redact.field, 'new_value', c.new_value - redact.field) end) visible
	where case
	when c.table_name = 'activity' and (c.old_value ? 'summary' or c.new_value ? 'summary') then
		exists (select from next_partner.activity a where a.id = (c.record ->> 'id')::uuid and (
			a.kind <> 'call' or (c.old_value ->> 'summary' is null and call_visible_to(
				c.changed_by_user_id, c.changed_by_job, c.changed_for_user_id))))
	when c.table_name = 'next_step' then
		coalesce((select call_step_visible_to(s.call_activity_id, s.owner_party_id)
			from next_step s where s.id = (c.record ->> 'id')::uuid),
			case when c.action in ('insert', 'delete') then call_step_visible_to(
				(coalesce(c.new_value, c.old_value) ->> 'call_activity_id')::uuid,
				(coalesce(c.new_value, c.old_value) ->> 'owner_party_id')::uuid) else false end)
	when c.table_name = 'proposal' then exists (
		select from proposal p where p.id = (c.record ->> 'id')::uuid
			and (p.activity_kind is distinct from 'call' or call_source_visible(p.activity_id)))
	when c.table_name = 'lead_stage_move' then exists (
		select from lead_stage_move m left join next_partner.activity a on a.id = m.activity_id
		where m.id = (c.record ->> 'id')::uuid and (m.activity_id is null or a.id is not null))
	when c.table_name = 'home_update' then exists (
		select from next_partner.home_update u where u.id = (c.record ->> 'id')::uuid)
	else true end;

create or replace view next_partner.imported_change with (security_barrier = true) as
	select visible.* from imported_change c
	cross join lateral jsonb_populate_record(c, jsonb_build_object('source_event',
		c.source_event - array['human_quote', 'agent_rationale'])) visible
	where case c.table_name
		when 'activity' then exists (select from next_partner.activity a where a.id = (c.record ->> 'id')::uuid)
		when 'proposal' then exists (select from proposal p where p.id = (c.record ->> 'id')::uuid
			and (p.activity_kind is distinct from 'call' or call_source_visible(p.activity_id)))
		else true end;

alter view deal_imported_history set (security_invoker = false);
create or replace view next_partner.deal_imported_history with (security_barrier = true) as
	select h.deal_id, (select jsonb_agg(e.value order by e.position)
		from jsonb_array_elements(h.events) with ordinality e(value, position)
		where case when e.value ->> 'verb' = 'resolve-post-call-candidate'
			or e.value #>> '{new_value,kind}' = 'call'
			then exists (select from next_partner.activity a where a.id::text = coalesce(
				e.value #>> '{new_value,activity_id}', e.value #>> '{new_value,activity}'))
			else true end) as events
	from deal_imported_history h;

create or replace view next_partner.deal_next_date as
	select distinct on (s.deal_id) s.deal_id, s.due_on from next_partner.next_step s
	where s.deal_id is not null and s.item_title is null and (s.status = 'open' or exists (
		select from next_partner.proposal p where p.next_step_id = s.id and p.keeps_deal_date and p.decided_at = s.done_at
		and not exists (select from next_partner.next_step newer where newer.deal_id = s.deal_id
			and newer.item_title is null and newer.created_at > p.decided_at)))
	order by s.deal_id, s.created_at desc, s.id desc;

revoke all on activity, next_step, proposal, deal_phase_change, lead_stage_move, change, imported_change,
	imported_automatic_phase_move, imported_deal_history, deal_imported_history, home_update,
	call_audit_evidence, doc_turn from public, engine_reader;
revoke all on call_audit_evidence from engine;
revoke select (deal_id, happened_at, phase, call_activity_id, call_kind, call_move_id,
	changed_at, changed_by_user_id, changed_by_job, changed_for_user_id) on deal_phase_change from engine_reader;
revoke execute on function everything_about_deal(uuid), everything_about_party(uuid), activity_entry(activity)
	from public, engine_reader;
grant execute on function everything_about_deal(uuid), everything_about_party(uuid), activity_entry(activity) to engine;
grant select on next_partner.activity, next_partner.next_step, next_partner.deal_phase_change,
	next_partner.imported_automatic_phase_move, next_partner.proposal, next_partner.lead_stage_move,
	next_partner.home_update, next_partner.change, next_partner.imported_change,
	next_partner.deal_imported_history, next_partner.deal_next_date to engine_reader;

create or replace function activity_entry(a activity) returns jsonb
language sql stable
begin atomic
	select to_jsonb(a) - array['calendar_review_key', 'calendar_review_user_id', 'call_owner_user_id', 'call_shared']
		|| jsonb_build_object('email', (
		select to_jsonb(e) - array['activity_id', 'activity_kind', 'imported', 'conversation_id', 'authored', 'history'] || jsonb_build_object('documents', (
			select coalesce(jsonb_agg(to_jsonb(doc) order by doc.name, doc.id), '[]')
			from email_document ed join document doc on doc.id = ed.document_id
			where ed.email_activity_id = e.activity_id
		)) from email e where e.activity_id = a.id
	));
end;

update change set old_value = old_value
where (table_name = 'next_step' and coalesce(old_value ->> 'call_evidence_quote', new_value ->> 'call_evidence_quote') is not null)
	or (table_name = 'deal_phase_change' and coalesce(old_value ->> 'call_activity_id', new_value ->> 'call_activity_id') is not null
		and coalesce(old_value ->> 'reason', new_value ->> 'reason') is not null);

commit;
