-- Install on an existing next schema before deploying the people and company saves (#1245). Safe to apply twice.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create or replace function party_name_saved_nonblank() returns trigger
language plpgsql as $$
begin
	if not pg_has_role((select relowner from pg_catalog.pg_class where oid = tg_relid), 'USAGE') then
		raise exception 'a saved name is not blank'
			using errcode = 'check_violation', constraint = 'party_name_saved_nonblank';
	end if;
	return new;
end $$;

drop trigger if exists party_name_saved_nonblank on party;
create trigger party_name_saved_nonblank before insert or update of name on party
	for each row when (new.name !~ '\S') execute function party_name_saved_nonblank();

grant update (city) on party to engine;
commit;
