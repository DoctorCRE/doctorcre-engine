-- Apply after add-doc-confirmation-grant.sql.
-- Preflight: expect zero rows in the count of drafts without a job on the prior schema.
-- select count(*) from next.reply_draft where proposed_by_job is null;
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table reply_draft
	add column if not exists confirmed_doc_turn_id uuid,
	alter column proposed_by_job drop not null;

do $$ begin
	if not exists (select from pg_constraint where conrelid = 'reply_draft'::regclass
		and conname = 'reply_draft_confirmed_doc_turn_key') then
		alter table reply_draft add constraint reply_draft_confirmed_doc_turn_key unique (confirmed_doc_turn_id);
	end if;
	if not exists (select from pg_constraint where conrelid = 'reply_draft'::regclass
		and conname = 'reply_draft_confirmed_doc_turn_owner_fkey') then
		alter table reply_draft add constraint reply_draft_confirmed_doc_turn_owner_fkey
			foreign key (confirmed_doc_turn_id, owner_user_id) references doc_turn (id, owner_user_id);
	end if;
	if not exists (select from pg_constraint where conrelid = 'reply_draft'::regclass
		and conname = 'reply_draft_one_origin') then
		alter table reply_draft add constraint reply_draft_one_origin
			check (num_nonnulls(proposed_by_job, confirmed_doc_turn_id) = 1);
	end if;
end $$;

create or replace function reply_draft_doc_origin() returns trigger
language plpgsql as $$
begin
	if new.owner_user_id is distinct from nullif(current_setting('engine.user_id', true), '')::uuid
		or not exists (
			select from doc_turn t
			where t.id = new.confirmed_doc_turn_id and t.owner_user_id = new.owner_user_id
				and t.confirmation_key is not null
				and t.answer #>> '{proposal,kind}' = 'reply_draft'
				and t.answer #>> '{proposal,target,ref,kind}' = 'email'
				and t.answer #>> '{proposal,target,ref,id}' = new.email_activity_id::text
			for share
		) then
		raise exception 'a Doc draft requires its owner to confirm a reply to that email'
			using errcode = 'check_violation', constraint = 'reply_draft_doc_origin';
	end if;
	return new;
end $$;

do $$ begin
	execute format('alter function reply_draft_doc_origin set search_path = pg_catalog, %I, pg_temp', current_schema());
end $$;
revoke execute on function reply_draft_doc_origin from public;

create or replace trigger reply_draft_doc_origin before insert on reply_draft
	for each row when (new.confirmed_doc_turn_id is not null and new.proposed_by_job is null)
	execute function reply_draft_doc_origin();

commit;

-- Read back two nullable origin columns. Expect engine insert and no origin update
-- for either column, and no reader insert.
-- select attname, attnotnull,
--   has_column_privilege('engine', attrelid, attname, 'INSERT') as engine_insert,
--   has_column_privilege('engine', attrelid, attname, 'UPDATE') as engine_update,
--   has_column_privilege('engine_reader', attrelid, attname, 'INSERT') as reader_insert
-- from pg_attribute where attrelid = 'next.reply_draft'::regclass
--   and attname in ('proposed_by_job', 'confirmed_doc_turn_id') order by attname;
--
-- Expect the validated unique, owner/turn foreign key, and exactly-one-origin constraints.
-- select conname, pg_get_constraintdef(oid), convalidated
-- from pg_constraint where conrelid = 'next.reply_draft'::regclass
--   and conname in ('reply_draft_confirmed_doc_turn_key',
--     'reply_draft_confirmed_doc_turn_owner_fkey', 'reply_draft_one_origin') order by conname;
--
-- Expect one enabled BEFORE INSERT trigger and the invoker function with the fixed search path.
-- select pg_get_triggerdef(t.oid), t.tgenabled, pg_get_functiondef(t.tgfoid)
-- from pg_trigger t where t.tgrelid = 'next.reply_draft'::regclass
--   and t.tgname = 'reply_draft_doc_origin';
