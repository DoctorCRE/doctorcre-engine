-- A partner's own end day for one to-do on a deal (#1496).
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create table if not exists deal_plan_date (
	deal_id uuid not null references deal,
	todo text not null,
	target_on date check (isfinite(target_on)),
	primary key (deal_id, todo),
	changed_by_user_id uuid references app_user,
	changed_by_job text references job,
	changed_for_user_id uuid references app_user,
	changed_at timestamptz not null,
	constraint deal_plan_date_changed_by_a_user_or_a_job
		check (num_nonnulls(changed_by_user_id, changed_by_job) = 1
			and (changed_by_job is not null or changed_for_user_id is null))
);

-- The checklist's shared and workflow-specific to-dos (src/deals/checklist.ts).
create or replace function check_deal_plan_todo() returns trigger
language plpgsql as $$
declare
	deal_kind text;
	deal_reason text;
	workflow text;
	todos text[];
begin
	if tg_table_name = 'deal' then
		deal_kind := new.kind;
		deal_reason := new.reason;
		select array_agg(todo) into todos from deal_plan_date where deal_id = new.id and target_on is not null;
	else
		if tg_op = 'UPDATE' and new.target_on is null and (new.deal_id, new.todo) = (old.deal_id, old.todo) then
			return null;
		end if;
		select d.kind, d.reason into deal_kind, deal_reason from deal d where d.id = new.deal_id for no key update;
		todos := array[new.todo];
	end if;
	workflow := case when deal_reason = 'renewal' then 'renewal'
		when deal_kind is not null then deal_kind
		when deal_reason in ('start_up', 'relocation', 'expansion', 'additional_office') then 'lease' end;
	if exists (
		select from unnest(todos) as date_todo(todo)
		where not exists (
			select from (values
				(array['lease', 'renewal', 'purchase', 'land'], array[
					'representation', 'requirements', 'market_survey', 'loi_submission', 'loi_grid', 'business_terms',
					'contract_draft', 'attorney_comments', 'executed_comp', 'invoice_recorded', 'commission_received']),
				(array['lease', 'purchase', 'land'], array['tour_notes']),
				(array['lease', 'renewal'], array['legal_review', 'ti_scope', 'executed_lease', 'commencement_letter', 'expiration_recorded']),
				(array['lease'], array['move_in', 'check_in_90_day']),
				(array['renewal'], array['current_lease_abstraction', 'renewal_analysis']),
				(array['purchase', 'land'], array[
					'purchase_lease_analysis', 'financing_prework', 'earnest_money', 'title_commitment', 'inspections',
					'survey', 'environmental', 'insurance_restrictions', 'appraisal', 'financing_commitment',
					'critical_dates_document', 'commission_agreement', 'purchase_close', 'entity_structure']),
				(array['land'], array['feasibility', 'entitlements'])
			) as checklist(kinds, slugs)
			where workflow = any(kinds) and date_todo.todo = any(slugs)
		)
	) then
		raise exception 'a plan date belongs to a to-do in the deal''s workflow'
			using errcode = 'check_violation', constraint = 'deal_plan_date_workflow_todo';
	end if;
	return null;
end $$;

alter function check_deal_plan_todo() set search_path = next, pg_temp;

drop trigger if exists deal_plan_date_workflow_todo on deal_plan_date;
drop trigger if exists deal_plan_date_workflow_todo on deal;
create constraint trigger deal_plan_date_workflow_todo after insert or update on deal_plan_date
	for each row execute function check_deal_plan_todo();
create constraint trigger deal_plan_date_workflow_todo after update of kind, reason on deal
	for each row when (old.kind is distinct from new.kind or old.reason is distinct from new.reason)
	execute function check_deal_plan_todo();

create or replace trigger stamp_change before insert or update on deal_plan_date
	for each row execute function stamp_change();
create or replace trigger record_change after insert or update or delete on deal_plan_date
	for each row execute function record_change('deal_id', 'todo');

grant select, insert, update (target_on) on deal_plan_date to engine;
grant select on deal_plan_date to engine_reader;

commit;
