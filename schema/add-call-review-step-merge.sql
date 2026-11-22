begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table proposal add column if not exists merged_step_id uuid;

do $$
begin
	if not exists (
		select from pg_constraint where conrelid = 'proposal'::regclass and conname = 'proposal_merged_step'
	) then
		alter table proposal add constraint proposal_merged_step foreign key (merged_step_id) references next_step;
	end if;
	if not exists (
		select from pg_constraint where conrelid = 'proposal'::regclass and conname = 'proposal_merged_step_decided'
	) then
		alter table proposal add constraint proposal_merged_step_decided check (merged_step_id is null or
			(kind = 'next_step' and status = 'accepted'));
	end if;
end $$;

create or replace function decide_proposal() returns trigger
language plpgsql as $$
declare
	acting_job text := nullif(current_setting('engine.job', true), '');
	acting_user uuid := nullif(current_setting('engine.user_id', true), '');
	current_phase text;
	phase_started_at timestamptz;
	move_at timestamptz;
	today date;
	sender_name text;
	sender_address email_address;
	lead_party_id uuid;
	held_step next_step%rowtype;
begin
	if tg_op = 'INSERT' then
		if new.status <> 'pending' or new.decided_by_user_id is not null or new.decided_at is not null
			or acting_job is distinct from new.proposed_by_job then
			raise exception 'a job creates a pending proposal' using errcode = 'check_violation', constraint = 'proposal_starts_pending';
		end if;
		if new.kind = 'email_lead' and (acting_job <> 'mail_capture' or acting_user is null or not exists (
			select from candidate where id = new.candidate_id and source = 'outlook-intake' and status = 'unreviewed'
			and changed_for_user_id = acting_user and source_row->>'address' is not null
		)) then
			raise exception 'mail capture proposes an unreviewed candidate for its mailbox owner'
				using errcode = 'check_violation', constraint = 'email_lead_proposal_source';
		end if;
		if new.kind = 'next_step_done' then
			perform from deal where id = new.deal_id for no key update;
			select * into held_step from next_step where id = new.next_step_id and deal_id = new.deal_id for no key update;
			new.step_seen_at := held_step.changed_at;
			if not exists (select from proposal where kind = new.kind and activity_id = new.activity_id
					and deal_id = new.deal_id and next_step_id = new.next_step_id)
				and (acting_user is null or held_step.owner_party_id is distinct from acting_user
					or held_step.status <> 'open' or held_step.item_title is not null
					or held_step.due_on is null or held_step.due_on >= (select
						(happened_at at time zone 'America/Chicago')::date from activity where id = new.activity_id)) then
				raise exception 'a hold names the sponsoring partner''s overdue open step'
					using errcode = 'check_violation', constraint = 'proposal_step_overdue';
			end if;
		end if;
		return new;
	end if;
	if old.status <> 'pending' or new.status not in ('accepted', 'dismissed') then
		raise exception 'a pending proposal is decided once' using errcode = 'check_violation', constraint = 'proposal_final';
	end if;
	if acting_job is not null or acting_user is null then
		raise exception 'only a direct user decides a proposal' using errcode = 'check_violation', constraint = 'proposal_user_decides';
	end if;
	new.decided_by_user_id := acting_user;
	new.decided_at := clock_timestamp();
	if new.kind = 'next_step_done' then
		perform from deal where id = new.deal_id for update;
		perform from next_step where deal_id = new.deal_id and (status = 'open' or id = new.next_step_id)
			order by id for no key update;
		select * into held_step from next_step where id = new.next_step_id;
		if held_step.owner_party_id is distinct from acting_user then
			raise exception 'the step owner decides the hold'
				using errcode = 'check_violation', constraint = 'proposal_step_owner_decides';
		end if;
		if new.status = 'dismissed' then return new; end if;
		if held_step.status <> 'open' or held_step.changed_at is distinct from new.step_seen_at then
			raise exception 'the held step has changed'
				using errcode = 'check_violation', constraint = 'proposal_step_changed';
		end if;
		new.keeps_deal_date := new.activity_kind in ('call', 'meeting') and new.next_step_id = (
			select id from next_step where deal_id = new.deal_id and status = 'open' and item_title is null
			order by created_at desc, id desc limit 1);
		update next_step set resolution = 'done', done_at = new.decided_at where id = new.next_step_id;
		return new;
	end if;
	if new.kind = 'email_lead' then
		if acting_user is distinct from old.changed_for_user_id then
			raise exception 'the mailbox owner decides the email lead'
				using errcode = 'check_violation', constraint = 'email_lead_owner_decides';
		end if;
		select name, source_row->>'address' into sender_name, sender_address from candidate
			where id = new.candidate_id and status = 'unreviewed' for update;
		if not found then
			raise exception 'the email lead candidate is already reviewed'
				using errcode = 'check_violation', constraint = 'email_lead_candidate_pending';
		end if;
		if new.status = 'dismissed' then
			update candidate set status = 'declined', reason = coalesce(new.dismiss_reason, 'Dismissed by mailbox owner')
			where id = new.candidate_id;
		else
			perform pg_advisory_xact_lock(hashtextextended(sender_address, 0));
			if exists (select from party_email where address = sender_address) then
				raise exception 'a contact already has the sender address'
					using errcode = 'check_violation', constraint = 'email_lead_sender_known';
			end if;
			insert into party (kind, name, how_found) values ('person', sender_name, 'inbound') returning id into lead_party_id;
			insert into party_email (party_id, address, label, is_primary) values (lead_party_id, sender_address, 'work', true);
			insert into party_role (party_id, role, stage, owner_user_id) values (lead_party_id, 'lead', 'new', acting_user);
			update candidate set status = 'promoted', promoted_party_id = lead_party_id where id = new.candidate_id;
		end if;
		return new;
	end if;
	if new.status = 'dismissed' then return new; end if;
	case new.kind
	when 'log_call' then
		insert into activity (id, kind, happened_at, summary)
		select new.id, 'note', happened_at, new.what from activity where id = new.activity_id;
		insert into activity_about (activity_id, deal_id, party_id)
		values (new.id, new.deal_id, new.party_id);
	when 'next_step' then
		new.merged_step_id := nullif(current_setting('engine.proposal_merged_step', true), '')::uuid;
		if new.merged_step_id is not null then return new; end if;
		-- The decision can override the step owner without changing the suggestion.
		insert into next_step (id, what, owner_party_id, due_on, deal_id, party_id, property_id,
			call_activity_id, call_evidence_quote)
		values (new.id, new.what, coalesce(nullif(current_setting('engine.proposal_step_owner', true), '')::uuid, new.owner_party_id),
			new.due_on, new.deal_id, new.party_id, new.property_id,
			case when new.activity_kind = 'call' and new.deal_id is not null then new.activity_id end,
			case when new.activity_kind = 'call' and new.deal_id is not null then new.evidence end);
	when 'phase_move' then
		-- Two acceptances cannot both pass the stale-phase check.
		perform from deal where id = new.deal_id for update;
		select phase, happened_at into current_phase, phase_started_at
			from deal_phase_change where deal_id = new.deal_id order by happened_at desc limit 1;
		if current_phase is distinct from new.from_phase then
			raise exception 'the deal has moved' using errcode = 'check_violation', constraint = 'proposal_current_phase';
		end if;
		move_at := new.decided_at;
		if new.phase_on is not null then
			today := (move_at at time zone 'America/Chicago')::date;
			if new.phase_on > today or new.phase_on < (phase_started_at at time zone 'America/Chicago')::date then
				raise exception 'phase date falls outside the current phase'
					using errcode = 'check_violation', constraint = 'proposal_phase_date';
			end if;
			move_at := greatest(phase_started_at + interval '1 microsecond',
				case when new.phase_on = today then move_at
					else new.phase_on::timestamp at time zone 'America/Chicago' end);
		end if;
		insert into deal_phase_change (deal_id, happened_at, phase, reason)
		values (new.deal_id, move_at, new.to_phase, new.reason);
	when 'file_to_deal', 'possible_new_deal' then
		new.filed_deal_id := coalesce(new.filed_deal_id, new.deal_id);
		perform from deal where id = new.filed_deal_id for update;
		select phase into current_phase from deal_phase_change where deal_id = new.filed_deal_id order by happened_at desc limit 1;
		if new.filed_deal_id is null or current_phase in ('closed', 'dead') then
			raise exception 'filing needs an open deal' using errcode = 'check_violation', constraint = 'proposal_filing_open_deal';
		end if;
		if new.filing_reason is null and deal_filing_reason(new.activity_id, new.filed_deal_id) is not null then
			raise exception 'a corrected filing needs a reason' using errcode = 'check_violation', constraint = 'proposal_filing_reason';
		end if;
		delete from activity_about where activity_id = new.activity_id and deal_id <> new.filed_deal_id;
		insert into activity_about (activity_id, deal_id) values (new.activity_id, new.filed_deal_id) on conflict do nothing;
	when 'new_lead' then
		update party set how_found = new.how_found, how_found_detail = null where id = new.party_id
			and (how_found is null or (how_found = 'not_recorded' and new.how_found <> 'not_recorded'));
		insert into party_role (party_id, role, stage) values (new.party_id, 'lead', new.to_stage);
	when 'lead_stage_move' then
		insert into lead_stage_move (id, party_id, from_stage, to_stage, activity_id, evidence_ref, strength, reason)
		values (new.id, new.party_id, new.from_stage, new.to_stage, new.activity_id, new.evidence, new.strength, new.reason);
	end case;
	return new;
end $$;

commit;
