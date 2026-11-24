-- Install on an existing next schema before deploying the party link saves (#1245). Safe to apply twice.
-- A pair keeps one current link of each kind, and may link again once a link ends, dated or not.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table party_link drop constraint if exists party_link_party_id_other_party_id_kind_started_on_key;
drop index if exists party_link_knows_once;
create unique index party_link_knows_once on party_link
	(least(party_id, other_party_id), greatest(party_id, other_party_id)) where kind = 'knows' and ended_on is null;
drop index if exists party_link_can_introduce_once;
create unique index party_link_can_introduce_once on party_link
	(party_id, other_party_id) where kind = 'can_introduce' and ended_on is null;

-- A merge now collapses two current links into the survivor's.
create or replace function merge_party(duplicate uuid, survivor uuid) returns void
language plpgsql security definer as $$
declare
	pointer record;
	duplicate_npi text;
	duplicate_how_found text;
	duplicate_how_found_detail text;
	duplicate_source_wins boolean;
begin
	-- Held, so until this merge ends nothing new points at either record and another merge of either waits.
	perform from party where id in (duplicate, survivor) for update;
	if (select count(*) <> 2 or count(distinct kind) <> 1 from party where id in (duplicate, survivor)) then
		raise exception 'a merge joins two different records of one kind, neither merged away'
			using errcode = 'check_violation', constraint = 'merge_party_two_of_a_kind';
	end if;
	if exists (select from app_user where id = duplicate) then
		raise exception 'a user is never merged away, because their changes name them'
			using errcode = 'check_violation', constraint = 'merge_party_keeps_users';
	end if;
	if (select count(npi) = 2 from party where id in (duplicate, survivor)) then
		raise exception 'two NPIs are two people or organizations, so they are not merged'
			using errcode = 'check_violation', constraint = 'merge_party_one_npi';
	end if;
	-- First, so change history tells every move below as this merge's.
	perform set_config('engine.merge', duplicate::text, true);
	insert into merged_party (id, survivor_id) values (duplicate, survivor);

	-- Conflicting client or account profiles need a user to settle their dated history first.
	if exists (select from client d join client s on s.party_id = survivor where d.party_id = duplicate)
		or exists (select from national_account d join national_account s on s.party_id = survivor where d.party_id = duplicate) then
		raise exception 'settle both client or national account profiles before merging'
			using errcode = 'check_violation', constraint = 'merge_party_client_profiles';
	end if;
	if exists (select from client_vertical d join client_vertical s on s.party_id = survivor
		where d.party_id = duplicate and (d.vertical <> s.vertical or d.subtype <> s.subtype)) then
		raise exception 'settle the different client practice types or subtypes before merging'
			using errcode = 'check_violation', constraint = 'merge_party_client_verticals';
	end if;

	update client set party_id = survivor where party_id = duplicate
		and exists (select from party_role where party_id = survivor and role = 'client');
	update national_account set party_id = survivor where party_id = duplicate
		and exists (select from party_role where party_id = survivor and role = 'national_account');

	delete from proposal d using proposal s
	where d.party_id = duplicate and s.party_id = survivor
		and (s.activity_id, s.kind, s.deal_id, s.property_id, s.from_phase, s.to_phase, s.from_stage, s.to_stage,
			s.what, s.owner_party_id, s.due_on, s.how_found) is not distinct from
			(d.activity_id, d.kind, d.deal_id, d.property_id, d.from_phase, d.to_phase, d.from_stage, d.to_stage,
			d.what, d.owner_party_id, d.due_on, d.how_found);
	delete from lead_stage_move d using lead_stage_move s
	where d.party_id = duplicate and s.party_id = survivor and s.from_stage = d.from_stage
		and s.to_stage = d.to_stage and s.activity_id = d.activity_id;
	-- A link between the two says nothing once they are one. Of two current links, or two from one start date,
	-- that become one, the survivor's stays.
	delete from party_link where duplicate in (party_id, other_party_id) and survivor in (party_id, other_party_id);
	delete from party_link d using party_link s
	where duplicate in (d.party_id, d.other_party_id) and survivor in (s.party_id, s.other_party_id)
		and s.kind = d.kind
		and (s.started_on is not distinct from d.started_on or s.ended_on is null and d.ended_on is null)
		and case d.party_id when duplicate then d.other_party_id else d.party_id end
			= case s.party_id when survivor then s.other_party_id else s.party_id end
		and (d.kind = 'knows' or (d.party_id = duplicate) = (s.party_id = survivor));

	delete from lead_contact_draft where party_id = duplicate
		and exists (select from lead_contact_draft where party_id = survivor);

	-- Moved first, because the duplicate's vendor role is removed next when the survivor holds one.
	update introduction set vendor_id = survivor
	where vendor_id = duplicate and exists (select from party_role where party_id = survivor and role = vendor_role);
	update space_need set vendor_id = survivor
	where vendor_id = duplicate and exists (select from party_role where party_id = survivor and role = vendor_role);
	-- Where both hold the same link, the survivor's row stays, and so does its primary email and phone.
	-- Its stage, level and owner stay too, and the duplicate's fill any it lacks. A target on either holds.
	-- The stricter ruling stays with its reason, so a merge never puts an avoided vendor back in play.
	update party_role s set stage = coalesce(s.stage, d.stage),
		relationship_level = coalesce(s.relationship_level, d.relationship_level),
		offers = coalesce(s.offers, d.offers), seeking = coalesce(s.seeking, d.seeking),
		relationship_origin = coalesce(s.relationship_origin, d.relationship_origin),
		rivalry_note = coalesce(s.rivalry_note, d.rivalry_note),
		refers_business = coalesce(s.refers_business, d.refers_business),
		(disposition, disposition_reason) = (
			select ruling, reason
			from (values (s.disposition, s.disposition_reason, 1), (d.disposition, d.disposition_reason, 2)) r (ruling, reason, side)
			order by array_position(array['parked', 'avoid'], ruling) desc nulls last, side limit 1),
		is_target = (s.is_target or d.is_target) and coalesce(s.disposition, '') <> 'avoid'
			and coalesce(d.disposition, '') <> 'avoid',
		owner_user_id = coalesce(s.owner_user_id, d.owner_user_id),
		needs_attention = s.needs_attention or d.needs_attention,
		lane = coalesce(s.lane, d.lane), segment = coalesce(s.segment, d.segment),
		lease_estimate_source = case when s.estimated_lease_on is null then d.lease_estimate_source else s.lease_estimate_source end,
		lease_estimate_confidence = case when s.estimated_lease_on is null then d.lease_estimate_confidence else s.lease_estimate_confidence end,
		estimated_lease_on = coalesce(s.estimated_lease_on, d.estimated_lease_on)
	from party_role d where s.party_id = survivor and d.party_id = duplicate and d.role = s.role;
	update client_vertical s set subtype = d.subtype from client_vertical d
	where s.party_id = survivor and d.party_id = duplicate and s.subtype is null and d.subtype is not null;
	delete from client_vertical d using client_vertical s
	where d.party_id = duplicate and s.party_id = survivor;
	update client_vertical set party_id = survivor where party_id = duplicate
		and exists (select from party_role where party_id = survivor and role = 'client');
	update client_research set party_id = survivor where party_id = duplicate
		and exists (select from party_role where party_id = survivor and role = 'client');
	delete from vendor_vertical d using vendor_vertical s
	where d.party_id = duplicate and s.party_id = survivor and d.vertical = s.vertical;
	update vendor_vertical set party_id = survivor where party_id = duplicate
		and exists (select from party_role where party_id = survivor and role = 'vendor');
	delete from vendor_loan_program d using vendor_loan_program s
	where d.party_id = duplicate and s.party_id = survivor and d.loan_program = s.loan_program;
	update vendor_loan_program set party_id = survivor where party_id = duplicate
		and exists (select from party_role where party_id = survivor and role = 'vendor');
	delete from party_role d using party_role s
	where d.party_id = duplicate and s.party_id = survivor and s.role = d.role;
	-- A primary on a shared address or number stays primary when the survivor has none.
	update party_email s set is_primary = true from party_email d
	where s.party_id = survivor and d.party_id = duplicate and d.address = s.address and d.is_primary
		and not exists (select from party_email where party_id = survivor and is_primary);
	delete from party_email d using party_email s
	where d.party_id = duplicate and s.party_id = survivor and s.address = d.address;
	update party_email set is_primary = false
	where party_id = duplicate and exists (select from party_email where party_id = survivor and is_primary);
	update party_phone s set is_primary = true from party_phone d
	where s.party_id = survivor and d.party_id = duplicate and d.number = s.number
		and d.extension is not distinct from s.extension and d.is_primary
		and not exists (select from party_phone where party_id = survivor and is_primary);
	delete from party_phone d using party_phone s
	where d.party_id = duplicate and s.party_id = survivor and s.number = d.number
		and s.extension is not distinct from d.extension;
	update party_phone set is_primary = false
	where party_id = duplicate and exists (select from party_phone where party_id = survivor and is_primary);
	update do_not_contact s set until_date = d.until_date, reason = d.reason
	from do_not_contact d where s.party_id = survivor and d.party_id = duplicate
		and s.until_date is not null and (d.until_date is null or d.until_date > s.until_date);
	delete from do_not_contact
	where party_id = duplicate and exists (select from do_not_contact where party_id = survivor);
	delete from party_specialty d using party_specialty s
	where d.person_id = duplicate and s.person_id = survivor and s.specialty = d.specialty;
	delete from party_company d using party_company s
	where s.started_on is not distinct from d.started_on and (
		d.person_id = duplicate and s.person_id = survivor and s.company_id = d.company_id
		or d.company_id = duplicate and s.company_id = survivor and s.person_id = d.person_id);
	update offer o set from_party_id = survivor from deal_party s
	where o.from_party_id = duplicate and s.deal_id = o.deal_id and s.party_id = survivor and s.role = o.from_role;
	delete from deal_party d using deal_party s
	where d.party_id = duplicate and s.party_id = survivor and s.deal_id = d.deal_id and s.role = d.role;
	update deal_party set party_id = survivor where party_id = duplicate;
	delete from activity_about d using activity_about s
	where d.party_id = duplicate and s.party_id = survivor and s.activity_id = d.activity_id;
	delete from lead_email_attention where party_id = duplicate
		and exists (select from lead_email_attention where party_id = survivor);
	-- A collapsing membership's review moves to the survivor's, so a merge of two reviewed ones is refused.
	update party_territory_review r set party_territory_id = s.id from party_territory d, party_territory s
	where r.party_territory_id = d.id and d.party_id = duplicate and s.party_id = survivor and s.territory_id = d.territory_id
		and s.started_on is not distinct from d.started_on;
	delete from party_territory d using party_territory s
	where d.party_id = duplicate and s.party_id = survivor and s.territory_id = d.territory_id
		and s.started_on is not distinct from d.started_on;
	delete from building_ownership d using building_ownership s
	where d.party_id = duplicate and s.party_id = survivor and s.property_id = d.property_id
		and s.kind = d.kind and s.started_on is not distinct from d.started_on;
	delete from party_document d using party_document s
	where d.party_id = duplicate and s.party_id = survivor and s.document_id = d.document_id;

	-- Profiles cascade with their roles before their direct party keys move.
	update party_role set party_id = survivor where party_id = duplicate;

	-- Read from the catalog, so a table added later moves too. A unique key the merge would repeat refuses it here.
	for pointer in
		select c.conrelid::regclass as tbl, a.attname as col
		from pg_constraint c
		join pg_attribute target on target.attrelid = c.confrelid and target.attname = 'id'
		join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[array_position(c.confkey, target.attnum)]
		where c.contype = 'f' and c.confrelid = 'party'::regclass
	loop
		execute format('update %s set %I = $1 where %I = $2', pointer.tbl, pointer.col, pointer.col)
		using survivor, duplicate;
	end loop;

	delete from party where id = duplicate returning npi, how_found, how_found_detail into duplicate_npi, duplicate_how_found, duplicate_how_found_detail;
	-- A recorded source beats not recorded, as in the copy.
	select how_found is null or how_found = 'not_recorded' and coalesce(duplicate_how_found, 'not_recorded') <> 'not_recorded'
		into duplicate_source_wins from party where id = survivor;
	update party set npi = coalesce(npi, duplicate_npi),
		how_found_detail = case when duplicate_source_wins then duplicate_how_found_detail
			else coalesce(how_found_detail, case when how_found = duplicate_how_found then duplicate_how_found_detail end) end,
		how_found = case when duplicate_source_wins then duplicate_how_found else how_found end
	where id = survivor;
	perform set_config('engine.merge', '', true);
end $$;
revoke execute on function merge_party(uuid, uuid) from public;
-- Replacing the function clears its pinned search_path.
do $$ begin
	execute format('alter function merge_party set search_path = %I, pg_temp', current_schema());
end $$;

commit;
