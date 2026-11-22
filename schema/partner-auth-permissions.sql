with outside_auth as (
	select oid, nspname from pg_namespace
	where nspname !~ '^pg_' and nspname not in ('information_schema', 'doctorcre_auth')
), required_table_access (table_name, privilege) as (
	values ('"user"', 'SELECT'), ('account', 'SELECT'), ('partner', 'SELECT'),
	       ('session', 'SELECT'), ('session', 'INSERT'), ('session', 'DELETE'),
	       ('verification', 'SELECT'), ('verification', 'INSERT'),
	       ('verification', 'UPDATE'), ('verification', 'DELETE')
), session_update_columns (column_name) as (
	values ('googleAuthenticatedAt'), ('updatedAt')
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
select format('missing %s on doctorcre_auth.%s', privilege, table_name) from required_table_access
where not has_table_privilege('doctorcre_auth.' || table_name, privilege)
union all
select format('missing UPDATE on doctorcre_auth.session.%I', column_name) from session_update_columns
where not has_column_privilege('doctorcre_auth.session', column_name, 'UPDATE')
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
where prosecdef and has_function_privilege(p.oid, 'EXECUTE')
union all
select 'write access beyond session fields' where
	has_schema_privilege('doctorcre_auth', 'CREATE')
	or has_table_privilege('doctorcre_auth.account', 'DELETE')
	or has_column_privilege('doctorcre_auth."user"', 'partner_user_id', 'UPDATE')
	or has_column_privilege('doctorcre_auth.session', 'token', 'UPDATE');
