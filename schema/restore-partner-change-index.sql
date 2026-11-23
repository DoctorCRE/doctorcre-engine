begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create or replace view next_partner.change with (security_barrier = true) as
	-- Preserve audit keys so the planner can use the table-name index condition.
	select c.id, c.table_name, c.record, c.action,
		case when redact.field is null then c.old_value else c.old_value - redact.field end as old_value,
		case when redact.field is null then c.new_value else c.new_value - redact.field end as new_value,
		c.merge_of, c.changed_by_user_id, c.changed_by_job, c.changed_for_user_id, c.changed_at
	from change c
	cross join lateral (select case
		when c.table_name = 'home_update' then 'what'
		when c.table_name = 'next_step' then 'resolution_reason'
		when c.table_name = 'deal_phase_change' and coalesce(c.old_value ->> 'reason', c.new_value ->> 'reason') is not null
			and not exists (select from next_partner.deal_phase_change m
				where m.deal_id = (c.record ->> 'deal_id')::uuid
					and m.happened_at = (c.record ->> 'happened_at')::timestamptz and m.reason is not null) then 'reason'
	end as field) redact
	where case
	when c.table_name = 'activity' and (c.old_value ? 'summary' or c.new_value ? 'summary') then
		exists (select from next_partner.activity a where a.id = (c.record ->> 'id')::uuid and (
			a.kind <> 'call' or (c.old_value ->> 'summary' is null and call_visible_to(
				c.changed_by_user_id, c.changed_by_job, c.changed_for_user_id))))
	when c.table_name = 'next_step' then
		coalesce((select call_step_visible_to(
			coalesce(s.call_activity_id, accepted_step_call(s.id)), s.owner_party_id)
			from next_step s where s.id = (c.record ->> 'id')::uuid),
			case when c.action in ('insert', 'delete') then call_step_visible_to(
				coalesce((coalesce(c.new_value, c.old_value) ->> 'call_activity_id')::uuid,
					accepted_step_call((c.record ->> 'id')::uuid)),
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

commit;
