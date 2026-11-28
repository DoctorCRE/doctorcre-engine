-- A partner's own end day for one to-do on a deal (#1496).
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create table if not exists deal_plan_date (
	deal_id uuid not null references deal,
	todo text not null check (todo ~ '^[a-z][a-z0-9_]*$'),
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

create or replace trigger stamp_change before insert or update on deal_plan_date
	for each row execute function stamp_change();
create or replace trigger record_change after insert or update or delete on deal_plan_date
	for each row execute function record_change('deal_id', 'todo');

grant select, insert, update (target_on) on deal_plan_date to engine;
grant select on deal_plan_date to engine_reader;

commit;
