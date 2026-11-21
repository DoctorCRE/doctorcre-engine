-- Apply after the Doc judgment queue and lead-source sender storage exist.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create or replace function queue_email_summary(email_id uuid) returns void
language sql security definer as $$
	insert into doc_judgment_job (owner_user_id, activity_id, idempotency_key, kind)
	select m.user_id, e.activity_id, e.activity_id, 'email_summary'
	from email e join email_mailbox m using (activity_id)
	join app_user u on u.id = m.user_id
	where current_setting('engine.job', true) = 'mail_capture'
		and m.user_id = nullif(current_setting('engine.user_id', true), '')::uuid
		and u.is_account_partner and e.activity_id = email_id
		and not exists (select from email_current_summary s where s.activity_id = e.activity_id)
		and not exists (select from lead_email_source s where s.activity_id = e.activity_id)
		and not exists (
			select from lead_source_sender s
			where lower(s.address) = e.sender or s.domain = split_part(e.sender, '@', 2)
		)
	on conflict (owner_user_id, idempotency_key) do nothing;
$$;

do $$ begin
	execute format('alter function queue_email_summary set search_path = pg_catalog, %I, pg_temp', current_schema());
end $$;
revoke execute on function queue_email_summary from public;
grant execute on function queue_email_summary to engine;

commit;
