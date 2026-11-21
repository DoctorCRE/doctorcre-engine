begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

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

-- Keep the existing activity response while the split is only used in capture.
create or replace function activity_entry(a activity) returns jsonb
language sql stable
begin atomic
	select to_jsonb(a) - 'calendar_review_key' - 'calendar_review_user_id' || jsonb_build_object('email', (
		select to_jsonb(e) - array['activity_id', 'activity_kind', 'imported', 'conversation_id', 'authored', 'history'] || jsonb_build_object('documents', (
			select coalesce(jsonb_agg(to_jsonb(doc) order by doc.name, doc.id), '[]')
			from email_document ed join document doc on doc.id = ed.document_id
			where ed.email_activity_id = e.activity_id
		)) from email e where e.activity_id = a.id
	));
end;

commit;

-- Read back both nullable text columns and the engine's column grants.
-- select attname, format_type(atttypid, atttypmod), attnotnull,
--   has_column_privilege('engine', attrelid, attnum, 'update') as engine_can_update
-- from pg_attribute
-- where attrelid = 'next.email'::regclass and not attisdropped
--   and attname in ('authored', 'history') order by attname;
-- select pg_get_constraintdef(oid), convalidated from pg_constraint
-- where conrelid = 'next.email'::regclass and conname = 'email_authored_history_pair';
