begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create or replace function call_visible_to(
	changed_by_user_id uuid, changed_by_job text, changed_for_user_id uuid,
	viewer_id uuid default nullif(current_setting('engine.user_id', true), '')::uuid
) returns boolean
language sql immutable set search_path = next, pg_temp as $$
	select coalesce(viewer_id in (changed_by_user_id, changed_for_user_id)
		or (changed_by_job = 'old_system' and changed_by_user_id is null and changed_for_user_id is null), false);
$$;

revoke execute on function call_visible_to(uuid, text, uuid, uuid) from public;
grant execute on function call_visible_to(uuid, text, uuid, uuid) to engine, engine_reader;

commit;
