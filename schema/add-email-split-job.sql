-- Apply after the Doc judgment queue, summary enqueue and authored email storage exist.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

do $$ begin
	if to_regclass('next.doc_judgment_job') is null or to_regclass('next.lead_source_sender') is null
		or not exists (select from pg_attribute where attrelid = 'next.email'::regclass and attname = 'authored') then
		raise exception 'Install the Doc judgment queue, lead-source sender storage and authored email storage first';
	end if;
end $$;

alter table doc_judgment_job
	drop constraint if exists doc_judgment_job_kind_check,
	add constraint doc_judgment_job_kind_check check (kind in ('email_summary', 'email_filing', 'email_split'));

-- Two captures can both pass the not-exists check. One transaction, so the index is not concurrent.
create unique index if not exists doc_judgment_job_one_split
	on doc_judgment_job (activity_id) where kind = 'email_split';

-- One split per email, whichever mailbox captured it first.
create or replace function queue_email_split(email_id uuid) returns void
language sql security definer as $$
	insert into doc_judgment_job (owner_user_id, activity_id, idempotency_key, kind)
	select m.user_id, e.activity_id, md5('email_split:' || e.activity_id)::uuid, 'email_split'
	from email e join email_mailbox m using (activity_id)
	join app_user u on u.id = m.user_id
	where current_setting('engine.job', true) = 'mail_capture'
		and m.user_id = nullif(current_setting('engine.user_id', true), '')::uuid
		and u.is_account_partner and e.activity_id = email_id and e.authored is null
		and not exists (select from doc_judgment_job j where j.activity_id = e.activity_id and j.kind = 'email_split')
		and not exists (select from lead_email_source s where s.activity_id = e.activity_id)
		and not exists (
			select from lead_source_sender s
			where lower(s.address) = e.sender or s.domain = split_part(e.sender, '@', 2)
		)
	on conflict do nothing;
$$;

do $$ begin
	execute format('alter function queue_email_split set search_path = pg_catalog, %I, pg_temp', current_schema());
end $$;
revoke execute on function queue_email_split from public;
grant execute on function queue_email_split to engine;

commit;

-- Read back the kind check, the one-split index and the enqueue function. Expect the three kinds,
-- one partial unique index on activity_id, one security-definer function with the fixed search path,
-- engine execute, and no reader or public execute.
-- select pg_get_constraintdef(oid) from pg_constraint
-- where conrelid = 'next.doc_judgment_job'::regclass and conname = 'doc_judgment_job_kind_check';
-- select indexdef from pg_indexes
-- where schemaname = 'next' and indexname = 'doc_judgment_job_one_split';
-- select p.prosecdef, p.proconfig,
--   has_function_privilege('engine', p.oid, 'execute') as engine_execute,
--   has_function_privilege('engine_reader', p.oid, 'execute') as reader_execute,
--   exists (select from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
--     where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute
-- from pg_proc p where p.oid = 'next.queue_email_split(uuid)'::regprocedure;
