begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table proposal add column if not exists due_source text;

do $$
begin
	if not exists (
		select from pg_constraint where conrelid = 'proposal'::regclass
		and conname = 'proposal_due_source'
	) then
		alter table proposal add constraint proposal_due_source check (due_source is null or
			(kind = 'next_step' and due_on is not null and due_source in ('stated', 'defaulted')));
	end if;
end $$;

commit;
