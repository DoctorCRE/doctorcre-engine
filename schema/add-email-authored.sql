begin;
set local lock_timeout = '1s';

alter table next.email
	add column if not exists authored text,
	add column if not exists history text;

do $$ begin
	if not exists (
		select from pg_constraint
		where conrelid = 'next.email'::regclass and conname = 'email_authored_history_pair'
	) then
		alter table next.email add constraint email_authored_history_pair
			check ((authored is null) = (history is null));
	end if;
end $$;

grant update (authored, history) on next.email to engine;
commit;

-- Read back both nullable text columns and the engine's column grants.
-- select attname, format_type(atttypid, atttypmod), attnotnull,
--   has_column_privilege('engine', attrelid, attnum, 'update') as engine_can_update
-- from pg_attribute
-- where attrelid = 'next.email'::regclass and not attisdropped
--   and attname in ('authored', 'history') order by attname;
-- select pg_get_constraintdef(oid), convalidated from pg_constraint
-- where conrelid = 'next.email'::regclass and conname = 'email_authored_history_pair';
