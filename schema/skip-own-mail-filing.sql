begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create or replace function queue_email_filing(email_id uuid) returns void
language sql security definer as $$
	with source as (
		select e.*, m.user_id from email e join email_mailbox m using (activity_id)
		where e.activity_id = email_id and current_setting('engine.job', true) = 'mail_capture'
			and m.user_id = nullif(current_setting('engine.user_id', true), '')::uuid
			and exists (select from app_user u where u.id = m.user_id and u.is_account_partner)
			and not exists (select from party_email pe where (pe.party_id, pe.address) = (m.user_id, e.sender))
			and not exists (select from lead_email_source l where l.activity_id = e.activity_id)
			and not exists (select from lead_source_sender l
				where lower(l.address) = e.sender or l.domain = split_part(e.sender, '@', 2))
			and not exists (select from proposal p where p.activity_id = email_id
				and p.kind in ('file_to_deal', 'possible_new_deal') and p.status in ('accepted', 'dismissed'))
	), candidates(deal_id, vendor_id) as (
		select distinct a.deal_id, null::uuid from source s
		join email t on t.activity_id = s.activity_id or t.conversation_id = s.conversation_id
		join activity_about a on a.activity_id = t.activity_id
		where a.deal_id is not null and coalesce((select phase from deal_phase_change
			where deal_id = a.deal_id order by happened_at desc limit 1), '') not in ('closed', 'dead')
		union
		select null::uuid, v.party_id from source s cross join mail_sender_vendors(s.activity_id) v(party_id)
	), allowed as (
		select * from candidates c where not exists (
			select from change h where h.table_name = 'activity_about' and h.action = 'delete'
				and h.changed_by_user_id is not null and h.old_value->>'activity_id' = email_id::text
				and (h.old_value->>'deal_id' = c.deal_id::text or h.old_value->>'party_id' = c.vendor_id::text)
		)
	), queued as (
		insert into doc_judgment_job (owner_user_id, activity_id, idempotency_key, kind)
		select user_id, activity_id, md5('email_filing:' || email_id)::uuid, 'email_filing'
		from source where exists (select from allowed)
		on conflict (owner_user_id, idempotency_key) do nothing returning id
	)
	insert into doc_judgment_destination (job_id, position, deal_id, vendor_id)
	select id, row_number() over (order by deal_id nulls last, vendor_id), deal_id, vendor_id
	from queued cross join allowed;
$$;

do $$ begin
	execute format('alter function queue_email_filing set search_path = pg_catalog, %I, pg_temp', current_schema());
end $$;
revoke execute on function queue_email_filing from public;
grant execute on function queue_email_filing to engine;

commit;
