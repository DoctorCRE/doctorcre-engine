-- Add each partner's starred deals to an existing next schema (#1240).
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create table if not exists deal_star (
	user_id uuid not null references app_user,
	deal_id uuid not null references deal on delete cascade,
	created_at timestamptz not null default now(),
	primary key (user_id, deal_id)
);

alter table deal_star
	add column if not exists changed_by_user_id uuid references app_user,
	add column if not exists changed_by_job text references job,
	add column if not exists changed_for_user_id uuid references app_user,
	add column if not exists changed_at timestamptz not null;

do $$ begin
	if not exists (select from pg_constraint where conrelid = 'deal_star'::regclass
		and conname = 'deal_star_changed_by_a_user_or_a_job') then
		alter table deal_star add constraint deal_star_changed_by_a_user_or_a_job
			check (num_nonnulls(changed_by_user_id, changed_by_job) = 1
				and (changed_by_job is not null or changed_for_user_id is null));
	end if;
	if not exists (select from pg_constraint where conrelid = 'deal_star'::regclass
		and conname = 'deal_star_by_its_user') then
		alter table deal_star add constraint deal_star_by_its_user
			check (changed_by_user_id is not distinct from user_id);
	end if;
end $$;

create or replace trigger stamp_change before insert or update on deal_star
	for each row execute function stamp_change();
create or replace trigger record_change after insert or update or delete on deal_star
	for each row execute function record_change('user_id', 'deal_id');

grant select, insert, delete on deal_star to engine;
grant select on deal_star to engine_reader;

commit;
