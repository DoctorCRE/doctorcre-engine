begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create or replace view next_partner.deal_phase_change with (security_barrier = true) as
	-- Plain columns let a deal filter reach the table instead of checking every row.
	select m.deal_id, m.happened_at, m.phase,
		case when (m.call_activity_id is null or call_source_visible(m.call_activity_id))
			and (call_visible_to(m.changed_by_user_id, m.changed_by_job, m.changed_for_user_id) or not exists (
				select from imported_automatic_phase_move c where (c.deal_id, c.happened_at) = (m.deal_id, m.happened_at)))
			and not exists (
			select from proposal p where p.kind = 'phase_move' and p.status = 'accepted' and p.deal_id = m.deal_id
				and p.activity_kind = 'call' and p.to_phase = m.phase and p.reason = m.reason
				and not call_source_visible(p.activity_id)
		) then m.reason end as reason,
		m.call_activity_id, m.call_move_id, m.call_kind, m.changed_by_user_id, m.changed_by_job,
		m.changed_for_user_id, m.changed_at
	from deal_phase_change m;

commit;
