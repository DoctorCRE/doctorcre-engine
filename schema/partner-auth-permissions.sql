with outside_auth as (
	select oid, nspname from pg_namespace
	where nspname !~ '^pg_' and nspname not in ('information_schema', 'doctorcre_auth')
), auth_tables as (
	select oid, relname::text as table_name from pg_class
	where relnamespace = 'doctorcre_auth'::regnamespace and relkind in ('r','p','v','m','f')
), auth_columns as (
	select t.oid, table_name, attnum, attname::text as column_name
	from auth_tables t join pg_attribute a on a.attrelid = t.oid
	where attnum <> 0 and not attisdropped
), table_privileges (privilege, applies_to_columns) as (
	values ('SELECT', true), ('INSERT', true), ('UPDATE', true), ('REFERENCES', true),
	       ('DELETE', false), ('TRUNCATE', false), ('TRIGGER', false), ('MAINTAIN', false)
), privilege_modes as (
	select privilege || suffix as privilege, applies_to_columns
	from table_privileges cross join (values (''), (' WITH GRANT OPTION')) as options(suffix)
), allowed_table_access (table_name, privilege) as (
	values ('user', 'SELECT'), ('account', 'SELECT'), ('partner', 'SELECT'),
	       ('session', 'SELECT'), ('session', 'INSERT'), ('session', 'DELETE'),
	       ('verification', 'SELECT'), ('verification', 'INSERT'),
	       ('verification', 'UPDATE'), ('verification', 'DELETE')
), allowed_auth_access (table_name, column_name, privilege) as (
	select table_name, null::text, privilege from allowed_table_access
	union all
	-- PostgreSQL treats table grants as effective column grants.
	select table_name, column_name, privilege from auth_columns
	join allowed_table_access using (table_name)
	join table_privileges using (privilege) where applies_to_columns
	union all
	values ('session', 'googleAuthenticatedAt', 'UPDATE'), ('session', 'updatedAt', 'UPDATE')
), effective_auth_access (table_name, column_name, privilege) as (
	select table_name, null::text, privilege from auth_tables cross join privilege_modes
	where has_table_privilege(oid, privilege)
	union all
	select table_name, column_name, privilege from auth_columns cross join privilege_modes
	where case when applies_to_columns then has_column_privilege(oid, attnum, privilege) else false end
), auth_access_differences as (
	select 'missing' as difference, access.*
	from (select * from allowed_auth_access except select * from effective_auth_access) access
	union all
	select 'unexpected', access.*
	from (select * from effective_auth_access except select * from allowed_auth_access) access
)
select 'unsafe login attributes' as finding from pg_roles
where rolname = current_user and (not rolcanlogin or not rolinherit
	or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
union all
select 'missing effective engine_partner_auth membership'
where not pg_has_role('engine_partner_auth', 'USAGE')
union all
select format('unexpected role membership: %I', rolname) from pg_roles
where rolname not in (current_user, 'engine_partner_auth') and pg_has_role(oid, 'MEMBER')
union all
select 'can grant engine_partner_auth membership' from pg_auth_members
where member = current_user::regrole and roleid = 'engine_partner_auth'::regrole and admin_option
union all
select 'missing doctorcre_auth schema usage' where not has_schema_privilege('doctorcre_auth', 'USAGE')
union all
select 'unexpected CREATE on doctorcre_auth' where has_schema_privilege('doctorcre_auth', 'CREATE')
union all
select format('%s %s on doctorcre_auth.%I%s', difference, privilege, table_name,
	case when column_name is null then '' else format('.%I', column_name) end)
from auth_access_differences
union all
select nspname from outside_auth
where has_schema_privilege(oid, 'CREATE')
	or (nspname <> 'public' and has_schema_privilege(oid, 'USAGE'))
union all
select format('%I.%I', nspname, relname) from pg_class c join outside_auth n on n.oid = c.relnamespace
where case when relkind = 'S' then has_sequence_privilege(c.oid, 'SELECT, UPDATE, USAGE')
	when relkind in ('r','p','v','m','f') then
		has_table_privilege(c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
		or has_any_column_privilege(c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
	else false end
union all
select format('%I.%I', nspname, proname) from pg_proc p join outside_auth n on n.oid = p.pronamespace
where prosecdef and has_function_privilege(p.oid, 'EXECUTE');
