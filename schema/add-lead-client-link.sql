-- Install on an existing next schema before deploying Leads saves (#877).
begin;
set local search_path = next, pg_temp;

alter table party_role add column if not exists lead_client_id uuid;

do $delta$
begin
	if not exists (select from pg_constraint
		where conrelid = 'party_role'::regclass and conname = 'lead_client_link_client') then
		alter table party_role add constraint lead_client_link_client
			foreign key (lead_client_id) references client (party_id) on update cascade;
	end if;
	if not exists (select from pg_constraint
		where conrelid = 'party_role'::regclass and conname = 'lead_client_link_distinct') then
		alter table party_role add constraint lead_client_link_distinct check (
			lead_client_id is null or (role = 'lead' and lead_client_id <> party_id));
	end if;

	if to_regprocedure('confirm_lead_client_link()') is null then
		create function confirm_lead_client_link() returns trigger
		language plpgsql as $link$
declare
	survivor uuid;
begin
	if tg_op = 'DELETE' and old.lead_client_id is null then return old; end if;
	if tg_op <> 'DELETE' and new.lead_client_id is null and old.lead_client_id is null then return new; end if;
	select survivor_id into survivor from merged_party
	where id = nullif(current_setting('engine.merge', true), '')::uuid and created_at = now();
	if tg_op = 'DELETE' then
		update party_role set lead_client_id = old.lead_client_id
		where party_id = survivor and role = 'lead' and lead_client_id is null
			and old.role = 'lead' and old.lead_client_id <> survivor;
		return old;
	end if;
	if survivor is not null then
		if new.lead_client_id = new.party_id then new.lead_client_id := null; end if;
		return new;
	end if;
	if new.lead_client_id is not distinct from old.lead_client_id then return new; end if;
	if tg_op <> 'UPDATE' or old.lead_client_id is not null
		or new.changed_by_job is not null or not exists (
			select from app_user where id = new.changed_by_user_id and is_account_partner) then
		raise exception 'a partner can confirm an unlinked lead once'
			using errcode = 'check_violation', constraint = 'lead_client_link_confirmation';
	end if;
	return new;
end $link$;
	end if;
	if not exists (select from pg_trigger
		where tgrelid = 'party_role'::regclass and tgname = 'validate_lead_client_link') then
		-- This runs after stamp_change, so it can check the database-written actor.
		create trigger validate_lead_client_link before insert or update of lead_client_id, party_id or delete on party_role
			for each row execute function confirm_lead_client_link();
	end if;
	if not has_column_privilege('engine', 'party_role', 'lead_client_id', 'UPDATE') then
		grant update (lead_client_id) on party_role to engine;
	end if;
end $delta$;
commit;
