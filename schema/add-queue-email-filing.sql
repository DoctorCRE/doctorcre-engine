-- Apply after the Doc judgment queue and lead-source sender storage exist.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

do $$ begin
	if to_regclass('next.doc_judgment_destination') is null
		or to_regclass('next.lead_source_sender') is null then
		raise exception 'Install the Doc judgment queue and lead-source sender storage first';
	end if;
end $$;

alter table proposal
	add column if not exists filing_scope text constraint proposal_filing_scope check (filing_scope is null or (
		kind = 'possible_new_deal' and proposed_by_job = 'mail_capture' and filing_scope in ('deal', 'vendor', 'both')
		and (filing_scope <> 'vendor' or filed_deal_id is null))),
	add column if not exists filed_vendor_id uuid references party constraint proposal_filed_vendor check (filed_vendor_id is null or (
		status = 'accepted' and filed_deal_id is null and (filing_scope in ('vendor', 'both')) is true));

grant update (filed_vendor_id) on proposal to engine;

create or replace trigger decide_proposal before insert or update of status, filed_deal_id, filed_vendor_id, filing_reason, dismiss_reason on proposal
	for each row when (new.status <> 'superseded' and new.filed_vendor_id is null) execute function decide_proposal();

create or replace function decide_vendor_filing() returns trigger
language plpgsql as $$
declare
	acting_user uuid := nullif(current_setting('engine.user_id', true), '');
begin
	if tg_op = 'UPDATE' and old.status = 'accepted'
		and (new.status, new.filing_reason, new.dismiss_reason, new.filed_deal_id)
			is not distinct from (old.status, old.filing_reason, old.dismiss_reason, old.filed_deal_id)
		and exists (select from merged_party where id = old.filed_vendor_id and survivor_id = new.filed_vendor_id
			and id = nullif(current_setting('engine.merge', true), '')::uuid and created_at = now()) then
		return new;
	end if;
	if tg_op <> 'UPDATE' or old.status <> 'pending' or new.status <> 'accepted' then
		raise exception 'a pending proposal is decided once' using errcode = 'check_violation', constraint = 'proposal_final';
	end if;
	if nullif(current_setting('engine.job', true), '') is not null or acting_user is null then
		raise exception 'only a direct user decides a proposal' using errcode = 'check_violation', constraint = 'proposal_user_decides';
	end if;
	perform from party_role where party_id = new.filed_vendor_id and role = 'vendor' for share;
	if not found then
		raise exception 'filing needs a vendor' using errcode = 'check_violation', constraint = 'proposal_filing_vendor';
	end if;
	new.decided_by_user_id := acting_user;
	new.decided_at := clock_timestamp();
	insert into activity_about (activity_id, party_id) values (new.activity_id, new.filed_vendor_id) on conflict do nothing;
	return new;
end $$;

create or replace trigger decide_vendor_filing before insert or update of status, filed_deal_id, filed_vendor_id, filing_reason, dismiss_reason on proposal
	for each row when (new.filed_vendor_id is not null) execute function decide_vendor_filing();

create or replace function mail_sender_vendors(email_id uuid) returns setof uuid
language sql stable as $$
	with senders as (
		select p.party_id, (a.happened_at at time zone 'America/Chicago')::date as sent_on
		from email e join activity a on a.id = e.activity_id
		join party_email p on p.address = e.sender where e.activity_id = email_id
		limit 2
	)
	select v.party_id from senders p join party_role v on v.role = 'vendor'
	where (select count(*) from senders) = 1 and not exists (select from app_user where id = p.party_id)
		and (v.party_id = p.party_id or exists (select from party_company c
			where c.person_id = p.party_id and c.company_id = v.party_id
				and (c.started_on is null or c.started_on <= p.sent_on)
				and (c.ended_on is null or c.ended_on >= p.sent_on)));
$$;

revoke execute on function mail_sender_vendors from public;
grant execute on function mail_sender_vendors to engine;

create or replace function queue_email_filing(email_id uuid) returns void
language sql security definer as $$
	with source as (
		select e.*, m.user_id from email e join email_mailbox m using (activity_id)
		where e.activity_id = email_id and current_setting('engine.job', true) = 'mail_capture'
			and m.user_id = nullif(current_setting('engine.user_id', true), '')::uuid
			and exists (select from app_user u where u.id = m.user_id and u.is_account_partner)
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
	execute format('alter function mail_sender_vendors set search_path = pg_catalog, %I, pg_temp', current_schema());
	execute format('alter function queue_email_filing set search_path = pg_catalog, %I, pg_temp', current_schema());
end $$;
revoke execute on function queue_email_filing from public;
grant execute on function queue_email_filing to engine;

commit;

-- select to_regprocedure('next.queue_email_filing(uuid)'),
--     has_function_privilege('engine', 'next.queue_email_filing(uuid)', 'EXECUTE');
