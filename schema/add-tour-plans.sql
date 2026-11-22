-- Add the empty tour planner tables to an existing next schema (#1107).
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create table if not exists tour_plan (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	deal_id uuid not null references deal,
	planned_on date not null,
	notes text,
	completed_activity_id uuid unique,
	completed_activity_kind text generated always as ('meeting') stored,
	cancelled_at timestamptz,
	revision integer not null default 1 check (revision >= 1),
	constraint tour_plan_one_outcome check (num_nonnulls(completed_activity_id, cancelled_at) <= 1),
	foreign key (completed_activity_id, completed_activity_kind) references activity (id, kind),
	constraint tour_plan_completed_on_deal foreign key (completed_activity_id, deal_id)
		references activity_about (activity_id, deal_id) deferrable initially deferred
);

create index if not exists tour_plan_deal on tour_plan (deal_id);

create table if not exists tour_stop (
	tour_plan_id uuid not null references tour_plan,
	property_id uuid not null references property,
	position integer not null check (position > 0),
	created_at timestamptz not null default now(),
	primary key (tour_plan_id, position)
);

create or replace function revise_tour_plan() returns trigger
language plpgsql as $$
begin
	if tg_op = 'INSERT' then
		new.revision := 1;
		return new;
	end if;
	if new.deal_id is distinct from old.deal_id then
		raise exception 'a tour plan stays with its deal'
			using errcode = 'check_violation', constraint = 'tour_plan_same_deal';
	end if;
	if num_nonnulls(old.completed_activity_id, old.cancelled_at) <> 0 then
		raise exception 'only a planned tour can change'
			using errcode = 'check_violation', constraint = 'tour_plan_open';
	end if;
	new.revision := old.revision + 1;
	return new;
end $$;

create or replace function tour_stop_on_open_plan() returns trigger
language plpgsql as $$
begin
	-- Restamp the plan on stop edits and serialize them with finalization.
	update tour_plan set planned_on = planned_on where id in (old.tour_plan_id, new.tour_plan_id);
	return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function tour_plan_requires_stop() returns trigger
language plpgsql as $$
declare
	plan_id uuid;
begin
	if tg_table_name = 'tour_plan' then
		plan_id := new.id;
	else
		plan_id := old.tour_plan_id;
	end if;
	if exists (select from tour_plan where id = plan_id)
		and not exists (select from tour_stop where tour_plan_id = plan_id) then
		raise exception 'a tour plan needs at least one stop'
			using errcode = 'check_violation', constraint = 'tour_plan_requires_stop';
	end if;
	return null;
end $$;

do $$ begin
	execute format('alter function tour_stop_on_open_plan set search_path = pg_catalog, %I, pg_temp', current_schema());
	execute format('alter function tour_plan_requires_stop set search_path = pg_catalog, %I, pg_temp', current_schema());
end $$;

revoke execute on function revise_tour_plan(), tour_stop_on_open_plan(), tour_plan_requires_stop() from public;

create or replace trigger revise_tour_plan before insert or update on tour_plan
	for each row execute function revise_tour_plan();
create or replace trigger tour_stop_on_open_plan before insert or update or delete on tour_stop
	for each row execute function tour_stop_on_open_plan();

drop trigger if exists tour_plan_requires_stop on tour_plan;
create constraint trigger tour_plan_requires_stop after insert or update of id on tour_plan
	deferrable initially deferred for each row execute function tour_plan_requires_stop();
drop trigger if exists tour_plan_requires_stop on tour_stop;
create constraint trigger tour_plan_requires_stop after delete or update of tour_plan_id on tour_stop
	deferrable initially deferred for each row execute function tour_plan_requires_stop();

do $$
declare
	stamped text;
begin
	foreach stamped in array array['tour_plan', 'tour_stop'] loop
		execute format('alter table %1$I
			add column if not exists changed_by_user_id uuid references app_user,
			add column if not exists changed_by_job text references job,
			add column if not exists changed_for_user_id uuid references app_user,
			add column if not exists changed_at timestamptz not null', stamped);
		if not exists (select from pg_constraint where conrelid = stamped::regclass
			and conname = stamped || '_changed_by_a_user_or_a_job') then
			execute format('alter table %1$I add constraint %2$I
				check (num_nonnulls(changed_by_user_id, changed_by_job) = 1
					and (changed_by_job is not null or changed_for_user_id is null))',
				stamped, stamped || '_changed_by_a_user_or_a_job');
		end if;
		execute format('create or replace trigger stamp_change before insert or update on %I
			for each row execute function stamp_change()', stamped);
	end loop;
end $$;

create or replace trigger record_change after insert or update or delete on tour_plan
	for each row execute function record_change('id');
create or replace trigger record_change after insert or update or delete on tour_stop
	for each row execute function record_change('tour_plan_id', 'position');

grant select, insert on tour_plan, tour_stop to engine;
grant select on tour_plan, tour_stop to engine_reader;
grant update (planned_on, notes, completed_activity_id, cancelled_at) on tour_plan to engine;
grant delete on tour_stop to engine;

commit;
