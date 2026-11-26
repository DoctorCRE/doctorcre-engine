-- Add the towns inside a market to an existing next schema (#1374).
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create table if not exists market_city (
	market_id uuid not null references market,
	city text not null check (city ~ '\S' and city = btrim(city)),
	created_at timestamptz not null default now(),
	primary key (market_id, city)
);
create unique index if not exists market_city_once on market_city (market_id, lower(city));

alter table market_city
	add column if not exists changed_by_user_id uuid references app_user,
	add column if not exists changed_by_job text references job,
	add column if not exists changed_for_user_id uuid references app_user,
	add column if not exists changed_at timestamptz not null;

do $$ begin
	if not exists (select from pg_constraint where conrelid = 'market_city'::regclass
		and conname = 'market_city_changed_by_a_user_or_a_job') then
		alter table market_city add constraint market_city_changed_by_a_user_or_a_job
			check (num_nonnulls(changed_by_user_id, changed_by_job) = 1
				and (changed_by_job is not null or changed_for_user_id is null));
	end if;
end $$;

create or replace trigger stamp_change before insert or update on market_city
	for each row execute function stamp_change();
create or replace trigger record_change after insert or update or delete on market_city
	for each row execute function record_change('market_id', 'city');

grant select, insert, delete on market_city to engine;
grant select on market_city to engine_reader;

commit;
