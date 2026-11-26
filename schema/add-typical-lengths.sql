-- Add typical to-do lengths per deal kind to an existing next schema (#1386).
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create table if not exists typical_length (
	deal_kind text not null references deal_kind,
	todo text not null check (todo ~ '^[a-z][a-z0-9_]*$'),
	days integer not null check (days > 0),
	primary key (deal_kind, todo)
);

alter table typical_length
	add column if not exists changed_by_user_id uuid references app_user,
	add column if not exists changed_by_job text references job,
	add column if not exists changed_for_user_id uuid references app_user,
	add column if not exists changed_at timestamptz not null;

do $$ begin
	if not exists (select from pg_constraint where conrelid = 'typical_length'::regclass
		and conname = 'typical_length_changed_by_a_user_or_a_job') then
		alter table typical_length add constraint typical_length_changed_by_a_user_or_a_job
			check (num_nonnulls(changed_by_user_id, changed_by_job) = 1
				and (changed_by_job is not null or changed_for_user_id is null));
	end if;
end $$;

create or replace trigger stamp_change before insert or update on typical_length
	for each row execute function stamp_change();
create or replace trigger record_change after insert or update or delete on typical_length
	for each row execute function record_change('deal_kind', 'todo');

grant select, insert, update (days) on typical_length to engine;
grant select on typical_length to engine_reader;

commit;
