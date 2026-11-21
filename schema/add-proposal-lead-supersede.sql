begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table proposal add column if not exists superseded_reason text;

do $$
begin
	if not exists (
		select from pg_constraint where conrelid = 'proposal'::regclass
		and conname = 'proposal_superseded_reason'
	) then
		alter table proposal
			drop constraint proposal_status_check,
			drop constraint proposal_decision_whole,
			add constraint proposal_status_check check (status in ('pending', 'accepted', 'dismissed', 'superseded')),
			add constraint proposal_decision_whole check (
				(status = 'pending' and decided_by_user_id is null and decided_at is null)
				or (status in ('accepted', 'dismissed') and decided_by_user_id is not null and decided_at is not null)
				or (status = 'superseded' and decided_by_user_id is null and decided_at is not null)),
			add constraint proposal_superseded_reason check (
				superseded_reason is not distinct from case when status = 'superseded' then 'Moved to Leads' end);
	end if;
end $$;

create or replace trigger decide_proposal before insert or update of status, filed_deal_id, filing_reason, dismiss_reason on proposal
	for each row when (new.status <> 'superseded') execute function decide_proposal();

create or replace function supersede_lead_filing() returns trigger
language plpgsql as $$
begin
	if tg_op <> 'UPDATE' or old.status <> 'pending'
		or new.kind not in ('file_to_deal', 'possible_new_deal')
		or current_setting('engine.job', true) is distinct from 'mail_capture'
		or not exists (select from lead_email_source where activity_id = new.activity_id) then
		raise exception 'mail capture supersedes only a pending filing for an email moved to Leads'
			using errcode = 'check_violation', constraint = 'proposal_lead_supersede';
	end if;
	new.decided_at := clock_timestamp();
	new.superseded_reason := 'Moved to Leads';
	return new;
end $$;

create or replace trigger supersede_lead_filing before insert or update of status, filed_deal_id, filing_reason, dismiss_reason on proposal
	for each row when (new.status = 'superseded') execute function supersede_lead_filing();

create or replace function lead_email_attention_change() returns trigger
language plpgsql as $$
begin
	if tg_op = 'INSERT' then
		if current_setting('engine.job', true) is distinct from 'mail_capture'
			or new.acknowledged_by_user_id is not null or new.acknowledged_at is not null
			or not exists (
				select from party_role r join party p on p.id = r.party_id
				join lead_email_source s on s.party_id = r.party_id
				where r.party_id = new.party_id and r.role = 'lead' and r.created_at = now()
					and r.stage = 'new' and r.owner_user_id is null and p.how_found = 'inbound'
					and s.activity_id = new.activity_id
					and s.mailbox_user_id = nullif(current_setting('engine.user_id', true), '')::uuid
			) then
			raise exception 'only a new unclaimed inbound lead starts with email attention'
				using errcode = 'check_violation', constraint = 'lead_email_attention_starts_at_intake';
		end if;
	elsif (new.acknowledged_by_user_id, new.acknowledged_at)
		is distinct from (old.acknowledged_by_user_id, old.acknowledged_at) then
		if old.acknowledged_by_user_id is not null or new.acknowledged_by_user_id is null
			or nullif(current_setting('engine.job', true), '') is not null
			or new.acknowledged_by_user_id is distinct from nullif(current_setting('engine.user_id', true), '')::uuid then
			raise exception 'a partner acknowledges email attention once'
				using errcode = 'check_violation', constraint = 'lead_email_attention_acknowledged_once';
		end if;
	end if;
	return new;
end $$;

commit;
