begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table activity enable row level security;
create policy activity_engine on activity to engine using (true);
create policy activity_reader on activity for select to engine_reader using (
	kind <> 'call' or call_visible_to(changed_by_user_id, changed_by_job, changed_for_user_id)
);

alter table change enable row level security;
create policy change_engine on change to engine using (true);
create policy change_reader on change for select to engine_reader using (
	case when table_name = 'activity' and (old_value ? 'summary' or new_value ? 'summary') then
		exists (select from activity a where a.id = (change.record ->> 'id')::uuid and (
			a.kind <> 'call'
			-- The change stamp identifies the new text's author, not the previous text's owner.
			or (old_value ->> 'summary' is null and call_visible_to(
				change.changed_by_user_id, change.changed_by_job, change.changed_for_user_id))
		))
	else true end
);

alter table imported_change enable row level security;
create policy imported_change_engine on imported_change to engine using (true);
create policy imported_change_reader on imported_change for select to engine_reader using (
	case when table_name = 'activity' then
		exists (select from activity a where a.id = (imported_change.record ->> 'id')::uuid)
	else true end
);

commit;
