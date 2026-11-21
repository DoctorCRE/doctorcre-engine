-- Apply once as the schema owner after owner approval (#1037).
begin;

-- Take the Preferences save locks before blocking writes to the table.
do $$
declare
	utc_count bigint;
begin
	perform pg_advisory_xact_lock(hashtextextended('user_preference:' || id, 0))
	from next.app_user order by id;
	lock table next.user_preference in share row exclusive mode;

	select count(*) into utc_count from next.user_preference where time_zone = 'UTC';
	if utc_count <> 1 then
		raise exception 'Expected 1 UTC preference, found %', utc_count;
	end if;

	perform set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
	update next.user_preference p set time_zone = 'America/Chicago'
	where p.time_zone = 'UTC' and (
		select c.action = 'insert' and c.changed_by_job = 'old_system'
		from next.change c
		where c.table_name = 'user_preference' and c.record = jsonb_build_object('user_id', p.user_id)
			and c.new_value ? 'time_zone'
		order by c.id desc limit 1
	);
	if not found then
		raise exception 'The UTC preference was not set by the old system copy';
	end if;
end $$;

commit;
