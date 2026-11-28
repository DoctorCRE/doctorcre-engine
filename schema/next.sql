-- The new database's core, designed in docs/new-database.md. Nothing applies it to a live database.
-- It names no schema, so a loader chooses the namespace with search_path.

-- The NPI check digit is Luhn's, taken over the 80840 prefix and the first nine digits.
-- ascii(), not a cast, because PostgreSQL may run this before the shape test refuses a non-digit.
create function npi_check_digit_holds(npi text) returns boolean
language sql immutable
return (
	select sum(case when place % 2 = 0 then digit * 2 / 10 + digit * 2 % 10 else digit end) % 10 = 0
	from (select ascii(substr(reverse('80840' || npi), place, 1)) - ascii('0'), place from generate_series(1, 15) place)
		as digits (digit, place)
);

create domain npi as text
	constraint npi_shape check (value ~ '^[0-9]{10}$' and npi_check_digit_holds(value));

create table party (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	kind text not null check (kind in ('person', 'company')),
	name text not null,
	city text check (city ~ '^\S' and city ~ '\S$'),
	-- A person's is their individual NPI and a company's its organization NPI. A number is issued once, to one of them.
	npi npi unique,
	unique (id, kind)
);

-- What a merged-away duplicate leaves behind, so an old link still finds its record. Nothing lists or shows it.
create table merged_party (
	id uuid primary key,
	created_at timestamptz not null default now(),
	survivor_id uuid not null references party
);

create function party_never_merged() returns trigger
language plpgsql as $$
begin
	if exists (select from merged_party where id = new.id) then
		raise exception 'a merged-away record never comes back'
			using errcode = 'check_violation', constraint = 'party_never_merged';
	end if;
	return null;
end $$;

-- A repeated import of an old id would otherwise bring a duplicate back. After, so an insert that waited on a merge sees it.
create trigger party_never_merged after insert on party
	for each row execute function party_never_merged();

-- Some copied names are blank, so the owner's load may store one. A name the engine saves never is.
create function party_name_saved_nonblank() returns trigger
language plpgsql as $$
begin
	if not pg_has_role((select relowner from pg_catalog.pg_class where oid = tg_relid), 'USAGE') then
		raise exception 'a saved name is not blank'
			using errcode = 'check_violation', constraint = 'party_name_saved_nonblank';
	end if;
	return new;
end $$;

create trigger party_name_saved_nonblank before insert or update of name on party
	for each row when (new.name !~ '\S') execute function party_name_saved_nonblank();

-- A person who uses the system, and the home for their own preferences. "user" is reserved in PostgreSQL.
create table app_user (
	id uuid primary key,
	kind text not null generated always as ('person') stored,
	created_at timestamptz not null default now(),
	-- The name the user signs in under, which today's answers show wherever they name a user.
	slug text not null unique check (slug ~ '\S'),
	is_account_partner boolean generated always as (slug in ('joe', 'dell')) stored,
	unique (id, is_account_partner),
	foreign key (id, kind) references party (id, kind)
);

-- The automatic jobs that change rows. A change names a user or a job, so a person's change is told from a job's.
create table job (
	slug text primary key,
	label text not null
);

insert into job values
	('intake', 'Post intake'), ('mail_capture', 'Mail filing'), ('publisher', 'Publisher'), ('readings', 'Post readings'),
	('review_close', 'Review close'), ('lead_stage', 'Lead stages'), ('candidate_sweep', 'Candidate sweeps'), ('agent', 'Agent'), ('old_system', 'Old system');

insert into job values ('nightly_checklist', 'Nightly checklist reminders');
insert into job values ('attention_alerts', 'Deal attention alerts');
insert into job values ('workflow_suggestions', 'Workflow suggestions');

-- The engine names who acts once per transaction: set_config('engine.user_id', <id>, true) for a user, and
-- set_config('engine.job', <slug>, true) for a job, with engine.user_id then the user it works for, if any.
create function stamp_change() returns trigger
language plpgsql as $$
declare
	acting_job text := nullif(current_setting('engine.job', true), '');
	acting_user uuid := nullif(current_setting('engine.user_id', true), '');
	generated text[];
begin
	-- Kept, so a no-op update cannot restamp a final post. NEW holds no generated column's value yet.
	if tg_op = 'UPDATE' then
		generated := array(select attname from pg_attribute where attrelid = tg_relid and attgenerated = 's');
		if to_jsonb(new) - generated = to_jsonb(old) - generated then
			return new;
		end if;
	end if;
	if acting_job is null and acting_user is null then
		raise exception 'a change names the user or the job that made it'
			using errcode = 'not_null_violation', constraint = 'change_names_who_made_it';
	end if;
	-- A conversion changes the mark's target. History stamps the move itself.
	if tg_table_name = 'weekly_review' and tg_op = 'UPDATE' then
		new.changed_by_user_id := old.changed_by_user_id;
		new.changed_by_job := old.changed_by_job;
		new.changed_for_user_id := old.changed_for_user_id;
		new.changed_at := old.changed_at;
		return new;
	end if;
	new.changed_by_user_id := case when acting_job is null then acting_user end;
	new.changed_by_job := acting_job;
	new.changed_for_user_id := case when acting_job is not null then acting_user end;
	new.changed_at := now();
	return new;
end $$;

create table role (
	slug text primary key,
	label text not null,
	-- A vendor's category, such as lender, is a role of its own whose category_of is vendor.
	category_of text check (category_of = 'vendor')
);

-- A role's stages, such as a vendor's. Like roles, a label can be renamed.
create table stage (
	role text not null references role,
	slug text not null,
	label text not null,
	primary key (role, slug)
);

-- How well the team knows a vendor. Only a schema change adds or renames a level.
create table relationship_level (
	level smallint primary key,
	label text not null,
	meaning text not null
);

insert into relationship_level values
	(0, 'Prospective', 'Worth knowing. No two-way contact yet.'),
	(1, 'Building', 'Two-way contact: they replied, or we met. Reaching out alone does not count.'),
	(2, 'Established', 'Value has moved in either direction: an introduction, a referral or a deal.'),
	(3, 'Core', 'Value has moved both ways, more than once.');

create table party_role (
	party_id uuid not null references party,
	role text not null references role,
	created_at timestamptz not null default now(),
	stage text,
	-- None is not yet judged, which is not 0.
	relationship_level smallint references relationship_level,
	-- The team's ruling on a vendor. None is active.
	disposition text check (disposition in ('parked', 'avoid')),
	disposition_reason text check (disposition_reason ~ '\S'),
	-- We want to meet this one.
	is_target boolean not null default false,
	offers text check (offers ~ '\S'),
	seeking text check (seeking ~ '\S'),
	relationship_origin text,
	rivalry_note text,
	refers_business boolean,
	primary key (party_id, role),
	foreign key (role, stage) references stage,
	constraint party_role_level_on_vendor check (relationship_level is null or role = 'vendor'),
	constraint party_role_disposition_on_vendor check (disposition is null or role = 'vendor'),
	constraint party_role_ruling_has_a_reason check ((disposition is null) = (disposition_reason is null)),
	constraint party_role_target_on_vendor check (not is_target or role = 'vendor'),
	constraint party_role_avoid_not_target check (not is_target or disposition is distinct from 'avoid'),
	constraint party_role_relationship_notes_on_vendor check (role = 'vendor' or num_nonnulls(relationship_origin, rivalry_note, refers_business) = 0),
	constraint party_role_capabilities_on_vendor check (role = 'vendor' or num_nonnulls(offers, seeking) = 0)
);

create table client_vertical (
	party_id uuid primary key,
	role text not null default 'client' check (role = 'client'),
	vertical text not null check (vertical = regexp_replace(vertical, '^\s+|\s+$', '', 'g') and vertical ~ '\S'),
	subtype text check (subtype = regexp_replace(subtype, '^\s+|\s+$', '', 'g') and subtype ~ '\S'),
	created_at timestamptz not null default now(),
	foreign key (party_id, role) references party_role on update cascade
);

create table client_research (
	id uuid primary key default gen_random_uuid(),
	party_id uuid not null,
	role text not null default 'client' check (role = 'client'),
	kind text not null check (kind ~ '\S'),
	source text not null check (source ~ '\S'),
	found boolean not null,
	observed_at timestamptz not null check (isfinite(observed_at)),
	expires_on date check (isfinite(expires_on)),
	foreign key (party_id, role) references party_role on update cascade
);
create index client_research_party on client_research (party_id);

create table client_research_fact (
	research_id uuid references client_research,
	field text check (field ~ '\S' and field <> 'found'),
	value jsonb not null,
	primary key (research_id, field)
);

-- The copy and merge run as owner. A new ruling through the engine needs a real reason.
create function vendor_reason_not_recorded_only_imported() returns trigger
language plpgsql as $$
begin
	if not pg_has_role((select relowner from pg_catalog.pg_class where oid = tg_relid), 'USAGE') then
		raise exception 'a new vendor ruling needs a recorded reason'
			using errcode = 'check_violation', constraint = 'vendor_reason_not_recorded_only_imported';
	end if;
	return new;
end $$;

create trigger vendor_reason_not_recorded_only_imported before insert or update of disposition, disposition_reason on party_role
	for each row when (lower(regexp_replace(new.disposition_reason, '^\s+|\s+$', '', 'g')) = 'not recorded, set before the new system')
	execute function vendor_reason_not_recorded_only_imported();

create table vendor_vertical (
	party_id uuid not null,
	role text not null default 'vendor' check (role = 'vendor'),
	vertical text not null check (vertical = regexp_replace(vertical, '^\s+|\s+$', '', 'g') and vertical ~ '\S'),
	created_at timestamptz not null default now(),
	primary key (party_id, vertical),
	foreign key (party_id, role) references party_role on update cascade
);

create table vendor_loan_program (
	party_id uuid not null,
	role text not null default 'vendor' check (role = 'vendor'),
	loan_program text not null check (loan_program = regexp_replace(loan_program, '^\s+|\s+$', '', 'g') and loan_program ~ '\S'),
	created_at timestamptz not null default now(),
	primary key (party_id, loan_program),
	foreign key (party_id, role) references party_role on update cascade
);

create function party_role_category_of_a_vendor() returns trigger
language plpgsql as $$
declare
	wanted uuid := case tg_op when 'DELETE' then old.party_id else new.party_id end;
begin
	if exists (select from party_role p join role r on r.slug = p.role where p.party_id = wanted and r.category_of = 'vendor')
		and not exists (select from party_role where party_id = wanted and role = 'vendor') then
		raise exception 'only a vendor holds a vendor category'
			using errcode = 'check_violation', constraint = 'party_role_category_of_a_vendor';
	end if;
	return null;
end $$;

-- Deferred, so a vendor and its category can be saved, or removed, in either order.
create constraint trigger party_role_category_of_a_vendor after insert or update or delete on party_role
	initially deferred for each row execute function party_role_category_of_a_vendor();

-- A person's place at a company, dated, so their history survives a move.
create table party_company (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	person_id uuid not null,
	person_kind text not null generated always as ('person') stored,
	company_id uuid not null,
	company_kind text not null generated always as ('company') stored,
	title text,
	started_on date,
	ended_on date check (ended_on >= started_on),
	unique nulls not distinct (person_id, company_id, started_on),
	foreign key (person_id, person_kind) references party (id, kind),
	foreign key (company_id, company_kind) references party (id, kind)
);

-- One stored form, so a repeat is caught: lower case, one address, no display name, ASCII only.
create domain email_address as text
	constraint email_address_shape check (
		value = lower(value) and value ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]*[a-z]$'
	);

-- E.164: a plus, the country code and the number, digits only. A North American number is +1 and ten digits.
create domain phone_number as text
	constraint phone_number_shape check (value ~ '^\+(1[2-9][0-9]{2}[2-9][0-9]{6}|[2-9][0-9]{6,14})$');

create table party_email (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	party_id uuid not null references party,
	address email_address not null,
	label text not null check (label in ('work', 'personal')),
	is_primary boolean not null default false,
	-- Address first, so an email's sender finds its people.
	unique (address, party_id)
);

create unique index party_email_one_primary on party_email (party_id) where is_primary;

create table party_phone (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	party_id uuid not null references party,
	number phone_number not null,
	extension text check (extension ~ '^[0-9]{1,6}$'),
	label text not null check (label in ('work', 'mobile', 'home')),
	is_primary boolean not null default false,
	unique nulls not distinct (number, extension, party_id)
);

create unique index party_phone_one_primary on party_phone (party_id) where is_primary;

-- About the person or company in every role, so any outreach reads it from the party alone.
create table do_not_contact (
	party_id uuid primary key references party,
	created_at timestamptz not null default now(),
	reason text not null check (reason ~ '\S'),
	until_date date
);

create view active_do_not_contact as
select * from do_not_contact where until_date is null or until_date >= current_date;

create table specialty (
	slug text primary key,
	label text not null
);

create table party_specialty (
	person_id uuid not null,
	person_kind text not null generated always as ('person') stored,
	specialty text not null references specialty,
	created_at timestamptz not null default now(),
	primary key (person_id, specialty),
	foreign key (person_id, person_kind) references party (id, kind)
);

-- Census FIPS codes. A county's five digits begin with its state's two.
create domain state_fips as text constraint state_fips_shape check (value ~ '^[0-9]{2}$');
create domain county_fips as text constraint county_fips_shape check (value ~ '^[0-9]{5}$');
create domain latitude as numeric(8, 6) constraint latitude_range check (value between -90 and 90);
create domain longitude as numeric(9, 6) constraint longitude_range check (value between -180 and 180);

create table property (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	address text not null,
	-- Geocoded from the address. A property without them falls in no territory.
	county_fips county_fips,
	latitude latitude,
	longitude longitude,
	name text check (name ~ '\S'),
	-- Free text, as the old system kept them.
	building_class text check (building_class ~ '\S'),
	building_type text check (building_type ~ '\S'),
	year_built integer check (year_built between 1800 and 2100),
	stories integer check (stories between 1 and 60),
	constraint property_point_whole check (num_nonnulls(latitude, longitude) <> 1)
);

-- A named market covers whole counties, the units metro areas are drawn from.
create table market (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	name text not null unique check (name ~ '\S')
);

create table market_county (
	market_id uuid not null references market,
	county_fips county_fips not null,
	created_at timestamptz not null default now(),
	primary key (market_id, county_fips)
);

-- A market named for an area, not one city, also holds the towns inside it, so a lead's city can place it there.
create table market_city (
	market_id uuid not null references market,
	city text not null check (city ~ '\S' and city = btrim(city)),
	created_at timestamptz not null default now(),
	primary key (market_id, city)
);
create unique index market_city_once on market_city (market_id, lower(city));

-- The area someone serves. A vendor's market and a user's or a lead's territory are one idea.
create table territory (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	name text not null check (name ~ '\S')
);

-- A territory is the sum of its pieces: whole states, named markets and distances from a base.
create table territory_piece (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	territory_id uuid not null references territory,
	state_fips state_fips,
	market_id uuid references market,
	base_latitude latitude,
	base_longitude longitude,
	miles numeric(6, 1) check (miles > 0),
	constraint territory_piece_one_kind check (num_nonnulls(state_fips, market_id, miles) = 1),
	constraint territory_piece_distance_from_a_base check (num_nonnulls(base_latitude, base_longitude, miles) in (0, 3)),
	constraint territory_piece_once
		unique nulls not distinct (territory_id, state_fips, market_id, base_latitude, base_longitude, miles)
);

-- Who serves a territory, dated, so a vendor that leaves a market keeps its history. A user serves as their person.
create table party_territory (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	party_id uuid not null references party,
	territory_id uuid not null references territory,
	started_on date,
	ended_on date check (ended_on >= started_on),
	unique nulls not distinct (party_id, territory_id, started_on)
);

-- What a reviewer found behind someone serving a territory, and who reviewed it when, which is never the membership's start.
create table party_territory_review (
	party_territory_id uuid primary key references party_territory,
	created_at timestamptz not null default now(),
	has_office boolean not null,
	-- The coverage they declare, in their words. It is never drawn into pieces.
	coverage text check (coverage ~ '\S'),
	source text not null check (source ~ '\S'),
	reviewed_by_user_id uuid references app_user,
	reviewed_by_job text references job,
	reviewed_for_user_id uuid references app_user,
	reviewed_at timestamptz not null,
	constraint party_territory_review_says_something check (has_office or coverage is not null),
	constraint party_territory_review_by_a_user_or_a_job check (num_nonnulls(reviewed_by_user_id, reviewed_by_job) = 1
		and (reviewed_by_job is not null or reviewed_for_user_id is null))
);

-- Every save is a review, even one confirming the same evidence, so it names who acts as stamp_change does.
create function stamp_review() returns trigger
language plpgsql as $$
declare
	acting_job text := nullif(current_setting('engine.job', true), '');
	acting_user uuid := nullif(current_setting('engine.user_id', true), '');
begin
	-- Only a merge moves a review, and the merger reviewed nothing.
	if tg_op = 'UPDATE' and new.party_territory_id <> old.party_territory_id then
		return new;
	end if;
	new.reviewed_by_user_id := case when acting_job is null then acting_user end;
	new.reviewed_by_job := acting_job;
	new.reviewed_for_user_id := case when acting_job is not null then acting_user end;
	new.reviewed_at := now();
	return new;
end $$;

-- Named to run before stamp_change, which then sees the changed reviewer or time and restamps.
create trigger review_stamp before insert or update on party_territory_review
	for each row execute function stamp_review();

-- Along the earth's surface, by the haversine formula on a 3,958.8-mile radius.
create function miles_between(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8
language sql immutable strict
return 2 * 3958.8 * asin(sqrt(sin(radians(lat2 - lat1) / 2) ^ 2
	+ cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2));

-- Each territory a property falls in, by each kind of piece.
create view property_territory as
select p.id as property_id, piece.territory_id
from property p join territory_piece piece on piece.state_fips = left(p.county_fips, 2)
union
select p.id, piece.territory_id
from property p
join market_county m on m.county_fips = p.county_fips
join territory_piece piece on piece.market_id = m.market_id
union
select p.id, piece.territory_id
from property p
join territory_piece piece on miles_between(p.latitude, p.longitude, piece.base_latitude, piece.base_longitude) <= piece.miles;

-- What kind of transaction a deal is, such as a lease or a purchase. Like roles, a label can be renamed.
create table deal_kind (
	slug text primary key,
	label text not null
);

-- Typical number of days a workflow to-do takes for one deal kind, adjustable by partners.
create table typical_length (
	deal_kind text not null references deal_kind,
	todo text not null check (todo ~ '^[a-z][a-z0-9_]*$'),
	days integer not null check (days > 0),
	primary key (deal_kind, todo)
);

-- Why the client is taking space, such as a start-up or a relocation. Like roles, a label can be renamed.
create table deal_reason (
	slug text primary key,
	label text not null
);

-- National is never stored: a deal is national exactly when its client is a location of a national account (#275).
create table deal (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	name text not null,
	kind text references deal_kind,
	reason text references deal_reason,
	-- One deal owner, so a new one is an update, and change history keeps who held it before.
	owner_user_id uuid not null references app_user,
	-- Can be named before any property is chosen.
	market_id uuid references market,
	-- Such as the total lease value or the purchase price. Empty until known, never zero.
	closed_value numeric(14, 2) check (closed_value > 0),
	-- None is active. Parking never touches the phase, so a revived deal is back in the phase it was in.
	parking_reason text check (parking_reason in ('client_paused', 'prospect_never_active', 'other')),
	parking_note text check (parking_note ~ '\S'),
	-- A flag a user sets, never worked out from anything else.
	needs_attention boolean not null default false,
	-- Who last parked the deal and when, apart from its last change.
	parked_at timestamptz,
	parked_by_user_id uuid references app_user,
	parked_automatically boolean not null default false,
	constraint deal_parking_note_when_parked check (parking_note is null or parking_reason is not null),
	constraint deal_parked_stamps_when_parked check ((parking_reason is null) = (parked_at is null)
		and (parked_by_user_id is null or parked_at is not null)),
	constraint deal_automatic_parking_has_no_user check (not parked_automatically
		or (parked_at is not null and parked_by_user_id is null))
);

-- A job alone never parks, revives or flags a deal; one working for a user, such as the agent, does.
-- As today, any change to a parked deal's reason or note stamps it again.
create function deal_parked_or_flagged_by_a_user() returns trigger
language plpgsql as $$
declare
	acting_user uuid := nullif(current_setting('engine.user_id', true), '');
begin
	if acting_user is null
		and (case tg_op
			when 'INSERT' then new.parking_reason is not null or new.needs_attention
			else (new.parking_reason, new.parking_note, new.needs_attention)
				is distinct from (old.parking_reason, old.parking_note, old.needs_attention)
		end) then
		raise exception 'a user parks, revives and flags a deal'
			using errcode = 'check_violation', constraint = 'deal_parked_or_flagged_by_a_user';
	end if;
	if tg_op = 'INSERT' or (new.parking_reason, new.parking_note) is distinct from (old.parking_reason, old.parking_note) then
		new.parked_at := case when new.parking_reason is not null then now() end;
		new.parked_by_user_id := case when new.parking_reason is not null then acting_user end;
		new.parked_automatically := false;
	end if;
	return new;
end $$;

create trigger deal_parked_or_flagged_by_a_user before insert or update of parking_reason, parking_note, needs_attention
	on deal for each row execute function deal_parked_or_flagged_by_a_user();

-- Import history only: another system's id for a record, such as Salesforce's or a roster's.
create table outside_id (
	source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
	value text not null check (value ~ '^\S(.*\S)?$'),
	party_id uuid references party,
	deal_id uuid references deal,
	-- Today's system files one email as a row per record and mailbox; each row's id finds the email it became.
	email_activity_id uuid,
	constraint outside_id_one_record check (num_nonnulls(party_id, deal_id, email_activity_id) = 1),
	primary key (source, value)
);
-- A partner can choose an end day for a to-do on one deal.
create table deal_plan_date (
	deal_id uuid not null references deal,
	todo text not null,
	target_on date check (isfinite(target_on)),
	primary key (deal_id, todo)
);

-- The checklist's shared and workflow-specific to-dos (src/deals/checklist.ts).
create function check_deal_plan_todo() returns trigger
language plpgsql as $$
declare
	deal_kind text;
	deal_reason text;
	workflow text;
	todos text[];
begin
	if tg_table_name = 'deal' then
		deal_kind := new.kind;
		deal_reason := new.reason;
		select array_agg(todo) into todos from deal_plan_date where deal_id = new.id and target_on is not null;
	else
		if tg_op = 'UPDATE' and new.target_on is null and (new.deal_id, new.todo) = (old.deal_id, old.todo) then
			return null;
		end if;
		select d.kind, d.reason into deal_kind, deal_reason from deal d where d.id = new.deal_id for no key update;
		todos := array[new.todo];
	end if;
	workflow := case when deal_reason = 'renewal' then 'renewal'
		when deal_kind is not null then deal_kind
		when deal_reason in ('start_up', 'relocation', 'expansion', 'additional_office') then 'lease' end;
	if exists (
		select from unnest(todos) as date_todo(todo)
		where not exists (
			select from (values
				(array['lease', 'renewal', 'purchase', 'land'], array[
					'representation', 'requirements', 'market_survey', 'loi_submission', 'loi_grid', 'business_terms',
					'contract_draft', 'attorney_comments', 'executed_comp', 'invoice_recorded', 'commission_received']),
				(array['lease', 'purchase', 'land'], array['tour_notes']),
				(array['lease', 'renewal'], array['legal_review', 'ti_scope', 'executed_lease', 'commencement_letter', 'expiration_recorded']),
				(array['lease'], array['move_in', 'check_in_90_day']),
				(array['renewal'], array['current_lease_abstraction', 'renewal_analysis']),
				(array['purchase', 'land'], array[
					'purchase_lease_analysis', 'financing_prework', 'earnest_money', 'title_commitment', 'inspections',
					'survey', 'environmental', 'insurance_restrictions', 'appraisal', 'financing_commitment',
					'critical_dates_document', 'commission_agreement', 'purchase_close', 'entity_structure']),
				(array['land'], array['feasibility', 'entitlements'])
			) as checklist(kinds, slugs)
			where workflow = any(kinds) and date_todo.todo = any(slugs)
		)
	) then
		raise exception 'a plan date belongs to a to-do in the deal''s workflow'
			using errcode = 'check_violation', constraint = 'deal_plan_date_workflow_todo';
	end if;
	return null;
end $$;

do $$ begin
	execute format('alter function check_deal_plan_todo() set search_path = %I, pg_temp', current_schema());
end $$;

create constraint trigger deal_plan_date_workflow_todo after insert or update on deal_plan_date
	for each row execute function check_deal_plan_todo();
create constraint trigger deal_plan_date_workflow_todo after update of kind, reason on deal
	for each row when (old.kind is distinct from new.kind or old.reason is distinct from new.reason)
	execute function check_deal_plan_todo();

-- Reads find a party's old ids by party.
create index outside_id_by_party on outside_id (party_id);

create table phase (
	slug text primary key,
	label text not null
);

create table deal_phase_change (
	deal_id uuid not null references deal,
	happened_at timestamptz not null,
	phase text not null references phase,
	reason text,
	call_activity_id uuid,
	call_move_id uuid unique,
	call_kind text generated always as ('call') stored,
	primary key (deal_id, happened_at),
	constraint deal_phase_change_dead_has_reason check (phase <> 'dead' or reason is not null)
);

create table deal_client_website (
	slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
	deal_id uuid not null references deal,
	client_party_id uuid not null references party,
	password_hash text not null check (password_hash ~ '^[$]2[aby][$]12[$][./A-Za-z0-9]{53}$'),
	disabled_at timestamptz,
	created_at timestamptz not null default now()
);
create unique index deal_client_website_one_active on deal_client_website (deal_id) where disabled_at is null;

create table deal_client_website_attempt (
	slug text primary key references deal_client_website,
	failed_attempts integer not null check (failed_attempts between 1 and 5),
	window_started_at timestamptz not null
);

create table deal_client_website_grant (
	digest text primary key check (digest ~ '^[0-9a-f]{64}$'),
	slug text not null references deal_client_website,
	user_id uuid not null references app_user,
	expires_at timestamptz not null
);

create table imported_automatic_phase_move (
	source_event_id uuid primary key,
	deal_id uuid not null,
	happened_at timestamptz not null,
	prior_phase text not null references phase,
	reason text not null,
	unique (deal_id, happened_at),
	foreign key (deal_id, happened_at) references deal_phase_change
);

create table deal_property (
	deal_id uuid not null references deal,
	property_id uuid not null references property,
	created_at timestamptz not null default now(),
	primary key (deal_id, property_id)
);

create table deal_party (
	deal_id uuid not null references deal,
	party_id uuid not null references party,
	role text not null references role,
	created_at timestamptz not null default now(),
	primary key (deal_id, party_id, role)
);

create index deal_party_by_party on deal_party (party_id);

create table weekly_review (
	id uuid primary key default gen_random_uuid(),
	week_of date not null check (isfinite(week_of) and extract(isodow from week_of) = 1),
	deal_id uuid references deal,
	party_id uuid,
	lead_role text generated always as (case when party_id is not null then 'lead' end) stored,
	foreign key (party_id, lead_role) references party_role,
	constraint weekly_review_one_item check (num_nonnulls(deal_id, party_id) = 1),
	unique nulls not distinct (week_of, deal_id, party_id)
);

create function weekly_review_undo_by_partner() returns trigger
language plpgsql as $$
begin
	if nullif(current_setting('engine.job', true), '') is not null or not exists (
		select from app_user where is_account_partner
			and id = nullif(current_setting('engine.user_id', true), '')::uuid
	) then
		raise exception 'a partner undoes a weekly review mark'
			using errcode = 'check_violation', constraint = 'weekly_review_undo_by_partner';
	end if;
	return old;
end $$;

create trigger weekly_review_undo_by_partner before delete on weekly_review
for each row execute function weekly_review_undo_by_partner();

create function lock_weekly_review(week_of date, deal_id uuid, party_id uuid) returns void
language sql
begin atomic
	select pg_advisory_xact_lock(hashtextextended(concat('weekly-review:', week_of, ':', deal_id, ':', party_id), 0));
end;

create function carry_weekly_review(prospect_id uuid, new_deal_id uuid) returns void
language plpgsql security definer as $$
declare
	monday date := date_trunc('week', now() at time zone 'America/Chicago')::date;
begin
	if nullif(current_setting('engine.job', true), '') is not null
		or nullif(current_setting('engine.user_id', true), '') is null
		or not exists (
			select from deal d join deal_party link on link.deal_id = d.id
			where d.id = new_deal_id and d.created_at = now() and link.created_at = now()
				and link.party_id = prospect_id and link.role in ('client', 'client_contact')
		) then
		raise exception 'a weekly review mark carries only with a prospect conversion'
			using errcode = 'check_violation', constraint = 'weekly_review_carries_with_conversion';
	end if;

	perform lock_weekly_review(monday, null, prospect_id);
	update weekly_review set deal_id = new_deal_id, party_id = null
	where week_of = monday and party_id = prospect_id;
end $$;
revoke execute on function carry_weekly_review(uuid, uuid) from public;

do $$ begin
	execute format('alter function carry_weekly_review set search_path = %I, pg_temp', current_schema());
end $$;

-- Each partner's own starred deals, which stay at the top of their Deals board and list.
create table deal_star (
	user_id uuid not null references app_user,
	deal_id uuid not null references deal on delete cascade,
	created_at timestamptz not null default now(),
	primary key (user_id, deal_id)
);

-- Leads and clients. A lead is the lead role on a person or company, and becoming a client adds the client role.

-- How a lead or client was found, such as referral or public records. Like roles, a label can be renamed.
create table how_found (
	slug text primary key,
	label text not null
);

-- A fact about the person or company, so it holds in every role and a lead that becomes a client copies nothing.
alter table party add how_found text references how_found;

alter table party_role add owner_user_id uuid references app_user,
	add constraint party_role_lead_has_a_stage check (role <> 'lead' or stage is not null),
	add constraint party_role_owner_on_lead_or_vendor check (owner_user_id is null or role in ('lead', 'vendor'));

alter table party_role add needs_attention boolean not null default false,
	add constraint party_role_attention_only_on_lead check (not needs_attention or role = 'lead');

create function lead_flagged_by_a_user() returns trigger
language plpgsql as $$
begin
	if nullif(current_setting('engine.user_id', true), '') is null
		and new.needs_attention is distinct from
			(case when tg_op = 'INSERT' then false else old.needs_attention end) then
		raise exception 'a user sets or clears lead attention'
			using errcode = 'check_violation', constraint = 'lead_flagged_by_a_user';
	end if;
	return new;
end $$;

create trigger lead_flagged_by_a_user before insert or update of needs_attention on party_role
	for each row execute function lead_flagged_by_a_user();

create table lead_lane (
	slug text primary key,
	label text not null
);

alter table party add how_found_detail text check (how_found_detail ~ '\S'),
	add constraint party_how_found_detail_has_source check (how_found_detail is null or how_found is not null);
alter table party_role add lane text references lead_lane,
	add estimated_lease_on date,
	add lease_estimate_source text check (lease_estimate_source ~ '\S'),
	add lease_estimate_confidence text check (lease_estimate_confidence in ('high', 'medium', 'low')),
	add segment text check (segment ~ '\S'),
	add constraint party_role_lease_estimate_has_source check ((estimated_lease_on is null) = (lease_estimate_source is null)),
	add constraint party_role_lease_confidence_has_estimate check (lease_estimate_confidence is null or estimated_lease_on is not null),
	add constraint party_role_working_details_on_lead check (role = 'lead'
		or num_nonnulls(lane, estimated_lease_on, lease_estimate_source, lease_estimate_confidence, segment) = 0);

create function lead_or_client_how_found() returns trigger
language plpgsql as $$
declare
	-- The trigger names the column that holds the party.
	wanted uuid := to_jsonb(new) ->> tg_argv[0];
begin
	if exists (select from party p
		where p.id = wanted and p.how_found is null
			and exists (select from party_role where party_id = p.id and role in ('lead', 'client'))) then
		raise exception 'a lead or client says how they were found'
			using errcode = 'check_violation', constraint = 'lead_or_client_how_found';
	end if;
	return null;
end $$;

-- Deferred, so a person and their role can be saved in either order. A merge moves a role only with how it was found.
create constraint trigger lead_or_client_how_found after insert on party_role
	initially deferred for each row when (new.role in ('lead', 'client'))
	execute function lead_or_client_how_found('party_id');
-- Only clearing it can break the rule.
create constraint trigger lead_or_client_how_found after update of how_found on party
	for each row when (old.how_found is not null and new.how_found is null)
	execute function lead_or_client_how_found('id');

-- Not recorded is only for records the old-system copy brought in; anyone added here says how they were found (owner, #604).
create function how_found_not_recorded_only_imported() returns trigger
language plpgsql as $$
begin
	-- Judged at commit on the saved row, so a later correction or merge in the same transaction counts.
	if exists (select from party where id = new.id and how_found = 'not_recorded')
		and not exists (select from outside_id where party_id = new.id and source = 'old_system') then
		raise exception 'only a record copied from the old system may say how it was found was not recorded'
			using errcode = 'check_violation', constraint = 'how_found_not_recorded_only_imported';
	end if;
	return null;
end $$;

-- Deferred, so a person and their old-system id can be saved in either order.
create constraint trigger how_found_not_recorded_only_imported after insert or update of how_found on party
	initially deferred for each row when (new.how_found = 'not_recorded')
	execute function how_found_not_recorded_only_imported();

-- Someone is a client once a deal is opened for them, signed or not. The client role's row keeps when that was.
-- Deferred, so the role and the deal can be saved in either order, and a merge can move both.
alter table deal_party add client_role text generated always as (case when role = 'client' then role end) stored,
	add constraint deal_party_client_is_a_client foreign key (party_id, client_role) references party_role
		deferrable initially deferred;
-- A deal is for one client, the business; its people are that client's contacts (owner, #594).
alter table deal_party add constraint deal_party_one_client unique (deal_id, client_role);

-- Earlier people and deal owners, as the old system recorded them. A native removal or handoff is change history instead.
-- An unknown start reaches back without limit, so two of them for one person, role and deal overlap and are refused.
create extension if not exists btree_gist;
create table imported_deal_party (
	id uuid primary key,
	deal_id uuid not null references deal,
	party_id uuid not null references party,
	role text not null references role,
	started_at timestamptz,
	ended_at timestamptz not null,
	constraint imported_deal_party_ends_after_it_starts check (ended_at > started_at),
	constraint imported_deal_party_once_at_a_time
		exclude using gist (deal_id with =, party_id with =, role with =, tstzrange(started_at, ended_at) with &&)
);

-- Who moved the deal and why stay in its imported owner changes; this keeps only who held it, from when to when.
create table imported_deal_owner (
	id uuid primary key,
	deal_id uuid not null references deal,
	user_id uuid not null references app_user,
	started_at timestamptz,
	ended_at timestamptz not null,
	constraint imported_deal_owner_ends_after_it_starts check (ended_at > started_at),
	constraint imported_deal_owner_one_at_a_time exclude using gist (deal_id with =, tstzrange(started_at, ended_at) with &&)
);

-- Today's system dates an invoiced deal on the deal itself, often with no commission row to move the date onto.
create table imported_deal_invoiced (
	deal_id uuid primary key references deal,
	invoiced_on date not null
);

create table imported_deal_board (
	deal_id uuid primary key references deal,
	city text,
	phase text references phase,
	outcome text check (outcome in ('won', 'lost')),
	closed_on date,
	phase_at timestamptz,
	renewal_lease_unrecorded boolean not null default false,
	foreign key (deal_id, phase_at) references deal_phase_change (deal_id, happened_at)
);

-- Held per person, role and deal until the transaction ends, so a copied period and a rejoin cannot each pass alone and together break it.
create function deal_party_rejoins_after_leaving() returns trigger
language plpgsql as $$
begin
	perform pg_advisory_xact_lock(hashtextextended(format('deal_party %s %s %s', new.deal_id, new.party_id, new.role), 0));
	if exists (select from deal_party p join imported_deal_party e using (deal_id, party_id, role)
		where (p.deal_id, p.party_id, p.role) = (new.deal_id, new.party_id, new.role) and e.ended_at > p.created_at) then
		raise exception 'someone is back on a deal only after they left it'
			using errcode = 'check_violation', constraint = 'deal_party_rejoins_after_leaving';
	end if;
	return null;
end $$;

create constraint trigger deal_party_rejoins_after_leaving after insert or update on deal_party
	for each row execute function deal_party_rejoins_after_leaving();
create constraint trigger deal_party_rejoins_after_leaving after insert or update on imported_deal_party
	for each row execute function deal_party_rejoins_after_leaving();

-- Drafts record preparation and approval only. Sending stays in the user's mailbox.
create table lead_contact_draft (
	id uuid primary key default gen_random_uuid(),
	party_id uuid not null unique references party,
	role text not null generated always as ('lead') stored,
	created_at timestamptz not null default now(),
	owner_user_id uuid references app_user,
	subject text not null check (subject ~ '\S'),
	body text not null check (body ~ '\S'),
	scheduled_for timestamptz not null,
	time_zone text not null check (time_zone ~ '\S'),
	revision integer not null default 1 check (revision >= 1),
	approved boolean not null default false,
	requires_human_send boolean not null default true check (requires_human_send),
	dispatchable boolean not null default false check (not dispatchable),
	foreign key (party_id, role) references party_role deferrable initially deferred
);

create function lead_contact_draft_review() returns trigger
language plpgsql as $$
begin
	if (new.subject, new.body, new.owner_user_id, new.scheduled_for, new.time_zone, new.approved)
		is not distinct from (old.subject, old.body, old.owner_user_id, old.scheduled_for, old.time_zone, old.approved) then
		return new;
	end if;
	if nullif(current_setting('engine.user_id', true), '') is null then
		raise exception 'a user edits or approves an outreach draft'
			using errcode = 'check_violation', constraint = 'lead_contact_draft_user_approves';
	end if;
	perform from party p join party_role lead on lead.party_id = p.id
	where p.id = new.party_id and lead.role = 'lead' and lead.stage = 'qualified' for update of p, lead;
	if not found then
		raise exception 'only a qualified lead has its outreach draft edited or approved'
			using errcode = 'check_violation', constraint = 'lead_contact_draft_contactable';
	end if;
	-- Hold existing restrictions as well as the party against a new restriction while approving.
	perform from do_not_contact where party_id = new.party_id for share;
	if exists (select from active_do_not_contact where party_id = new.party_id) then
		raise exception 'do not contact prevents editing or approving outreach'
			using errcode = 'check_violation', constraint = 'lead_contact_draft_contactable';
	end if;
	if (new.subject, new.body, new.owner_user_id, new.scheduled_for, new.time_zone)
		is distinct from (old.subject, old.body, old.owner_user_id, old.scheduled_for, old.time_zone) then
		new.revision := old.revision + 1;
		new.approved := false;
	end if;
	return new;
end $$;

create trigger lead_contact_draft_review before update on lead_contact_draft
	for each row execute function lead_contact_draft_review();

-- Candidates have no party until a user promotes them; source context stays outside the working contact list.
create table candidate (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	source text not null check (source = btrim(source) and source ~ '\S'),
	source_key text not null check (source_key = btrim(source_key) and source_key ~ '\S'),
	source_row jsonb not null check (jsonb_typeof(source_row) = 'object'),
	name text not null check (name ~ '\S'),
	qualification text not null check (qualification ~ '\S'),
	estimated_lease_on date,
	lease_estimate_source text check (lease_estimate_source ~ '\S'),
	status text not null default 'unreviewed' check (status in ('unreviewed', 'promoted', 'declined', 'suppressed')),
	reason text check (reason ~ '\S'),
	promoted_party_id uuid references party,
	lead_role text generated always as (case when status = 'promoted' then 'lead' end) stored,
	unique (source, source_key),
	constraint candidate_estimate_has_source check ((estimated_lease_on is null) = (lease_estimate_source is null)),
	constraint candidate_promoted_has_lead check ((status = 'promoted') = (promoted_party_id is not null)),
	constraint candidate_rejection_has_reason check ((status in ('declined', 'suppressed')) = (reason is not null)),
	foreign key (promoted_party_id, lead_role) references party_role deferrable initially deferred
);

create function candidate_review() returns trigger
language plpgsql as $$
declare
	needs_user boolean := new.status in ('promoted', 'declined');
begin
	if tg_op = 'UPDATE' then
		if old.status in ('promoted', 'declined') and new.status is distinct from old.status
			or old.status = 'declined' and new.reason is distinct from old.reason then
			raise exception 'a promoted or declined candidate stays decided'
				using errcode = 'check_violation', constraint = 'candidate_decision_final';
		end if;
		if old.status = 'promoted' and new.promoted_party_id is distinct from old.promoted_party_id
			and not exists (select from merged_party where id = old.promoted_party_id and survivor_id = new.promoted_party_id
				and id = nullif(current_setting('engine.merge', true), '')::uuid and created_at = now()) then
			raise exception 'only a merge moves a promoted candidate to another lead'
				using errcode = 'check_violation', constraint = 'candidate_promotion_stays';
		end if;
		if old.status <> 'unreviewed' and (new.source_row, new.name, new.qualification, new.estimated_lease_on, new.lease_estimate_source)
			is distinct from (old.source_row, old.name, old.qualification, old.estimated_lease_on, old.lease_estimate_source) then
			raise exception 'only an unreviewed candidate receives refreshed source facts'
				using errcode = 'check_violation', constraint = 'candidate_refresh_unreviewed';
		end if;
		if old.status = new.status then return null; end if;
		if new.status = 'promoted' and old.status <> 'unreviewed' then
			raise exception 'only an unreviewed candidate is promoted'
				using errcode = 'check_violation', constraint = 'candidate_unreviewed_promotes';
		end if;
		needs_user := needs_user or old.status = 'suppressed';
	end if;
	if needs_user and nullif(current_setting('engine.user_id', true), '') is null then
		raise exception 'a user promotes, declines or reopens a candidate'
			using errcode = 'check_violation', constraint = 'candidate_user_decides';
	end if;
	return null;
end $$;

create trigger candidate_review after insert or update on candidate
	for each row execute function candidate_review();

-- An introduction between a vendor and the team, or a client bringing a vendor to their deal.
create table introduction (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	vendor_id uuid not null,
	vendor_role text not null default 'vendor' check (vendor_role = 'vendor'),
	made_by text not null check (made_by in ('vendor', 'team', 'client')),
	maker_client_role text,
	introduced_by_user_id uuid references app_user,
	-- The introduced party, or the client who brought the vendor.
	introduced_party_id uuid not null references party,
	introduced_on date,
	deal_id uuid references deal,
	note text check (note ~ '\S'),
	confirmed boolean not null default true,
	source_job_id uuid,
	source text generated always as (case when source_job_id is not null then 'found in email' end) stored,
	constraint introduction_email_evidence check (
		(confirmed or source_job_id is not null) and (source_job_id is null or introduced_on is not null)
	),
	constraint introduction_client_maker_names_deal check (
		(made_by = 'client') = (maker_client_role is not null)
		and (maker_client_role is null or (maker_client_role = 'client' and deal_id is not null))
	),
	constraint introduction_maker_is_deal_client
		foreign key (deal_id, introduced_party_id, maker_client_role) references deal_party on update cascade,
	constraint introduction_of_someone_else check (introduced_party_id <> vendor_id),
	constraint introduction_team_names_its_user check ((made_by = 'team') = (introduced_by_user_id is not null)),
	-- Only a merge changes a party_role key, and its introductions move with it.
	foreign key (vendor_id, vendor_role) references party_role on update cascade
);

-- Who knows whom, and who can introduce the team to whom: any two people or companies, dated.
-- An introduction is one that happened with a vendor; a can_introduce link is one that might.
create table party_link (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	kind text not null check (kind in ('knows', 'can_introduce')),
	-- Who knows the other, or who can introduce the team to the other.
	party_id uuid not null references party,
	other_party_id uuid not null references party,
	started_on date,
	ended_on date,
	note text check (note ~ '\S'),
	constraint party_link_two_parties check (party_id <> other_party_id),
	constraint party_link_ends_after_it_starts check (ended_on >= started_on)
);

-- A pair has one current link of each kind; ended links stay as history, so the pair can link again.
-- Knowing goes both ways, so a current knows link is one whichever party it names first.
create unique index party_link_knows_once on party_link
	(least(party_id, other_party_id), greatest(party_id, other_party_id)) where kind = 'knows' and ended_on is null;
create unique index party_link_can_introduce_once on party_link
	(party_id, other_party_id) where kind = 'can_introduce' and ended_on is null;

-- From deal history only: the deals a vendor worked in a vendor role, and the deals its introductions led to.
create view vendor_track_record as
with worked as (
	select dp.party_id, dp.deal_id, (
		select phase from deal_phase_change c where c.deal_id = dp.deal_id order by happened_at desc limit 1
	) as phase
	from deal_party dp join role r on r.slug = dp.role
	where 'vendor' in (r.slug, r.category_of)
)
select v.party_id,
	count(distinct w.deal_id) as deals_worked,
	count(distinct w.deal_id) filter (where w.phase = 'closed') as deals_closed,
	count(distinct w.deal_id) filter (where w.phase = 'dead') as deals_dead,
	(select count(distinct deal_id) from introduction where confirmed and vendor_id = v.party_id and made_by = 'vendor')
		as deals_it_introduced,
	(select count(distinct deal_id) from introduction where confirmed and vendor_id = v.party_id and made_by = 'team')
		as deals_we_introduced
from party_role v
left join worked w using (party_id)
where v.role = 'vendor'
group by v.party_id;

-- Clients and national accounts (walkthrough 4, topic B).
create table client_type (
	slug text primary key,
	label text not null
);

create table client (
	party_id uuid primary key,
	role text not null default 'client' check (role = 'client'),
	created_at timestamptz not null default now(),
	status text not null default 'roster' check (status in ('roster', 'cold', 'engaged', 'paused')),
	client_type text references client_type,
	owner_user_id uuid references app_user,
	foreign key (party_id, role) references party_role on update cascade
);

alter table party_role
	add column lead_client_id uuid,
	add constraint lead_client_link_client foreign key (lead_client_id) references client (party_id) on update cascade,
	add constraint lead_client_link_distinct check (
		lead_client_id is null or (role = 'lead' and lead_client_id <> party_id));

create table national_account (
	party_id uuid primary key,
	kind text generated always as ('company') stored,
	role text not null default 'national_account' check (role = 'national_account'),
	created_at timestamptz not null default now(),
	foreign key (party_id, kind) references party (id, kind),
	foreign key (party_id, role) references party_role on update cascade
);

create table client_brand (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	location_id uuid not null references client (party_id) on update cascade,
	brand_id uuid not null,
	brand_kind text generated always as ('company') stored,
	started_on date not null,
	ended_on date check (ended_on > started_on),
	constraint client_brand_different_parties check (location_id <> brand_id),
	foreign key (brand_id, brand_kind) references party (id, kind),
	exclude using gist (location_id with =, daterange(started_on, ended_on) with &&)
);

create table national_account_owner (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	account_id uuid not null references national_account (party_id) on update cascade,
	owner_id uuid not null,
	owner_is_partner boolean generated always as (true) stored,
	started_on date not null,
	ended_on date check (ended_on > started_on),
	foreign key (owner_id, owner_is_partner) references app_user (id, is_account_partner),
	exclude using gist (account_id with =, daterange(started_on, ended_on) with &&)
);

create view client_status as
select c.party_id, case
	when exists (select from deal_party dp where dp.party_id = c.party_id and dp.role = 'client'
		and coalesce((select phase from deal_phase_change p where p.deal_id = dp.deal_id
			order by happened_at desc limit 1), '') not in ('closed', 'dead')) then 'active_deal'
	when exists (select from deal_party dp join deal_phase_change p using (deal_id)
		where dp.party_id = c.party_id and dp.role = 'client' and p.phase = 'closed') then 'past_client'
	else c.status end as status
from client c;

create table activity (
	id uuid primary key default gen_random_uuid(),
	kind text not null check (kind in ('email', 'call', 'meeting', 'note')),
	happened_at timestamptz not null,
	from_party_id uuid references party,
	reached boolean,
	summary text,
	calendar_review_key text check (calendar_review_key ~ '^[a-f0-9]{16}$'),
	calendar_review_user_id uuid references app_user,
	constraint activity_calendar_review check ((calendar_review_key is null) = (calendar_review_user_id is null)
		and (calendar_review_key is null or kind = 'meeting')),
	unique (calendar_review_user_id, calendar_review_key),
	unique (id, kind)
);

create table tour_plan (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	deal_id uuid not null references deal,
	planned_on date not null,
	notes text,
	completed_activity_id uuid unique,
	completed_activity_kind text generated always as ('meeting') stored,
	cancelled_at timestamptz,
	revision integer not null default 1 check (revision >= 1),
	constraint tour_plan_one_outcome check (num_nonnulls(completed_activity_id, cancelled_at) <= 1),
	foreign key (completed_activity_id, completed_activity_kind) references activity (id, kind)
);

create index tour_plan_deal on tour_plan (deal_id);

create table tour_stop (
	tour_plan_id uuid not null references tour_plan,
	property_id uuid not null references property,
	position integer not null check (position > 0),
	created_at timestamptz not null default now(),
	primary key (tour_plan_id, position)
);

create function revise_tour_plan() returns trigger
language plpgsql as $$
begin
	if tg_op = 'INSERT' then
		new.revision := 1;
		return new;
	end if;
	if new.deal_id is distinct from old.deal_id then
		raise exception 'a tour plan stays with its deal'
			using errcode = 'check_violation', constraint = 'tour_plan_same_deal';
	end if;
	if num_nonnulls(old.completed_activity_id, old.cancelled_at) <> 0 then
		raise exception 'only a planned tour can change'
			using errcode = 'check_violation', constraint = 'tour_plan_open';
	end if;
	new.revision := old.revision + 1;
	return new;
end $$;

create function tour_stop_on_open_plan() returns trigger
language plpgsql as $$
begin
	-- Restamp the plan on stop edits and serialize them with finalization.
	update tour_plan set planned_on = planned_on where id in (old.tour_plan_id, new.tour_plan_id);
	return case when tg_op = 'DELETE' then old else new end;
end $$;

create function tour_plan_requires_stop() returns trigger
language plpgsql as $$
declare
	plan_id uuid;
begin
	if tg_table_name = 'tour_plan' then
		plan_id := new.id;
	else
		plan_id := old.tour_plan_id;
	end if;
	if exists (select from tour_plan where id = plan_id)
		and not exists (select from tour_stop where tour_plan_id = plan_id) then
		raise exception 'a tour plan needs at least one stop'
			using errcode = 'check_violation', constraint = 'tour_plan_requires_stop';
	end if;
	return null;
end $$;

do $$ begin
	execute format('alter function tour_stop_on_open_plan set search_path = pg_catalog, %I, pg_temp', current_schema());
	execute format('alter function tour_plan_requires_stop set search_path = pg_catalog, %I, pg_temp', current_schema());
end $$;

revoke execute on function revise_tour_plan(), tour_stop_on_open_plan(), tour_plan_requires_stop() from public;

create trigger revise_tour_plan before insert or update on tour_plan
	for each row execute function revise_tour_plan();
create trigger tour_stop_on_open_plan before insert or update or delete on tour_stop
	for each row execute function tour_stop_on_open_plan();

create constraint trigger tour_plan_requires_stop after insert or update of id on tour_plan
	deferrable initially deferred for each row execute function tour_plan_requires_stop();
create constraint trigger tour_plan_requires_stop after delete or update of tour_plan_id on tour_stop
	deferrable initially deferred for each row execute function tour_plan_requires_stop();

create table calendar_agenda (
	user_id uuid primary key references app_user,
	observed_at timestamptz not null,
	snapshot json not null,
	constraint calendar_agenda_size check (length(snapshot::text) +
		length(regexp_replace(snapshot::text, '[^\U00010000-\U0010FFFF]', '', 'g')) <= 262144)
);

create table calendar_review_dismissal (
	user_id uuid not null references app_user,
	key text not null check (key ~ '^[a-f0-9]{16}$'),
	dismissed_at timestamptz not null default now(),
	primary key (user_id, key)
);

create function calendar_agenda_monotonic() returns trigger
language plpgsql as $$
begin
	if new.observed_at < old.observed_at then
		raise exception 'agenda is older than the stored observation'
			using errcode = 'check_violation', constraint = 'calendar_agenda_monotonic';
	end if;
	return new;
end $$;
create trigger calendar_agenda_monotonic before update on calendar_agenda
	for each row execute function calendar_agenda_monotonic();

create table activity_about (
	activity_id uuid not null references activity,
	deal_id uuid references deal,
	party_id uuid references party,
	property_id uuid references property,
	created_at timestamptz not null default now(),
	constraint activity_about_one_record check (num_nonnulls(deal_id, party_id, property_id) = 1),
	unique nulls not distinct (activity_id, deal_id, party_id, property_id)
);

create index activity_about_by_party on activity_about (party_id, activity_id) where party_id is not null;

-- The date is the activity's, and the mailbox stays the full record.
create table email (
	activity_id uuid primary key,
	activity_kind text not null generated always as ('email') stored,
	message_id text unique check (message_id = btrim(message_id)),
	conversation_id text,
	-- Matched to a person through party_email.
	sender email_address not null,
	sender_name text,
	subject text not null,
	body text not null,
	authored text,
	history text,
	-- Set only by the owner's copy of today's mail, the one source that may lack the Message-ID.
	imported boolean not null default false,
	constraint email_message_id_not_blank check (message_id ~ '\S'),
	constraint email_conversation_id_not_blank check (conversation_id ~ '\S'),
	constraint email_message_id_unless_imported check (message_id is not null or imported),
	constraint email_authored_history_pair check ((authored is null) = (history is null)),
	foreign key (activity_id, activity_kind) references activity (id, kind)
);

create table email_summary (
	activity_id uuid not null references email,
	source_activity_id uuid not null,
	source_hash text not null check (source_hash ~ '^sha256:[a-f0-9]{64}$'),
	generator_version text not null check (generator_version ~ '\S'),
	status text not null,
	text text,
	provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
	recorded_at timestamptz not null,
	primary key (source_activity_id, source_hash, generator_version),
	check ((status = 'available' and text is not null and length(text) between 1 and 300)
		or (status = 'unavailable' and text is null))
);
create index email_summary_email on email_summary (activity_id);

create view email_current_summary as
select distinct on (activity_id) activity_id, source_activity_id, source_hash, generator_version, text, provenance, recorded_at
from email_summary where status = 'available'
order by activity_id, recorded_at desc, source_activity_id, source_hash, generator_version;

create table email_recipient (
	activity_id uuid not null references email,
	position integer not null check (position >= 0),
	address email_address not null,
	kind text not null check (kind in ('to', 'cc')),
	primary key (activity_id, position)
);

create table email_mailbox (
	activity_id uuid not null references email,
	user_id uuid not null references app_user,
	primary key (activity_id, user_id)
);

create function record_email_summary(email_id uuid, captured_hash text, writer_version text,
	result_status text, summary_text text, result_provenance jsonb, result_time timestamptz)
returns email_summary
language plpgsql security definer as $$
declare
	saved email_summary;
begin
	if current_setting('engine.job', true) is distinct from 'mail_capture' then
		raise insufficient_privilege using message = 'only mail capture can record an email summary';
	end if;
	if not exists (
		select from email_mailbox m join app_user u on u.id = m.user_id
		where m.activity_id = email_id and u.is_account_partner
			and u.id = nullif(current_setting('engine.user_id', true), '')::uuid
	) then
		return null;
	end if;

	insert into email_summary (activity_id, source_activity_id, source_hash, generator_version, status, text, provenance, recorded_at)
	values (email_id, email_id, captured_hash, writer_version, result_status, summary_text, result_provenance, result_time)
	on conflict (source_activity_id, source_hash, generator_version) do nothing;
	if found and result_time > clock_timestamp() + interval '5 minutes' then
		raise check_violation using message = 'recorded time is more than five minutes ahead of the database clock',
			constraint = 'email_summary_recorded_at_in_future';
	end if;

	select * into strict saved from email_summary
	where source_activity_id = email_id and source_hash = captured_hash and generator_version = writer_version;
	if (saved.activity_id, saved.status, saved.text, saved.provenance)
		is distinct from (email_id, result_status, summary_text, result_provenance) then
		raise unique_violation using message = 'this source and writer already have a different summary result',
			constraint = 'email_summary_result_conflict';
	end if;
	return saved;
end $$;

do $$ begin
	execute format('alter function record_email_summary set search_path = pg_catalog, %I, pg_temp', current_schema());
end $$;
revoke execute on function record_email_summary from public;

alter table outside_id add foreign key (email_activity_id) references email;

-- Without its Message-ID, an email is its sender, sent time and subject, so it is stored once.
create function email_without_message_id_once() returns trigger
language plpgsql as $$
begin
	if exists (select from email e join activity a on a.id = e.activity_id join activity n on n.id = new.activity_id
		where e.message_id is null and e.activity_id <> new.activity_id and e.sender = new.sender
			and a.happened_at = n.happened_at and lower(e.subject) = lower(new.subject)) then
		raise exception 'an email without its Message-ID is stored once'
			using errcode = 'unique_violation', constraint = 'email_without_message_id_once';
	end if;
	return null;
end $$;

create trigger email_without_message_id_once after insert on email
	for each row when (new.message_id is null) execute function email_without_message_id_once();

create function email_about_a_record() returns trigger
language plpgsql as $$
declare
	wanted uuid := case tg_table_name when 'email' then new.activity_id else old.activity_id end;
begin
	if exists (select from email where activity_id = wanted)
		and not exists (select from activity_about where activity_id = wanted) then
		raise exception 'an email is stored only when it is about a record'
			using errcode = 'check_violation', constraint = 'email_about_a_record';
	end if;
	return null;
end $$;

-- Deferred, because an email is saved before the rows that say what it is about.
create constraint trigger email_about_a_record after insert on email
	initially deferred for each row execute function email_about_a_record();
create constraint trigger email_about_a_record after delete on activity_about
	initially deferred for each row execute function email_about_a_record();

alter table activity_about add constraint activity_about_activity_party_key unique (activity_id, party_id);
alter table activity_about add constraint activity_about_activity_deal_key unique (activity_id, deal_id);

alter table tour_plan add constraint tour_plan_completed_on_deal foreign key (completed_activity_id, deal_id)
	references activity_about (activity_id, deal_id) deferrable initially deferred;

create table lead_email_evidence (
	message_id text not null check (message_id = btrim(message_id) and message_id ~ '\S'),
	mailbox_user_id uuid not null references app_user,
	source jsonb not null check (jsonb_typeof(source) = 'object'),
	reason text not null check (reason ~ '\S'),
	created_at timestamptz not null default now(),
	primary key (message_id, mailbox_user_id)
);

create table lead_source_sender (
	id uuid primary key default gen_random_uuid(),
	address email_address,
	domain text,
	name text not null check (name ~ '\S'),
	fields jsonb,
	created_at timestamptz not null default now(),
	check ((address is null) <> (domain is null)),
	check (length(domain) <= 253 and domain collate "C" ~
		'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'),
	constraint lead_source_sender_fields check (
		case
			when fields is null then true
			when jsonb_typeof(fields) = 'object' then
				fields ? 'name'
				and fields - array['name', 'email', 'phone', 'street_address', 'city', 'request'] = '{}'::jsonb
				and not jsonb_path_exists(fields, 'strict $.* ? (@.type() != "string"
					|| !(@ like_regex "[^[:space:]]") || @ like_regex ":[[:space:]]*$")')
			else false
		end
	),
	unique (domain)
);
create unique index lead_source_sender_address_unique on lead_source_sender (lower(address));

create table lead_email_source (
	activity_id uuid primary key,
	party_id uuid not null references party,
	lead_role text generated always as ('lead') stored,
	mailbox_user_id uuid not null,
	prospect jsonb not null,
	evidence text not null check (evidence ~ '\S'),
	foreign key (party_id, lead_role) references party_role deferrable initially deferred,
	foreign key (activity_id, party_id) references activity_about (activity_id, party_id) deferrable initially deferred,
	foreign key (activity_id, mailbox_user_id) references email_mailbox,
	unique (activity_id, party_id),
	constraint lead_email_source_prospect_identity check ((
		jsonb_typeof(prospect) = 'object'
		and jsonb_typeof(prospect->'name') = 'string' and prospect->>'name' ~ '\S'
		and (
			(jsonb_typeof(prospect->'email') = 'string'
				and pg_input_is_valid(prospect->>'email', pg_typeof(null::email_address)::text))
			or (jsonb_typeof(prospect->'phone') = 'string'
				and pg_input_is_valid(prospect->>'phone', pg_typeof(null::phone_number)::text))
			or (jsonb_typeof(prospect->'street_address') = 'string' and prospect->>'street_address' ~ '\S'
				and jsonb_typeof(prospect->'city') = 'string' and prospect->>'city' ~ '\S')
		)
	) is true)
);

create table lead_email_attention (
	party_id uuid primary key references party,
	activity_id uuid not null,
	created_at timestamptz not null default now(),
	acknowledged_by_user_id uuid,
	acknowledged_at timestamptz,
	acknowledger_is_partner boolean generated always as (true) stored,
	foreign key (activity_id, party_id) references lead_email_source (activity_id, party_id) deferrable initially deferred,
	foreign key (acknowledged_by_user_id, acknowledger_is_partner) references app_user (id, is_account_partner),
	check ((acknowledged_by_user_id is null) = (acknowledged_at is null))
);

create function lead_email_attention_change() returns trigger
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

create trigger lead_email_attention_change before insert or update on lead_email_attention
	for each row execute function lead_email_attention_change();

alter table deal_phase_change
	add constraint deal_phase_change_source_is_call
		foreign key (call_activity_id, call_kind) references activity (id, kind),
	add constraint deal_phase_change_call_on_deal
		foreign key (call_activity_id, deal_id) references activity_about (activity_id, deal_id);

-- Evidence is separate from ordinary stage edits, whose author and time are already in change history.
create table lead_stage_move (
	id uuid primary key default gen_random_uuid(),
	party_id uuid not null references party,
	role text not null generated always as ('lead') stored,
	from_stage text not null,
	to_stage text not null,
	activity_id uuid references activity,
	evidence_ref text check (evidence_ref ~ '\S'),
	strength text not null check (strength in ('strong', 'weak')),
	reason text check (reason ~ '\S'),
	unique (party_id, from_stage, to_stage, activity_id),
	constraint lead_stage_move_has_evidence check (to_stage = 'archived' or (activity_id is not null and evidence_ref is not null)),
	foreign key (activity_id, party_id) references activity_about (activity_id, party_id) deferrable initially deferred,
	constraint lead_stage_move_changes_stage check (from_stage <> to_stage),
	constraint lead_stage_move_archive_reason check (to_stage <> 'archived' or reason is not null),
	foreign key (role, from_stage) references stage,
	foreign key (role, to_stage) references stage,
	foreign key (party_id, role) references party_role deferrable initially deferred
);

create function apply_lead_stage_move() returns trigger
language plpgsql as $$
begin
	if new.changed_by_job is not null and (new.strength = 'weak' or new.to_stage = 'archived') then
		raise exception 'weak evidence and archiving wait for a direct user'
			using errcode = 'check_violation', constraint = 'lead_stage_move_needs_user';
	end if;
	if new.changed_by_job is not null and new.changed_for_user_id is null and not (
		new.from_stage = 'new' and new.to_stage = 'qualified'
		or new.from_stage = 'qualified' and new.to_stage = 'outreach_active'
		or new.from_stage = 'outreach_active' and new.to_stage = 'engaged'
		or new.from_stage = 'engaged' and new.to_stage in ('nurture', 'opportunity')) then
		raise exception 'a job follows the lead funnel'
			using errcode = 'check_violation', constraint = 'lead_stage_move_job_funnel';
	end if;
	-- The conditional update holds the lead, so a stale proposal cannot overwrite another move.
	update party_role set stage = new.to_stage
	where party_id = new.party_id and role = 'lead' and stage = new.from_stage;
	if not found then
		raise exception 'the lead has moved since this evidence was proposed'
			using errcode = 'check_violation', constraint = 'lead_stage_move_current_stage';
	end if;
	return null;
end $$;

create trigger apply_lead_stage_move after insert on lead_stage_move
	for each row execute function apply_lead_stage_move();

create function lead_stage_needs_evidence() returns trigger
language plpgsql as $$
begin
	if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then return null; end if;
	-- The matching stamp identifies evidence applied by this actor in this transaction.
	if (tg_op = 'UPDATE' and new.changed_by_job is not null and new.changed_for_user_id is null or new.stage = 'archived')
		and not exists (select from lead_stage_move m
			where m.party_id = new.party_id and m.from_stage = old.stage and m.to_stage = new.stage
				and m.changed_at = now()
				and m.changed_by_user_id is not distinct from new.changed_by_user_id
				and m.changed_by_job is not distinct from new.changed_by_job) then
		raise exception 'a job stage move or an archive needs its applied evidence'
			using errcode = 'check_violation', constraint = 'lead_stage_needs_evidence';
	end if;
	return null;
end $$;

create trigger lead_stage_needs_evidence after insert or update of stage on party_role
	for each row when (new.role = 'lead')
	execute function lead_stage_needs_evidence();

create table next_step (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	what text not null,
	item_title text,
	item_bullets jsonb not null default '[]',
	source_ref text,
	owner_party_id uuid references party,
	due_on date,
	hold_until date,
	done_at timestamptz,
	resolution text check (resolution in ('done', 'cancelled', 'expired')),
	resolved_at timestamptz,
	resolution_reason text check (resolution_reason is null or btrim(resolution_reason) <> ''),
	resolution_event_id uuid,
	status text generated always as (coalesce(resolution, 'open')) stored,
	deal_id uuid references deal,
	party_id uuid references party,
	property_id uuid references property,
	call_activity_id uuid,
	call_kind text generated always as ('call') stored,
	call_evidence_quote text check (call_evidence_quote ~ '\S'),
	call_contact_party_id uuid references party,
	home_step_id uuid generated always as (case when call_activity_id is null then id end) stored unique,
	home_call_follow_up_id uuid generated always as (case when call_activity_id is not null then id end) stored unique,
	unique (id, deal_id),
	foreign key (call_activity_id, call_kind) references activity (id, kind),
	foreign key (call_activity_id, deal_id) references activity_about (activity_id, deal_id),
	constraint next_step_call_source check (
		(call_activity_id is null and call_evidence_quote is null and call_contact_party_id is null)
		or (call_activity_id is not null and deal_id is not null and call_evidence_quote is not null)),
	constraint next_step_item_shape check (item_title is null or (deal_id is not null
		and cardinality(regexp_split_to_array(btrim(item_title), '\s+')) between 2 and 4
		and source_ref is not null and btrim(source_ref) <> '' and jsonb_typeof(item_bullets) = 'array')),
	constraint next_step_one_record check (num_nonnulls(deal_id, party_id, property_id) = 1),
	constraint next_step_done_time check (done_at is null or status = 'done'),
	constraint next_step_resolution_time check (resolved_at is null or status in ('cancelled', 'expired')),
	constraint next_step_cancellation_reason check ((status = 'cancelled') = (resolution_reason is not null)),
	constraint next_step_resolution_event check (resolution_event_id is null or status <> 'open')
);

create unique index next_step_one_open_per_owner on next_step (deal_id, party_id, owner_party_id)
	nulls not distinct where status = 'open' and item_title is null and owner_party_id is not null and property_id is null;

create function next_step_default_owner() returns trigger
language plpgsql as $$
begin
	new.owner_party_id := nullif(current_setting('engine.user_id', true), '')::uuid;
	return new;
end $$;

create trigger next_step_default_owner before insert on next_step
	for each row when (new.owner_party_id is null) execute function next_step_default_owner();

-- A reopened step forgets the old event that closed it; its history keeps it.
create function next_step_reopened() returns trigger
language plpgsql as $$
begin
	new.resolution_event_id := null;
	return new;
end $$;

create trigger next_step_reopened before update of resolution on next_step
	for each row when (new.resolution is null) execute function next_step_reopened();

-- A hold ends on the partners' day in Central time, as today's system ends it.
create view home_next_step with (security_invoker = true) as
	select * from next_step where status = 'open'
		and (hold_until is null or hold_until <= (now() at time zone 'America/Chicago')::date);

-- Each user's own preferences. A user without a row has chosen nothing yet.
create function is_time_zone(zone text) returns boolean
language sql stable
return exists (select from pg_timezone_names where name = zone);

create domain time_zone as text constraint time_zone_known check (is_time_zone(value));

create table user_preference (
	user_id uuid primary key references app_user,
	created_at timestamptz not null default now(),
	time_zone time_zone not null,
	-- Notifications wait through quiet hours, in the user's time zone, which may run past midnight.
	quiet_from time,
	quiet_until time,
	push_to_device boolean not null default false,
	constraint user_preference_quiet_hours check ((quiet_from is null) = (quiet_until is null) and quiet_from <> quiet_until)
);

create table home_update (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references app_user,
	deal_id uuid not null references deal,
	kind text not null default 'update' check (kind in ('update', 'tour_feedback')),
	what text not null check (what ~ '\S'),
	checklist_item_ref text check (checklist_item_ref ~ '\S'),
	due_on date,
	property_id uuid references property,
	created_at timestamptz not null default now(),
	held_until timestamptz,
	read_at timestamptz check (read_at >= created_at),
	constraint home_update_checklist_due_date check ((checklist_item_ref is null) = (due_on is null)
		and (kind = 'update' or checklist_item_ref is null)),
	constraint home_update_property_kind check (property_id is null or kind = 'tour_feedback'),
	unique (user_id, deal_id, checklist_item_ref, due_on),
	unique (id, user_id)
);

-- Current alerted attention reason per open deal; cleared when attention clears so a returning reason alerts again.
create table deal_attention_alert (
	deal_id uuid primary key references deal on delete cascade,
	reason text not null check (reason ~ '\S'),
	owner_user_id uuid not null references app_user,
	alerted_at timestamptz not null default now()
);

-- A step is marked through just one key, even when a call produced it.
create table home_mark (
	user_id uuid not null references app_user,
	next_step_id uuid references next_step (home_step_id),
	call_follow_up_id uuid references next_step (home_call_follow_up_id),
	home_update_id uuid,
	proposal_id uuid,
	reply_draft_id uuid,
	item_id uuid generated always as (coalesce(next_step_id, call_follow_up_id, home_update_id, proposal_id, reply_draft_id)) stored,
	item_kind text generated always as (
		case when next_step_id is not null then 'next_step'
			when call_follow_up_id is not null then 'call_follow_up'
			when home_update_id is not null then 'home_update'
			when proposal_id is not null then 'proposal'
			when reply_draft_id is not null then 'reply_draft' end) stored,
	created_at timestamptz not null default now(),
	disposition text check (disposition in ('snoozed', 'dropped')),
	snoozed_until timestamptz,
	drop_reason text check (drop_reason ~ E'[^\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'),
	waiting_on_party_id uuid references party,
	waiting_reason text check (waiting_reason ~ '\S'),
	primary key (user_id, item_kind, item_id),
	foreign key (home_update_id, user_id) references home_update (id, user_id),
	constraint home_mark_one_item check (num_nonnulls(next_step_id, call_follow_up_id, home_update_id, proposal_id, reply_draft_id) = 1),
	constraint home_mark_snoozed_until check ((disposition is not distinct from 'snoozed') = (snoozed_until is not null)),
	constraint home_mark_drop_reason check ((disposition is not distinct from 'dropped') = (drop_reason is not null)
		and (disposition is distinct from 'dropped' or waiting_on_party_id is null)),
	constraint home_mark_drop_kind check (disposition is distinct from 'dropped' or item_kind in ('call_follow_up', 'home_update', 'reply_draft')),
	constraint home_mark_waiting_has_a_reason check ((waiting_on_party_id is null) = (waiting_reason is null)),
	constraint home_mark_marks_something check (disposition is not null or waiting_on_party_id is not null)
);

create function home_mark_dropped_final() returns trigger
language plpgsql as $$
begin
	raise exception 'a dropped Home item stays dropped'
		using errcode = 'check_violation', constraint = 'home_mark_dropped_final';
end $$;

create trigger home_mark_dropped_final before update or delete on home_mark
	for each row when (old.disposition = 'dropped') execute function home_mark_dropped_final();

-- Suggestions from mail, calls and meetings share one decision queue, including weak lead moves.
create table proposal (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	kind text not null check (kind in ('next_step', 'next_step_done', 'phase_move', 'new_lead', 'lead_stage_move', 'file_to_deal', 'possible_new_deal', 'email_lead', 'log_call', 'workflow_step')),
	activity_id uuid,
	activity_kind text constraint proposal_activity_kind_check
		check (activity_kind in ('email', 'call', 'meeting') or (activity_kind = 'note' and kind = 'next_step_done')),
	candidate_id uuid unique references candidate,
	evidence text not null check (evidence ~ '\S'),
	proposed_by_job text not null references job,
	status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed', 'superseded')),
	decided_by_user_id uuid references app_user,
	decided_at timestamptz,
	superseded_reason text,
	deal_id uuid references deal,
	next_step_id uuid,
	held_deal_id uuid generated always as (case when kind = 'next_step_done' then deal_id end) stored,
	call_deal_id uuid generated always as (case when kind in ('next_step', 'log_call') and activity_kind = 'call' then deal_id end) stored,
	step_seen_at timestamptz,
	keeps_deal_date boolean not null default false,
	party_id uuid references party,
	property_id uuid references property,
	what text check (what ~ '\S'),
	owner_party_id uuid references party,
	due_on date,
	due_source text constraint proposal_due_source check (due_source is null or
		(kind = 'next_step' and due_on is not null and due_source in ('stated', 'defaulted'))),
	merged_step_id uuid constraint proposal_merged_step references next_step,
	constraint proposal_merged_step_decided check (merged_step_id is null or
		(kind = 'next_step' and status = 'accepted')),
	from_phase text references phase,
	to_phase text references phase,
	phase_stated boolean not null default false,
	phase_on date,
	lead_role text generated always as ('lead') stored,
	from_stage text,
	to_stage text,
	how_found text references how_found,
	strength text check (strength in ('strong', 'weak')),
	reason text check (reason ~ '\S'),
	foreign key (activity_id, activity_kind) references activity (id, kind),
	foreign key (activity_id, party_id) references activity_about (activity_id, party_id) deferrable initially deferred,
	foreign key (next_step_id, deal_id) references next_step (id, deal_id),
	foreign key (activity_id, held_deal_id) references activity_about (activity_id, deal_id) deferrable initially deferred,
	foreign key (activity_id, call_deal_id) references activity_about (activity_id, deal_id) deferrable initially deferred,
	foreign key (lead_role, from_stage) references stage (role, slug),
	foreign key (lead_role, to_stage) references stage (role, slug),
	constraint proposal_source check (case
		when kind = 'email_lead' then candidate_id is not null and activity_id is null and activity_kind is null
		when kind = 'workflow_step' then candidate_id is null and activity_id is null and activity_kind is null
		else candidate_id is null and activity_id is not null and activity_kind is not null end),
	constraint proposal_one_record check (num_nonnulls(deal_id, party_id, property_id, candidate_id) = case when kind = 'possible_new_deal' then 0 else 1 end),
	filed_deal_id uuid references deal,
	filing_scope text constraint proposal_filing_scope check (filing_scope is null or (
		kind = 'possible_new_deal' and proposed_by_job = 'mail_capture' and filing_scope in ('deal', 'vendor', 'both')
		and (filing_scope <> 'vendor' or filed_deal_id is null))),
	filed_vendor_id uuid references party constraint proposal_filed_vendor check (filed_vendor_id is null or (
		status = 'accepted' and filed_deal_id is null and (filing_scope in ('vendor', 'both')) is true)),
	filing_reason text check (filing_reason ~ '\S'),
	dismiss_reason text check (dismiss_reason ~ E'[^\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'),
	constraint proposal_filing_decision check ((filed_deal_id is null and filing_reason is null) or (status = 'accepted' and kind in ('file_to_deal', 'possible_new_deal'))),
	constraint proposal_dismiss_reason check (dismiss_reason is null or status = 'dismissed'),
	constraint proposal_decision_whole check (
		(status = 'pending' and decided_by_user_id is null and decided_at is null)
		or (status in ('accepted', 'dismissed') and decided_by_user_id is not null and decided_at is not null)
		or (status = 'superseded' and decided_at is not null and kind in ('file_to_deal', 'possible_new_deal'))),
	constraint proposal_superseded_reason check (
		superseded_reason is not distinct from case when status = 'superseded' then
			case when decided_by_user_id is null then 'Moved to Leads' else 'Filing decided' end end),
	constraint proposal_stated_phase check (case when phase_stated then
		kind = 'phase_move' and activity_kind in ('call', 'meeting') else phase_on is null end),
	constraint proposal_held_step check (case when kind = 'next_step_done' then
		next_step_id is not null and step_seen_at is not null else next_step_id is null and step_seen_at is null end),
	constraint proposal_kept_date check (not keeps_deal_date or
		(kind = 'next_step_done' and status = 'accepted' and activity_kind in ('call', 'meeting'))),
	constraint proposal_payload check ((
		(kind = 'email_lead'
			and num_nonnulls(what, owner_party_id, due_on, from_phase, to_phase, from_stage, to_stage, how_found, reason, strength) = 0)
		or (kind in ('file_to_deal', 'possible_new_deal') and activity_kind = 'email'
			and (kind <> 'file_to_deal' or deal_id is not null)
			and num_nonnulls(what, owner_party_id, due_on, from_phase, to_phase, from_stage, to_stage, how_found, reason, strength) = 0)
		or (kind = 'next_step' and what is not null and num_nonnulls(from_phase, to_phase, from_stage, to_stage, how_found, reason, strength) = 0)
		or (kind = 'workflow_step' and deal_id is not null and what is not null
			and num_nonnulls(from_phase, to_phase, from_stage, to_stage, how_found, reason, strength) = 0)
		or (kind = 'log_call' and activity_kind = 'call' and property_id is null and what is not null
			and num_nonnulls(owner_party_id, due_on, from_phase, to_phase, from_stage, to_stage, how_found, reason, strength) = 0)
		or (kind = 'next_step_done' and deal_id is not null and activity_kind in ('note', 'call', 'meeting')
			and num_nonnulls(what, owner_party_id, due_on, from_phase, to_phase, from_stage, to_stage, how_found, reason, strength) = 0)
		or (kind = 'phase_move' and deal_id is not null and to_phase is not null
			and from_phase is distinct from to_phase and (to_phase <> 'dead' or reason is not null)
			and num_nonnulls(what, owner_party_id, due_on, from_stage, to_stage, how_found, strength) = 0)
		or (kind = 'new_lead' and party_id is not null and to_stage = 'new' and how_found is not null
			and num_nonnulls(what, owner_party_id, due_on, from_phase, to_phase, from_stage, reason, strength) = 0)
		or (kind = 'lead_stage_move' and strength is not null and party_id is not null and from_stage is not null and to_stage is not null
			and from_stage <> to_stage and (to_stage <> 'archived' or reason is not null)
			and num_nonnulls(what, owner_party_id, due_on, from_phase, to_phase, how_found) = 0)) is true)
);

create unique index proposal_source_payload_once on proposal
	(activity_id, kind, deal_id, party_id, property_id, from_phase, to_phase, from_stage, to_stage, what, owner_party_id, due_on, how_found, phase_stated, phase_on, next_step_id)
	nulls not distinct where activity_id is not null;

create unique index proposal_one_pending_workflow_step on proposal (deal_id)
	where kind = 'workflow_step' and status = 'pending';

create function deal_filing_reason(email_id uuid, selected_deal_id uuid) returns text
language sql as $$
	select case
		when exists (select from activity_about where activity_id = email_id and deal_id <> selected_deal_id)
			then 'another_deal'
		when not exists (
			select from deal_party d join activity_about a on a.party_id = d.party_id
			where d.deal_id = selected_deal_id and d.role = 'client' and a.activity_id = email_id
		) then 'different_client'
	end;
$$;

create function decide_proposal() returns trigger
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
		if new.kind = 'workflow_step' and acting_job <> 'workflow_suggestions' then
			raise exception 'the workflow suggestions job proposes the next checklist step'
				using errcode = 'check_violation', constraint = 'workflow_step_proposal_source';
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
		if exists (select from activity where id = new.activity_id and changed_by_job = 'old_system'
			and changed_by_user_id is null and changed_for_user_id is null) then
			insert into activity (id, kind, happened_at, summary)
			select new.id, 'note', happened_at, new.what from activity where id = new.activity_id;
			insert into activity_about (activity_id, deal_id, party_id)
			values (new.id, new.deal_id, new.party_id);
		else
			update activity set summary = case when summary is null or summary = '' then new.what
				else summary || E'\n\n' || new.what end
			where id = new.activity_id;
		end if;
	when 'next_step', 'workflow_step' then
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

create trigger decide_proposal before insert or update of status, filed_deal_id, filed_vendor_id, filing_reason, dismiss_reason on proposal
	for each row when (new.status <> 'superseded' and new.filed_vendor_id is null) execute function decide_proposal();

create function decide_vendor_filing() returns trigger
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

create trigger decide_vendor_filing before insert or update of status, filed_deal_id, filed_vendor_id, filing_reason, dismiss_reason on proposal
	for each row when (new.filed_vendor_id is not null) execute function decide_vendor_filing();

create function supersede_filing() returns trigger
language plpgsql as $$
declare
	acting_job text := nullif(current_setting('engine.job', true), '');
	acting_user uuid := nullif(current_setting('engine.user_id', true), '');
begin
	if tg_op <> 'UPDATE' or old.status <> 'pending'
		or new.kind not in ('file_to_deal', 'possible_new_deal') then
		raise exception 'only a pending filing can be superseded'
			using errcode = 'check_violation', constraint = 'proposal_final';
	end if;
	if acting_job is null and acting_user is not null and exists (
		select from proposal p where p.activity_id = new.activity_id
			and p.kind in ('file_to_deal', 'possible_new_deal') and p.status in ('accepted', 'dismissed')
			and p.decided_by_user_id = acting_user
	) then
		new.decided_by_user_id := acting_user;
		new.superseded_reason := 'Filing decided';
	elsif acting_job = 'mail_capture' and exists (select from lead_email_source where activity_id = new.activity_id) then
		new.superseded_reason := 'Moved to Leads';
	else
		raise exception 'the email needs a filing decision or a lead link'
			using errcode = 'check_violation', constraint = 'proposal_filing_supersede';
	end if;
	new.decided_at := clock_timestamp();
	return new;
end $$;

create trigger supersede_filing before insert or update of status, filed_deal_id, filing_reason, dismiss_reason on proposal
	for each row when (new.status = 'superseded') execute function supersede_filing();

create function settle_filing_proposals() returns trigger
language plpgsql as $$
begin
	update proposal set status = 'superseded'
	where activity_id = new.activity_id and status = 'pending' and kind in ('file_to_deal', 'possible_new_deal');
	return null;
end $$;

create trigger settle_filing_proposals after update of status on proposal
	for each row when (old.status = 'pending' and new.status in ('accepted', 'dismissed')
		and new.kind in ('file_to_deal', 'possible_new_deal'))
	execute function settle_filing_proposals();

-- A call's resolution can keep the current date until a new ordinary step takes its place.
create view deal_next_date with (security_invoker = true) as
	select distinct on (s.deal_id) s.deal_id, s.due_on from next_step s
	where s.deal_id is not null and s.item_title is null and (s.status = 'open' or exists (
		select from proposal p where p.next_step_id = s.id and p.keeps_deal_date and p.decided_at = s.done_at
		and not exists (select from next_step newer where newer.deal_id = s.deal_id
			and newer.item_title is null and newer.created_at > p.decided_at)))
	order by s.deal_id, s.created_at desc, s.id desc;

-- A reply to one email, which its owner's mailbox sends. An outreach draft is sent by hand.
create table reply_draft (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	email_activity_id uuid not null references email,
	owner_user_id uuid not null references app_user,
	proposed_by_job text not null references job,
	evidence text not null check (evidence ~ '\S'),
	subject text not null check (subject ~ '\S' and length(subject) <= 998),
	body text not null check (body ~ '\S'),
	-- The outbox keys each send on it, so every change its owner makes advances it and a recorded try never does.
	revision integer not null default 1 check (revision >= 1),
	status text not null default 'pending' check (status in ('pending', 'dismissed', 'approved', 'sent', 'failed')),
	decided_at timestamptz,
	dismiss_reason text check (dismiss_reason ~ E'[^\u0009-\u000D \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'),
	to_address email_address,
	cc_address email_address,
	sent_at timestamptz,
	-- The sending mailbox's id for the message, so one sent message settles one draft.
	sent_item_id text unique check (sent_item_id ~ '\S'),
	failure_reason text check (failure_reason ~ '\S'),
	unique (email_activity_id, owner_user_id),
	unique (id, owner_user_id),
	constraint reply_draft_delivery_facts check ((
		status = 'pending' and num_nonnulls(decided_at, dismiss_reason, to_address, cc_address, sent_at, sent_item_id, failure_reason) = 0
		or status = 'dismissed' and num_nonnulls(decided_at, dismiss_reason) = 2
			and num_nonnulls(to_address, cc_address, sent_at, sent_item_id, failure_reason) = 0
		or status in ('approved', 'sent', 'failed') and num_nonnulls(decided_at, to_address, cc_address) = 3 and dismiss_reason is null
			and (status = 'sent') = (sent_at is not null) and (status = 'sent') = (sent_item_id is not null)
			and (status = 'failed') = (failure_reason is not null)) is true)
);

alter table home_mark add foreign key (proposal_id) references proposal on delete cascade;
alter table home_mark add foreign key (reply_draft_id, user_id) references reply_draft (id, owner_user_id);

-- Rule 99 keeps any other failure failed, so the drop stays true of the draft.
create function home_mark_drops_failed_reply() returns trigger
language plpgsql as $$
begin
	if not exists (select from reply_draft where id = new.reply_draft_id and status = 'failed'
		and failure_reason not in ('aborted_before_dispatch', 'submission_recipients_invalid')
		and failure_reason !~ '^unconfirmed_after_[0-9]+$') then
		raise exception 'only a reply that failed for good is dropped from Home'
			using errcode = 'check_violation', constraint = 'home_mark_drops_failed_reply';
	end if;
	return new;
end $$;

create trigger home_mark_drops_failed_reply before insert or update on home_mark
	for each row when (new.disposition = 'dropped' and new.reply_draft_id is not null)
	execute function home_mark_drops_failed_reply();

create function reply_draft_delivery() returns trigger
language plpgsql as $$
declare
	acting_job text := nullif(current_setting('engine.job', true), '');
	acting_user uuid := nullif(current_setting('engine.user_id', true), '');
	by_owner boolean := acting_job is null and acting_user is not distinct from new.owner_user_id;
	editable constant text[] := array['subject', 'body', 'revision', 'changed_by_user_id', 'changed_by_job', 'changed_for_user_id', 'changed_at'];
begin
	if tg_op = 'INSERT' then
		if new.status <> 'pending' or new.revision <> 1 or acting_job is distinct from new.proposed_by_job then
			raise exception 'a job drafts a pending reply' using errcode = 'check_violation', constraint = 'reply_draft_starts_pending';
		end if;
		return new;
	end if;
	new.revision := old.revision + by_owner::integer;
	if (new.subject, new.body) is distinct from (old.subject, old.body)
		and not (by_owner and (old.status, new.status) in (('pending', 'pending'), ('pending', 'approved'), ('failed', 'approved'))) then
		raise exception 'only its owner edits a reply draft, before it goes out'
			using errcode = 'check_violation', constraint = 'reply_draft_owner_edits';
	end if;
	if by_owner and not (old.status = 'pending' or old.status = 'failed' and new.status = 'approved'
		and old.failure_reason in ('aborted_before_dispatch', 'submission_recipients_invalid')) then
		raise exception 'a reply draft is decided once and sent at most once'
			using errcode = 'check_violation', constraint = 'reply_draft_sent_once';
	end if;
	-- Only a failure before Send may be approved again; an unconfirmed try may only be found sent.
	-- A try keeps the recipients its owner approved.
	if new.status in ('sent', 'failed') and (new.to_address, new.cc_address) is distinct from (old.to_address, old.cc_address)
		or new.status = old.status and to_jsonb(new) - editable <> to_jsonb(old) - editable
		or new.status <> old.status and not (case old.status
			when 'pending' then new.status in ('approved', 'dismissed')
			when 'approved' then new.status in ('sent', 'failed')
			when 'failed' then new.status = 'approved' and old.failure_reason in ('aborted_before_dispatch', 'submission_recipients_invalid')
				or new.status = 'sent' and old.failure_reason ~ '^unconfirmed_after_[0-9]+$'
			else false end) then
		raise exception 'a reply draft is decided once and sent at most once'
			using errcode = 'check_violation', constraint = 'reply_draft_sent_once';
	end if;
	if new.status = old.status then
		return new;
	end if;
	if (case when new.status in ('sent', 'failed') then acting_job is null or acting_user is distinct from new.owner_user_id
		when new.status = 'dismissed' then acting_job is null and not by_owner
		else not by_owner end) then
		raise exception 'its owner decides a reply draft, and a job working for the owner records its delivery'
			using errcode = 'check_violation', constraint = 'reply_draft_owner_decides';
	end if;
	if new.status in ('approved', 'dismissed') then
		new.decided_at := now();
	end if;
	return new;
end $$;

create trigger reply_draft_delivery before insert or update on reply_draft
	for each row execute function reply_draft_delivery();

create table document (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	name text not null,
	r2_key text not null check (r2_key ~ '\S'),
	r2_bucket text not null default 'post_media' check (r2_bucket in ('post_media', 'deal_documents')),
	-- Read from the file's own bytes when it is stored.
	content_type text,
	-- A partner's note on a prepared file.
	note text check (note ~ '\S'),
	unique (id, content_type)
);

create unique index document_r2_bucket_r2_key_key on document (r2_bucket, r2_key)
	where r2_bucket <> 'deal_documents' or r2_key not like 'sha256/%';

create table document_kind (slug text primary key, label text not null);

-- Deal files share documents with email attachments and post media; a replacement keeps the earlier bytes.
alter table document
	add deal_id uuid references deal,
	add kind text references document_kind,
	add version integer not null default 1 check (version >= 1),
	add supersedes_id uuid unique,
	add previous_version integer generated always as (nullif(version - 1, 0)) stored,
	add sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
	add bytes bigint check (bytes > 0),
	add unique (id, deal_id),
	add unique (id, deal_id, kind, version),
	add constraint document_deal_file_whole check (
		(deal_id is null and kind is null and version = 1 and supersedes_id is null)
		or (deal_id is not null and kind is not null and content_type ~ '\S'
			and content_type is not null and sha256 is not null and bytes is not null)),
	add constraint document_version_has_predecessor check ((version = 1) = (supersedes_id is null)),
	add constraint document_previous_version foreign key (supersedes_id, deal_id, kind, previous_version)
		references document (id, deal_id, kind, version);

create unique index document_deal_hash on document (deal_id, sha256)
	where r2_bucket = 'deal_documents' and r2_key like 'sha256/%';

create table email_document (
	email_activity_id uuid not null references email,
	document_id uuid not null references document,
	created_at timestamptz not null default now(),
	primary key (email_activity_id, document_id)
);

create function document_filed_once() returns trigger
language plpgsql as $$
begin
	-- Generated columns have no NEW value yet; the stamp runs after this trigger.
	if old.deal_id is not null and old.kind = 'other' and new.kind <> 'other'
		and nullif(current_setting('engine.job', true), '') is null
		and nullif(current_setting('engine.user_id', true), '') is not null
		and to_jsonb(new) - array['kind', 'previous_version'] = to_jsonb(old) - array['kind', 'previous_version'] then
		return new;
	end if;
	if old.deal_id is not null or new.deal_id is null
		or old.content_type is not null and new.content_type is distinct from old.content_type
		or old.sha256 is not null and new.sha256 is distinct from old.sha256
		or old.bytes is not null and new.bytes is distinct from old.bytes then
		raise exception 'an attachment is filed to a deal once; stored file metadata never changes'
			using errcode = 'check_violation', constraint = 'document_filed_once';
	end if;
	return new;
end $$;

create trigger document_filed_once before update on document
	for each row when ((old.deal_id, old.kind, old.content_type, old.sha256, old.bytes)
		is distinct from (new.deal_id, new.kind, new.content_type, new.sha256, new.bytes))
	execute function document_filed_once();

-- A party's own files, such as a client's before any deal. One stored file may belong to several parties and a deal.
create table party_document (
	party_id uuid not null references party,
	document_id uuid not null references document,
	created_at timestamptz not null default now(),
	primary key (party_id, document_id)
);

-- Stored metadata never changes once known, so checking it on insert holds for good.
create function party_document_stored() returns trigger
language plpgsql as $$
begin
	if not exists (select from document
		where id = new.document_id and content_type ~ '\S' and sha256 is not null and bytes is not null) then
		raise exception 'a party file is a stored file with its type, hash and size'
			using errcode = 'check_violation', constraint = 'party_document_stored';
	end if;
	return new;
end $$;

create trigger party_document_stored before insert on party_document
	for each row execute function party_document_stored();

-- A reply draft's attachments are part of what its owner approves, so they change only while its text may.
create table reply_draft_document (
	reply_draft_id uuid not null references reply_draft,
	document_id uuid not null references document,
	created_at timestamptz not null default now(),
	primary key (reply_draft_id, document_id)
);

create function reply_draft_document_owner_edits() returns trigger
language plpgsql as $$
declare
	draft reply_draft;
begin
	select * into draft from reply_draft where id = coalesce(new.reply_draft_id, old.reply_draft_id);
	if not (nullif(current_setting('engine.job', true), '') is null
		and nullif(current_setting('engine.user_id', true), '')::uuid is not distinct from draft.owner_user_id
		and (draft.status = 'pending' or draft.status = 'failed' and draft.failure_reason in ('aborted_before_dispatch', 'submission_recipients_invalid'))) then
		raise exception 'only its owner attaches files to a reply draft, before it goes out'
			using errcode = 'check_violation', constraint = 'reply_draft_owner_edits';
	end if;
	return coalesce(new, old);
end $$;

create trigger reply_draft_document_owner_edits before insert or delete on reply_draft_document
	for each row execute function reply_draft_document_owner_edits();

-- One completed attempt, including no text or failure, belongs to the exact stored file version.
create table document_extraction (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	document_id uuid not null,
	deal_id uuid not null,
	extracted_at timestamptz not null,
	method text not null check (method ~ '\S'),
	extractor_version text not null check (extractor_version ~ '\S'),
	model text check (model ~ '\S'),
	text_format_version text not null check (text_format_version ~ '\S'),
	status text not null check (status in ('produced', 'no_text', 'unavailable', 'receipt_only')),
	pages text[] not null,
	receipt jsonb check (jsonb_typeof(receipt) = 'object'),
	foreign key (document_id, deal_id) references document (id, deal_id),
	unique nulls not distinct (document_id, method, extractor_version, model, text_format_version),
	constraint document_extraction_pages check (
		case when coalesce(array_ndims(pages), 1) = 1 then array_position(pages, null) is null else false end
		and cardinality(pages) <= 1000 and length(array_to_string(pages, '')) <= 500000),
	constraint document_extraction_status_matches_text check (
		(status = 'produced') = (translate(array_to_string(pages, ''), U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000', '') <> '')
		and (status not in ('unavailable', 'receipt_only') or cardinality(pages) = 0)
		and (status <> 'receipt_only' or receipt is not null))
);

create table offer (
	id uuid primary key default gen_random_uuid(),
	deal_id uuid not null,
	property_id uuid not null,
	round smallint not null check (round >= 1),
	answers_round smallint,
	from_party_id uuid not null,
	from_role text not null,
	offered_at timestamptz not null,
	expires_on date,
	status text not null default 'open'
		check (status in ('unknown', 'open', 'countered', 'accepted', 'rejected', 'withdrawn', 'superseded')),
	import_source text check (import_source ~ '^[a-z][a-z0-9_]*$'),
	import_id text check (import_id ~ '^\S(.*\S)?$'),
	import_record jsonb,
	constraint offer_import_whole check (num_nonnulls(import_source, import_id, import_record) in (0, 3)),
	constraint offer_unknown_only_imported check (status <> 'unknown' or import_source is not null),
	unique (import_source, import_id),
	rent_per_sf_yr numeric(10, 2) check (rent_per_sf_yr >= 0),
	nnn_per_sf_yr numeric(10, 2) check (nnn_per_sf_yr >= 0),
	term_months integer check (term_months >= 0),
	ti_per_sf numeric(10, 2) check (ti_per_sf >= 0),
	free_rent_months numeric(4, 1) check (free_rent_months >= 0),
	escalation_pct numeric(5, 2) check (escalation_pct >= 0),
	commencement_on date,
	commencement_days_after_delivery integer check (commencement_days_after_delivery >= 0),
	other_terms text,
	-- How the submarket stood when this round was sent. Null is not recorded, never balanced.
	submarket_condition text check (submarket_condition in ('soft', 'balanced', 'tight')),
	constraint offer_answers_earlier_round check (answers_round < round),
	constraint offer_commencement_date_or_days
		check (commencement_on is null or commencement_days_after_delivery is null),
	unique (deal_id, round),
	unique (id, deal_id),
	foreign key (deal_id, property_id) references deal_property,
	-- Only a merge changes a deal_party key, and its rounds move with it.
	foreign key (deal_id, from_party_id, from_role) references deal_party on update cascade,
	foreign key (deal_id, answers_round) references offer (deal_id, round)
);

-- An earlier accepted round is superseded before a revived deal accepts a new one.
create unique index offer_one_accepted_per_deal on offer (deal_id) where status = 'accepted';

create function offer_status_moves() returns trigger
language plpgsql as $$
begin
	if not (old.status = 'unknown'
		or old.status = 'open' and new.status not in ('unknown', 'superseded')
		or old.status = 'accepted' and new.status = 'superseded') then
		raise exception 'a round''s status moves out of unknown or open, or from accepted to superseded'
			using errcode = 'check_violation', constraint = 'offer_status_moves';
	end if;
	return new;
end $$;

create trigger offer_status_moves before update of status on offer
	for each row when (new.status is distinct from old.status) execute function offer_status_moves();

create function offer_superseded_by_later_acceptance() returns trigger
language plpgsql as $$
begin
	if not exists (
		select from offer
		where deal_id = new.deal_id and round > new.round and status = 'accepted'
	) then
		raise exception 'a round is superseded only when a later round of its deal is accepted'
			using errcode = 'check_violation', constraint = 'offer_superseded_by_later_acceptance';
	end if;
	return null;
end $$;

-- Deferred, because the earlier round is superseded before the later one can be accepted.
create constraint trigger offer_superseded_by_later_acceptance after insert or update of status on offer
	initially deferred for each row when (new.status = 'superseded')
	execute function offer_superseded_by_later_acceptance();

create table offer_document (
	offer_id uuid not null references offer,
	document_id uuid not null references document,
	created_at timestamptz not null default now(),
	primary key (offer_id, document_id)
);

-- What a side can claim about its own position, such as best and final. Like roles, a label can be renamed.
create table claim_type (
	-- A deadline is the round's expires_on, never a claim.
	slug text primary key check (slug <> 'deadline'),
	label text not null
);

-- What the side that sent a round claimed in it. History, like its documents; a claim heard later is added later.
create table offer_claim (
	offer_id uuid not null references offer,
	claim_type text not null references claim_type,
	created_at timestamptz not null default now(),
	-- The rent a side says it will not go past, when it differs from the round's own.
	floor_rent_per_sf_yr numeric(10, 2) check (floor_rent_per_sf_yr > 0),
	-- Their words, as near verbatim as heard.
	quote text check (quote ~ '\S'),
	note text check (note ~ '\S'),
	primary key (offer_id, claim_type)
);

create table space_need (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	deal_id uuid not null references deal,
	name text not null check (name ~ '\S'),
	min_sf numeric(10, 1) check (min_sf > 0 and min_sf <> 'NaN'::numeric),
	max_sf numeric(10, 1) check (max_sf > 0 and max_sf <> 'NaN'::numeric),
	space_type text check (space_type ~ '\S'),
	market_id uuid references market,
	max_rate_sf_yr numeric(10, 2) check (max_rate_sf_yr >= 0 and max_rate_sf_yr <> 'NaN'::numeric),
	vendor_id uuid,
	vendor_role text not null default 'vendor' check (vendor_role = 'vendor'),
	source_ref text check (source_ref ~ '\S'),
	source_revision text check (source_revision ~ '\S'),
	applicability text check (applicability ~ '\S'),
	constraint space_need_vendor_source_whole check (num_nonnulls(vendor_id, source_ref, source_revision, applicability) in (0, 4)),
	must_haves text check (must_haves ~ '\S'),
	constraint space_need_size_in_order check (max_sf >= min_sf),
	foreign key (vendor_id, vendor_role) references party_role on update cascade
);

create table suite (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	property_id uuid not null references property,
	label text check (label = btrim(label) and label ~ '\S'),
	floor integer,
	area_sf numeric(10, 1) check (area_sf > 0 and area_sf <> 'NaN'::numeric),
	area_basis text check (area_basis in ('rentable', 'usable', 'county_heated', 'listed_unverified')),
	condition text check (condition ~ '\S'),
	unique (property_id, label),
	-- Carries the building into the signed lease link.
	unique (id, property_id)
);

create table building_ownership (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	property_id uuid not null references property,
	party_id uuid not null references party,
	kind text not null check (kind in ('owner', 'landlord_rep', 'property_manager', 'listing_agent')),
	started_on date,
	ended_on date check (ended_on >= started_on),
	source text not null check (source ~ '\S'),
	unique nulls not distinct (property_id, party_id, kind, started_on)
);

create table lease (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	party_id uuid not null references party,
	property_id uuid not null references property,
	deal_id uuid unique references deal,
	client_role text not null default 'client' check (client_role = 'client'),
	unique (id, property_id),
	foreign key (deal_id, party_id, client_role) references deal_party on update cascade,
	foreign key (deal_id, property_id) references deal_property
);

alter table deal add renews_lease_id uuid references lease;
alter table deal add constraint deal_renewal_names_lease
	check ((reason is not distinct from 'renewal') = (renews_lease_id is not null));

create function deal_renews_another_lease() returns trigger
language plpgsql as $$
begin
	if exists (select from lease where id = new.renews_lease_id and deal_id = new.id) then
		raise exception 'a renewal is separate from the deal that negotiated its lease'
			using errcode = 'check_violation', constraint = 'deal_renews_another_lease';
	end if;
	return new;
end $$;

create trigger deal_renews_another_lease before insert or update on deal
	for each row when (new.renews_lease_id is not null) execute function deal_renews_another_lease();

-- Signed terms are their own history; an amendment is the next version, never an overwrite.
create table lease_version (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	lease_id uuid not null references lease,
	version integer not null check (version >= 1),
	previous_version integer generated always as (nullif(version - 1, 0)) stored,
	offer_id uuid,
	document_id uuid not null references document,
	executed_on date,
	commencement_on date,
	expiration_on date not null,
	rent_per_sf_yr numeric(10, 2) check (rent_per_sf_yr >= 0),
	nnn_per_sf_yr numeric(10, 2) check (nnn_per_sf_yr >= 0),
	term_months integer check (term_months > 0),
	ti_per_sf numeric(10, 2) check (ti_per_sf >= 0),
	free_rent_months numeric(4, 1) check (free_rent_months >= 0),
	escalation_pct numeric(5, 2) check (escalation_pct >= 0),
	rent_starts_on date,
	rent_days_after_delivery integer check (rent_days_after_delivery >= 0),
	expense_structure text check (expense_structure ~ '\S'),
	other_terms text,
	constraint lease_dates_in_order check (expiration_on > commencement_on and expiration_on >= executed_on),
	constraint lease_rent_date_or_days check (num_nonnulls(rent_starts_on, rent_days_after_delivery) <= 1),
	unique (lease_id, version),
	unique (id, lease_id),
	foreign key (lease_id, previous_version) references lease_version (lease_id, version),
	foreign key (offer_id) references offer
);

create table lease_suite (
	lease_version_id uuid not null,
	lease_id uuid not null,
	property_id uuid not null,
	suite_id uuid not null,
	created_at timestamptz not null default now(),
	primary key (lease_version_id, suite_id),
	foreign key (lease_version_id, lease_id) references lease_version (id, lease_id),
	foreign key (lease_id, property_id) references lease (id, property_id),
	foreign key (suite_id, property_id) references suite (id, property_id)
);

create function lease_from_accepted_offer() returns trigger
language plpgsql as $$
begin
	perform from offer o join lease l on l.id = new.lease_id
	where o.id = new.offer_id and o.status = 'accepted' and o.deal_id = l.deal_id and o.property_id = l.property_id
	for share of o;
	if not found then
		raise exception 'a lease names a round accepted when the lease is recorded'
			using errcode = 'check_violation', constraint = 'lease_from_accepted_offer';
	end if;
	return new;
end $$;

create trigger lease_from_accepted_offer before insert on lease_version
	for each row when (new.offer_id is not null) execute function lease_from_accepted_offer();

create table lease_option (
	lease_version_id uuid not null references lease_version,
	number smallint not null check (number > 0),
	created_at timestamptz not null default now(),
	kind text not null check (kind in ('renewal', 'expansion', 'early_termination')),
	notice_on date not null,
	terms text not null check (terms ~ '\S'),
	primary key (lease_version_id, number)
);

create function lease_option_before_expiration() returns trigger
language plpgsql as $$
begin
	if exists (select from lease_version where id = new.lease_version_id and new.notice_on > expiration_on) then
		raise exception 'an option notice is due no later than its lease expires'
			using errcode = 'check_violation', constraint = 'lease_option_before_expiration';
	end if;
	return new;
end $$;

create trigger lease_option_before_expiration before insert on lease_option
	for each row execute function lease_option_before_expiration();

create view current_lease as
select v.*, l.deal_id, l.party_id, l.property_id from lease_version v join lease l on l.id = v.lease_id
where not exists (select from lease_version newer where newer.lease_id = v.lease_id and newer.version > v.version);

create view lease_ending as
select c.* from current_lease c where not exists (
	select from deal d join lease l on l.deal_id = d.id join lease_version v on v.lease_id = l.id
	where d.renews_lease_id = c.lease_id
);

create table critical_date (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	deal_id uuid not null references deal,
	kind text not null check (kind in ('loi_expiry', 'option_notice', 'lease_commencement', 'rent_start', 'lease_end', 'due_diligence', 'phase_effective_date', 'other')),
	due_on date not null,
	source text not null check (source ~ '\S'),
	offer_id uuid,
	lease_version_id uuid,
	option_number smallint,
	document_id uuid references document,
	note text,
	status text not null default 'proposed' check (status in ('proposed', 'open', 'done', 'dropped', 'passed')),
	confirmed_by_user_id uuid references app_user,
	confirmed_at timestamptz,
	resolved_by_user_id uuid references app_user,
	resolved_at timestamptz,
	resolution_reason text check (resolution_reason ~ '\S'),
	constraint critical_date_one_source check (num_nonnulls(offer_id, lease_version_id, document_id) <= 1),
	constraint critical_date_option_on_lease check (option_number is null or lease_version_id is not null),
	constraint critical_date_confirmation_whole check (num_nonnulls(confirmed_by_user_id, confirmed_at) in (0, 2)),
	constraint critical_date_confirmed_when_real check (status not in ('open', 'done', 'passed') or confirmed_at is not null),
	constraint critical_date_resolution_whole check (
		num_nonnulls(resolved_by_user_id, resolved_at, resolution_reason) = case when status in ('done', 'dropped', 'passed') then 3 else 0 end),
	foreign key (offer_id, deal_id) references offer (id, deal_id),
	foreign key (lease_version_id) references lease_version,
	foreign key (lease_version_id, option_number) references lease_option (lease_version_id, number)
);

-- Generated proposals repeat by their immutable source; hand-added dates may share a day.
create unique index critical_date_generated_once on critical_date (deal_id, kind, offer_id, lease_version_id, option_number)
	nulls not distinct where offer_id is not null or lease_version_id is not null;

create function critical_date_transition() returns trigger
language plpgsql as $$
declare
	acting_user uuid := nullif(current_setting('engine.user_id', true), '');
begin
	if tg_op = 'INSERT' then
		if new.lease_version_id is not null and not exists (
			select from lease_version v join lease l on l.id = v.lease_id join deal d on d.id = new.deal_id
			where v.id = new.lease_version_id and (l.deal_id = d.id or d.renews_lease_id = l.id)
		) then
			raise exception 'a critical date names a lease its deal negotiated or renews'
				using errcode = 'check_violation', constraint = 'critical_date_lease_on_deal';
		end if;
		if new.status <> 'proposed' or num_nonnulls(new.confirmed_by_user_id, new.confirmed_at,
			new.resolved_by_user_id, new.resolved_at, new.resolution_reason) <> 0 then
			raise exception 'a critical date starts as a proposal'
				using errcode = 'check_violation', constraint = 'critical_date_starts_proposed';
		end if;
		return new;
	end if;
	if new.status = old.status and new.resolution_reason is not distinct from old.resolution_reason then
		return new;
	end if;
	if acting_user is null or nullif(current_setting('engine.job', true), '') is not null then
		raise exception 'only a user confirms or resolves a critical date'
			using errcode = 'check_violation', constraint = 'critical_date_user_decides';
	end if;
	if not (old.status = 'proposed' and new.status in ('open', 'dropped')
		or old.status = 'open' and new.status in ('done', 'dropped', 'passed')) then
		raise exception 'a proposal is confirmed or dropped, and an open date is resolved once'
			using errcode = 'check_violation', constraint = 'critical_date_status_moves';
	end if;
	if new.status = 'open' then
		new.confirmed_by_user_id := acting_user;
		new.confirmed_at := now();
	else
		new.resolved_by_user_id := acting_user;
		new.resolved_at := now();
	end if;
	return new;
end $$;

create trigger critical_date_transition before insert or update on critical_date
	for each row execute function critical_date_transition();

create function propose_critical_dates(wanted uuid) returns void
language sql
begin atomic
	insert into critical_date (deal_id, kind, due_on, source, lease_version_id, option_number)
	select wanted, dates.kind, dates.due_on, 'Signed lease', l.id, null
	from current_lease l cross join lateral (values ('lease_end', l.expiration_on), ('rent_start', l.rent_starts_on)) dates(kind, due_on)
	where (l.deal_id = wanted or l.lease_id = (select renews_lease_id from deal where id = wanted)) and dates.due_on is not null and (dates.kind <> 'rent_start' or l.deal_id = wanted)
	on conflict do nothing;
	insert into critical_date (deal_id, kind, due_on, source, lease_version_id, option_number)
	select wanted, 'option_notice', o.notice_on, 'Signed lease option', l.id, o.number
	from current_lease l join lease_option o on o.lease_version_id = l.id where l.deal_id = wanted or l.lease_id = (select renews_lease_id from deal where id = wanted)
	on conflict do nothing;
	insert into critical_date (deal_id, kind, due_on, source, offer_id)
	select deal_id, 'loi_expiry', expires_on, 'Offer round', id from offer
	where deal_id = wanted and expires_on is not null and status = 'open'
	on conflict do nothing;
end;

create function activity_entry(a activity) returns jsonb
language sql stable
begin atomic
	select to_jsonb(a) - 'calendar_review_key' - 'calendar_review_user_id' - 'call_owner_user_id' || jsonb_build_object('email', (
		select to_jsonb(e) - array['activity_id', 'activity_kind', 'imported', 'conversation_id', 'authored', 'history'] || jsonb_build_object('documents', (
			select coalesce(jsonb_agg(to_jsonb(doc) order by doc.name, doc.id), '[]')
			from email_document ed join document doc on doc.id = ed.document_id
			where ed.email_activity_id = e.activity_id
		)) from email e where e.activity_id = a.id
	));
end;

-- "Account" alone means a national account (docs/glossary.md).
create table social_account (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	platform text not null check (platform in ('x', 'linkedin', 'facebook', 'instagram')),
	owner_party_id uuid not null references party,
	handle text not null check (handle ~ '\S'),
	platform_account_id text check (platform_account_id ~ '\S'),
	-- One publisher per account per minute: the engine publishes posts scheduled from this time, and none means never.
	engine_publishes_from timestamptz,
	unique (id, platform),
	unique (id, platform_account_id),
	unique (platform, platform_account_id)
);

-- Platforms ignore case in handles.
create unique index social_account_one_per_handle on social_account (platform, lower(handle));

-- The token lives in Workers KV, never in the database.
create table social_sign_in (
	social_account_id uuid not null,
	platform_account_id text not null,
	signed_in_by_user_id uuid not null references app_user,
	signed_in_at timestamptz not null default now(),
	-- None for a sign-in that does not expire, such as a Facebook Page's.
	expires_at timestamptz check (expires_at > signed_in_at),
	scopes text[] not null,
	primary key (social_account_id, signed_in_at),
	foreign key (social_account_id, platform_account_id) references social_account (id, platform_account_id)
);

-- The seed is a guess until checked against each platform's API.
create table platform_metric (
	platform text not null check (platform in ('x', 'linkedin', 'facebook', 'instagram')),
	metric text not null
		check (metric in ('views', 'reactions', 'comments', 'shares', 'saves', 'clicks', 'follows')),
	-- Day 7 asks this metric only of posts published since, so adding one keeps older posts compared.
	reported_since timestamptz not null default now(),
	primary key (platform, metric)
);

insert into platform_metric
select platform, unnest(metrics), '-infinity' from (values
	('x', array['views', 'reactions', 'comments', 'shares', 'clicks', 'follows']),
	('linkedin', array['views', 'reactions', 'comments', 'shares', 'clicks', 'follows']),
	('facebook', array['views', 'reactions', 'comments', 'shares', 'clicks']),
	('instagram', array['views', 'reactions', 'comments', 'shares', 'saves', 'follows'])
) as reported (platform, metrics);

create table idea (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	angle text not null,
	hook text not null,
	pillar text not null
);

create table design_template (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	name text not null unique
);

-- A photo set is several photos or a carousel, a document is a PDF carousel, and an Instagram video is a Reel.
create table platform_format (
	platform text not null check (platform in ('x', 'linkedin', 'facebook', 'instagram')),
	format text not null check (format in ('text', 'photo', 'photo_set', 'document', 'video')),
	primary key (platform, format)
);

insert into platform_format
select platform, unnest(formats) from (values
	('x', array['text', 'photo', 'photo_set', 'video']),
	('linkedin', array['text', 'photo', 'photo_set', 'document', 'video']),
	('facebook', array['text', 'photo', 'video']),
	('instagram', array['photo', 'photo_set', 'video'])
) as offered (platform, formats);

create table post (
	id uuid primary key default gen_random_uuid(),
	social_account_id uuid not null,
	platform text not null,
	format text not null,
	idea_id uuid references idea,
	design_template_id uuid references design_template,
	scheduled_at timestamptz not null,
	status text not null default 'scheduled'
		check (status in ('scheduled', 'publishing', 'published', 'failed', 'cancelled')),
	reason text check (reason ~ '\S'),
	platform_post_id text,
	published_at timestamptz,
	constraint post_published_has_id_and_time
		check (num_nonnulls(platform_post_id, published_at) = case status when 'published' then 2 else 0 end),
	constraint post_failed_or_cancelled_says_why check ((status in ('failed', 'cancelled')) = (reason is not null)),
	unique (social_account_id, platform_post_id),
	unique (id, platform),
	unique (id, format),
	foreign key (social_account_id, platform) references social_account (id, platform),
	foreign key (platform, format) references platform_format
);

create function post_final() returns trigger
language plpgsql as $$
begin
	raise exception 'a published, failed or cancelled post never changes'
		using errcode = 'check_violation', constraint = 'post_final';
end $$;

-- A retry is a new post, so a failure stays on record, and a published post keeps the time its readings count from.
create trigger post_final before update on post
	for each row when (old.status in ('published', 'failed', 'cancelled') and old.* is distinct from new.*)
	execute function post_final();

create function post_status_moves() returns trigger
language plpgsql as $$
begin
	if not (case tg_op
		when 'INSERT' then new.status not in ('publishing', 'cancelled')
		else old.status = new.status
			or old.status = 'scheduled' and new.status in ('publishing', 'cancelled')
			or old.status = 'publishing' and new.status in ('published', 'failed')
	end) then
		raise exception 'a post starts scheduled, published or failed, moves from scheduled to publishing or cancelled, and from publishing to published or failed'
			using errcode = 'check_violation', constraint = 'post_status_moves';
	end if;
	return new;
end $$;

-- Only the publisher's claim reaches publishing, so a post is sent at most once.
create trigger post_status_moves before insert or update of status on post
	for each row execute function post_status_moves();

create function post_engine_publishes_from() returns trigger
language plpgsql as $$
begin
	-- Shared, so the account's engine_publishes_from cannot move until this save ends.
	perform from social_account
	where id = new.social_account_id and engine_publishes_from <= new.scheduled_at
	for share;
	if not found then
		raise exception 'the engine holds only posts scheduled from its account''s engine_publishes_from'
			using errcode = 'check_violation', constraint = 'post_engine_publishes_from';
	end if;
	return new;
end $$;

-- Scheduled means the engine will publish it; a post another publisher sent is stored as published or failed.
create trigger post_engine_publishes_from before insert or update of status on post
	for each row when (new.status in ('scheduled', 'publishing')) execute function post_engine_publishes_from();

-- An edit is a new version, never an overwrite; the latest version is the one posted.
create table post_text (
	post_id uuid not null references post,
	version smallint not null check (version >= 1),
	body text not null check (body ~ '\S'),
	previous_version smallint generated always as (nullif(version - 1, 0)) stored,
	primary key (post_id, version),
	foreign key (post_id, previous_version) references post_text
);

create function post_text_before_review_closes() returns trigger
language plpgsql as $$
begin
	if not exists (select from post
		where id = new.post_id and status = 'scheduled' and now() < scheduled_at - interval '1 hour') then
		raise exception 'a post''s text is edited only while it is scheduled, until review closes an hour before its time'
			using errcode = 'check_violation', constraint = 'post_text_before_review_closes';
	end if;
	return new;
end $$;

create trigger post_text_before_review_closes before insert on post_text
	for each row when (new.version > 1) execute function post_text_before_review_closes();

-- Each file is a document in R2. Only a photo set has more than one.
create table post_media (
	post_id uuid not null,
	format text not null,
	position smallint not null check (position between 1 and 20),
	document_id uuid not null,
	content_type text not null,
	created_at timestamptz not null default now(),
	constraint post_media_fits_format check (format <> 'text' and (position = 1 or format = 'photo_set')),
	constraint post_media_type_fits_format check (case format
		when 'video' then content_type = 'video/mp4'
		when 'document' then content_type = 'application/pdf'
		else content_type in ('image/jpeg', 'image/png') end),
	primary key (post_id, position),
	foreign key (post_id, format) references post (id, format),
	foreign key (document_id, content_type) references document (id, content_type)
);

-- A post goes out unless cancelled. At review's close a post nobody edited or cancelled gets no_response.
create table post_review (
	post_id uuid not null references post,
	outcome text not null check (outcome in ('edited', 'cancelled', 'no_response')),
	text_version smallint check (text_version > 1),
	constraint post_review_edit_names_its_text check ((outcome = 'edited') = (text_version is not null)),
	unique (post_id, text_version),
	foreign key (post_id, text_version) references post_text
);

create unique index post_review_once on post_review (post_id, outcome) where outcome <> 'edited';

create function post_review_in_window() returns trigger
language plpgsql as $$
declare
	reviewed post;
begin
	-- Held, so an edit and the job writing no_response take turns on one post.
	select * into reviewed from post where id = new.post_id for update;
	if (new.outcome = 'no_response') <> (now() >= reviewed.scheduled_at - interval '1 hour')
		or exists (select from post_review
			where post_id = new.post_id and (outcome = 'no_response') <> (new.outcome = 'no_response')) then
		raise exception 'edits and cancels come before review closes, an hour before the post, and no_response at its close, alone'
			using errcode = 'check_violation', constraint = 'post_review_in_window';
	end if;
	if new.outcome = 'cancelled' and reviewed.status <> 'cancelled'
		or new.outcome = 'no_response' and reviewed.status <> 'scheduled' then
		raise exception 'a cancel is of a cancelled post, and no_response of a scheduled one'
			using errcode = 'check_violation', constraint = 'post_review_matches_the_post';
	end if;
	return new;
end $$;

create trigger post_review_in_window before insert on post_review
	for each row execute function post_review_in_window();

create table measurement (
	post_id uuid not null,
	platform text not null,
	metric text not null,
	taken_at timestamptz not null,
	source text not null check (source ~ '\S'),
	value bigint check (value >= 0),
	not_measured_reason text check (not_measured_reason ~ '\S'),
	constraint measurement_value_or_reason check (num_nonnulls(value, not_measured_reason) = 1),
	primary key (post_id, metric, taken_at, source),
	foreign key (post_id, platform) references post (id, platform),
	foreign key (platform, metric) references platform_metric
);

-- Checked on insert only: a reading is never rewritten, and a published post never changes.
create function measurement_after_publishing() returns trigger
language plpgsql as $$
begin
	if not exists (select from post where id = new.post_id and published_at <= new.taken_at) then
		raise exception 'a reading is of a published post, taken no earlier than it was published'
			using errcode = 'check_violation', constraint = 'measurement_after_publishing';
	end if;
	return new;
end $$;

create trigger measurement_after_publishing before insert on measurement
	for each row execute function measurement_after_publishing();

-- Commissions (walkthrough 4, topic E). Real shares and thresholds are the partners' rows, never in this repo.
-- A deal's commission, once: what it is expected to bring while open, and the gross the brokerage collects.
create table commission (
	deal_id uuid primary key references deal,
	created_at timestamptz not null default now(),
	expected numeric(14, 2) check (expected > 0),
	gross numeric(14, 2) check (gross > 0),
	-- The closing user's part of what the others leave, on this deal only. None follows their ladder.
	closing_share numeric(6, 5) check (closing_share between 0 and 1)
);

-- One part of the gross as it is invoiced and paid, such as half at signing and half at move-in.
create table commission_payment (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	deal_id uuid not null references commission,
	amount numeric(14, 2) not null check (amount > 0),
	invoiced_on date,
	due_on date,
	received_on date,
	constraint commission_payment_received_after_invoice check (received_on is null or invoiced_on is not null),
	constraint commission_payment_dates_in_order check (due_on >= invoiced_on and received_on >= invoiced_on)
);

-- What goes to others before the users split the rest: a referring agent, the brokerage, anyone else.
create table commission_share (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	deal_id uuid not null references commission,
	party_id uuid not null references party,
	kind text not null check (kind in ('referral', 'brokerage', 'other')),
	share numeric(6, 5) not null check (share > 0 and share <= 1)
);

-- A user's ladder: from their nth closed deal ever, they take closing_share of what each deal they close leaves,
-- and their partner the rest. A tier runs until the next one starts, so tiers never overlap or leave a gap.
create table commission_tier (
	user_id uuid not null references app_user,
	from_deal integer not null check (from_deal >= 1),
	partner_user_id uuid not null references app_user,
	-- Steps down toward an even split, never past it.
	closing_share numeric(6, 5) not null check (closing_share between 0.5 and 1),
	primary key (user_id, from_deal),
	constraint commission_tier_another_user check (partner_user_id <> user_id),
	constraint commission_tier_one_partner exclude using gist (user_id with =, partner_user_id with <>)
);

-- Deferred, so a lowered gross and a removed payment, or two changed shares, save in either order.
-- Held per deal until the transaction ends, so two saves cannot each pass alone and together break it.
create function commission_adds_up() returns trigger
language plpgsql as $$
begin
	perform pg_advisory_xact_lock(hashtextextended('commission ' || new.deal_id, 0));
	if (select sum(p.amount) > coalesce(min(m.gross), 0)
			from commission m join commission_payment p using (deal_id) where m.deal_id = new.deal_id) then
		raise exception 'payments never add up to more than the gross'
			using errcode = 'check_violation', constraint = 'commission_payments_within_gross';
	end if;
	if (select sum(share) > 1 from commission_share where deal_id = new.deal_id) then
		raise exception 'the others never take more than the whole commission'
			using errcode = 'check_violation', constraint = 'commission_shares_within_whole';
	end if;
	return null;
end $$;

create constraint trigger commission_adds_up after update of gross on commission
	initially deferred for each row execute function commission_adds_up();
create constraint trigger commission_adds_up after insert or update on commission_payment
	initially deferred for each row execute function commission_adds_up();
create constraint trigger commission_adds_up after insert or update on commission_share
	initially deferred for each row execute function commission_adds_up();

-- Deferred, so a ladder's tiers can be replaced in any order. Held per user, like commission_adds_up.
create function commission_ladder_holds() returns trigger
language plpgsql as $$
declare
	ladder uuid;
begin
	if tg_table_name = 'commission_tier' then
		ladder := coalesce(new.user_id, old.user_id);
	elsif tg_table_name = 'deal' then
		ladder := new.owner_user_id;
	else
		ladder := (select owner_user_id from deal where id = new.deal_id);
	end if;
	perform pg_advisory_xact_lock(hashtextextended('commission_tier ' || ladder, 0));
	if (select min(from_deal) <> 1 from commission_tier where user_id = ladder)
		or exists (select from (
			select closing_share > lag(closing_share) over (order by from_deal) as steps_up
			from commission_tier where user_id = ladder
		) tiers where steps_up) then
		raise exception 'a ladder starts at the first closed deal and never steps up'
			using errcode = 'check_violation', constraint = 'commission_ladder_steps_down';
	end if;
	if not exists (select from commission_tier where user_id = ladder)
		and exists (select from commission m join deal d on d.id = m.deal_id
			where d.owner_user_id = ladder and m.gross is not null) then
		raise exception 'a gross needs its closing user''s ladder, so its split names both users'
			using errcode = 'check_violation', constraint = 'commission_split_names_both_users';
	end if;
	return null;
end $$;

create constraint trigger commission_ladder_holds after insert or update or delete on commission_tier
	initially deferred for each row execute function commission_ladder_holds();
create constraint trigger commission_ladder_holds after insert or update of gross on commission
	initially deferred for each row execute function commission_ladder_holds();
create constraint trigger commission_ladder_holds after update of owner_user_id on deal
	initially deferred for each row execute function commission_ladder_holds();

-- Everyone's share of each deal's commission and its amount. The users' come from here, never typed.
-- A user's count of closed deals is lifetime, so it never resets.
create view commission_split as
with closed as (
	select d.id as deal_id, row_number() over (partition by d.owner_user_id order by last.happened_at, d.id) as number
	from deal d cross join lateral (
		select phase, happened_at from deal_phase_change where deal_id = d.id order by happened_at desc limit 1
	) last
	where last.phase = 'closed'
),
users as (
	select m.deal_id, d.owner_user_id, ladder.partner_user_id,
		coalesce(m.closing_share, (
			select t.closing_share from commission_tier t
			where t.user_id = d.owner_user_id and t.from_deal <= closed.number order by t.from_deal desc limit 1
		)) as closing_share,
		1 - coalesce((select sum(share) from commission_share where deal_id = m.deal_id), 0) as left_share
	from commission m
	join deal d on d.id = m.deal_id
	join lateral (select partner_user_id from commission_tier where user_id = d.owner_user_id limit 1) ladder on true
	left join closed using (deal_id)
),
parts as (
	select deal_id, party_id, kind, share, 0 as part, id from commission_share
	union all
	select deal_id, owner_user_id, 'closing_user', left_share * closing_share, 1, null from users
	union all
	select deal_id, partner_user_id, 'partner', left_share * (1 - closing_share), 2, null from users
)
-- Each amount is the cents its running share adds, so none is negative and together they are the gross.
select p.deal_id, p.party_id, p.kind, p.share,
	round(m.gross * sum(p.share) over running, 2) - round(m.gross * (sum(p.share) over running - p.share), 2) as amount
from parts p join commission m using (deal_id)
window running as (partition by p.deal_id order by p.part, p.id);

-- Invoice emails. Captured facts do not claim that a commission has been received.
create table invoice_mailbox (
	address email_address primary key
);

alter table commission_payment add unique (id, deal_id);

create table invoice_email (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	evidence_ref text not null unique check (evidence_ref ~ '\S'),
	sender email_address not null,
	deal_name text not null check (deal_name ~ '\S'),
	client_name text check (client_name ~ '\S'),
	property_address text check (property_address ~ '\S'),
	occurred_at timestamptz not null,
	-- Preserve the sender's calendar date, including its offset, rather than the session's zone.
	email_date date not null,
	status text not null default 'captured' check (status in ('captured', 'applied', 'undone', 'attached')),
	deal_id uuid references deal,
	payment_id uuid,
	prior_phase_at timestamptz,
	applied_phase_at timestamptz,
	prior_invoiced_on date,
	payment_change_id bigint,
	application_id uuid,
	application_root_id uuid generated always as (case when status in ('applied', 'undone') then id end) stored,
	unique (application_root_id, deal_id, payment_id, email_date),
	foreign key (application_id, deal_id, payment_id, email_date)
		references invoice_email (application_root_id, deal_id, payment_id, email_date),
	constraint invoice_email_attachment_whole check ((status = 'attached') = (application_id is not null)
		and (status <> 'attached' or (deal_id is not null
			and num_nonnulls(prior_phase_at, applied_phase_at, prior_invoiced_on, payment_change_id) = 0))),
	foreign key (payment_id, deal_id) references commission_payment (id, deal_id),
	foreign key (deal_id, prior_phase_at) references deal_phase_change,
	foreign key (deal_id, applied_phase_at) references deal_phase_change,
	constraint invoice_email_date_matches_time check (isfinite(occurred_at) and isfinite(email_date)
		and abs(email_date - (occurred_at at time zone 'UTC')::date) <= 1),
	constraint invoice_email_target_whole check ((deal_id is null) = (payment_id is null)),
	constraint invoice_email_applied_whole check (status in ('captured', 'attached') or
		(deal_id is not null and prior_phase_at is not null and applied_phase_at is not null and payment_change_id is not null))
);

create unique index invoice_email_one_application on invoice_email (deal_id, payment_id, email_date)
	where status in ('applied', 'undone');

create view deal_invoiced as
select deal_id, min(invoiced_on) as invoiced_on
from (select deal_id, invoiced_on from commission_payment where invoiced_on is not null
	union all select deal_id, invoiced_on from imported_deal_invoiced) dated
group by deal_id;

-- Keep the reservation in step with isOpenBoardDeal in src/deals/next-board.ts.
create table deal_open_name (
	deal_id uuid primary key references deal on delete cascade,
	name_key text,
	constraint deal_open_name_unique unique (name_key) deferrable initially deferred
);

create function sync_deal_open_name() returns trigger
language plpgsql security definer as $$
declare
	target uuid := (to_jsonb(case when tg_op = 'DELETE' then old else new end) ->> tg_argv[0])::uuid;
	deal_name text;
begin
	if tg_table_name = 'deal' and tg_op = 'INSERT' then
		insert into deal_open_name (deal_id) values (target);
	end if;
	-- Lock the name row without locking the deal or its invoice payments.
	perform from deal_open_name where deal_id = target for update;
	if not (exists (select from deal_invoiced where deal_id = target) or exists (
		select from (select phase, happened_at from deal_phase_change
			where deal_id = target order by happened_at desc limit 1) latest
		where latest.phase in ('closed', 'invoiced', 'dead')
	) or exists (
		select from imported_deal_board b where b.deal_id = target and b.phase is not null
			and b.phase_at is not distinct from (select max(happened_at) from deal_phase_change where deal_id = target)
			and (b.outcome is not null or b.closed_on is not null or b.phase in ('closed', 'invoiced', 'dead'))
	)) then
		select lower(regexp_replace(name, '^\s+|\s+$', '', 'g')) into deal_name from deal where id = target;
	end if;
	update deal_open_name set name_key = deal_name where deal_id = target and name_key is distinct from deal_name;
	return null;
end $$;

do $$ begin
	execute format('alter function sync_deal_open_name set search_path = %I, pg_temp', current_schema());
end $$;
revoke execute on function sync_deal_open_name from public;

create trigger sync_deal_open_name after insert or update of name on deal
	for each row execute function sync_deal_open_name('id');
create trigger sync_deal_open_name after insert or delete on deal_phase_change
	for each row execute function sync_deal_open_name('deal_id');
create trigger sync_deal_open_name after insert on imported_deal_board
	for each row execute function sync_deal_open_name('deal_id');
create trigger sync_deal_open_name after insert on imported_deal_invoiced
	for each row execute function sync_deal_open_name('deal_id');
create trigger sync_deal_open_name_on_invoice after insert on commission_payment
	for each row when (new.invoiced_on is not null) execute function sync_deal_open_name('deal_id');
create trigger sync_deal_open_name_on_invoice_removal after delete on commission_payment
	for each row when (old.invoiced_on is not null) execute function sync_deal_open_name('deal_id');
create trigger sync_deal_open_name_on_invoice_change after update of invoiced_on on commission_payment
	for each row when (old.invoiced_on is distinct from new.invoiced_on) execute function sync_deal_open_name('deal_id');

create function invoice_name(value text) returns text
language sql immutable return lower(regexp_replace(btrim(value), '\s+', ' ', 'g'));

create function invoice_email_target(evidence invoice_email)
returns table (deal_id uuid, payment_id uuid)
language sql stable as $$
	with matched_deal as (
		select (array_agg(d.id))[1] as id from deal d
		where invoice_name(d.name) = invoice_name(evidence.deal_name)
			and (evidence.client_name is not null or evidence.property_address is not null)
			and (evidence.client_name is null or exists (
				select from deal_party dp join party p on p.id = dp.party_id
				where dp.deal_id = d.id and dp.role = 'client' and invoice_name(p.name) = invoice_name(evidence.client_name)))
			and (evidence.property_address is null or exists (
				select from deal_property dp join property p on p.id = dp.property_id
				where dp.deal_id = d.id and invoice_name(p.address) = invoice_name(evidence.property_address)))
		having count(*) = 1
	)
	select d.id, (array_agg(p.id))[1] from matched_deal d
	join commission_payment p on p.deal_id = d.id
	where (p.invoiced_on is null or p.invoiced_on = evidence.email_date)
		and exists (select from invoice_mailbox where address = evidence.sender)
		and evidence.occurred_at <= clock_timestamp() and evidence.email_date <= current_date
		and exists (select from deal_phase_change ph where ph.deal_id = d.id)
		and not exists (select from deal_invoiced di where di.deal_id = d.id and di.invoiced_on <> evidence.email_date)
	group by d.id having count(*) = 1
$$;

create function invoice_email_transition() returns trigger
language plpgsql as $$
declare
	latest deal_phase_change;
	payment commission_payment;
	acting_job text := nullif(current_setting('engine.job', true), '');
	direct_user boolean := nullif(current_setting('engine.user_id', true), '') is not null
		and acting_job is null;
begin
	if old.status <> 'captured' and (new.deal_id, new.payment_id) is distinct from (old.deal_id, old.payment_id) then
		raise exception 'an applied invoice keeps its target' using errcode = 'check_violation', constraint = 'invoice_email_keeps_target';
	end if;
	if old.status = 'captured' and new.status = 'captured' then return new; end if;
	if not (old.status = 'captured' and new.status = 'applied' or old.status = 'applied' and new.status = 'undone' and direct_user) then
		raise exception 'an invoice applies once and only a user undoes it' using errcode = 'check_violation', constraint = 'invoice_email_status_moves';
	end if;
	if new.status = 'applied' and not direct_user and acting_job is distinct from 'lead_stage' then
		raise exception 'only the lead stages job applies invoices automatically'
			using errcode = 'check_violation', constraint = 'invoice_email_apply_job';
	end if;
	-- FOR UPDATE conflicts with the phase foreign key's KEY SHARE, so every phase writer takes turns with undo.
	perform from deal where id = new.deal_id for update;
	select * into latest from deal_phase_change where deal_id = new.deal_id order by happened_at desc limit 1;
	select * into payment from commission_payment where id = new.payment_id for update;
	if new.status = 'applied' then
		if new.deal_id is null then
			raise exception 'an invoice needs its payment' using errcode = 'check_violation', constraint = 'invoice_email_needs_payment';
		end if;
		if latest.happened_at is null then
			raise exception 'an invoice needs the previous phase for undo' using errcode = 'check_violation', constraint = 'invoice_email_needs_prior_phase';
		end if;
		if not direct_user and not exists (
			select from invoice_email_target(new) target
			where target.deal_id = new.deal_id and target.payment_id = new.payment_id
		) then
			raise exception 'a doubtful invoice waits for a user' using errcode = 'check_violation', constraint = 'invoice_email_needs_user';
		end if;
		select id into new.application_id from invoice_email
		where deal_id = new.deal_id and payment_id = new.payment_id and email_date = new.email_date
			and status in ('applied', 'undone');
		if found then
			new.status := 'attached';
			return new;
		end if;
		new.prior_phase_at := latest.happened_at;
		new.prior_invoiced_on := payment.invoiced_on;
		new.applied_phase_at := greatest(clock_timestamp(), latest.happened_at + interval '1 microsecond');
		insert into deal_phase_change (deal_id, happened_at, phase, reason)
		values (new.deal_id, new.applied_phase_at, 'closed', 'Invoice received');
		update commission_payment set invoiced_on = new.email_date where id = new.payment_id;
		select max(id) into new.payment_change_id from change where table_name = 'commission_payment'
			and record = jsonb_build_object('id', new.payment_id) and (new_value ? 'invoiced_on');
	else
		if payment.received_on is not null then
			raise exception 'a received payment prevents undo' using errcode = 'check_violation', constraint = 'invoice_email_undo_unpaid';
		end if;
		if latest.happened_at is distinct from old.applied_phase_at
			or old.payment_change_id is distinct from (select max(id) from change where table_name = 'commission_payment'
				and record = jsonb_build_object('id', new.payment_id) and new_value ? 'invoiced_on') then
			raise exception 'newer work prevents undo' using errcode = 'check_violation', constraint = 'invoice_email_undo_current';
		end if;
		insert into deal_phase_change (deal_id, happened_at, phase, reason)
		select deal_id, greatest(clock_timestamp(), latest.happened_at + interval '1 microsecond'), phase, 'Invoice close undone'
		from deal_phase_change where deal_id = old.deal_id and happened_at = old.prior_phase_at;
		update commission_payment set invoiced_on = old.prior_invoiced_on where id = old.payment_id;
	end if;
	return new;
end $$;

create trigger invoice_email_transition before update on invoice_email
	for each row execute function invoice_email_transition();

create function confirm_lead_client_link() returns trigger
language plpgsql as $$
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
	if not exists (
		select from party lead join party target on target.id = new.lead_client_id
		where lead.id = new.party_id and lower(btrim(lead.name)) = lower(btrim(target.name))
	) then
		raise exception 'a lead can link only to a same-name client'
			using errcode = 'check_violation', constraint = 'lead_client_link_suggested';
	end if;
	return new;
end $$;

-- This runs after stamp_change, so it can check the database-written actor.
create trigger validate_lead_client_link before insert or update of lead_client_id, party_id or delete on party_role
	for each row execute function confirm_lead_client_link();

-- Everything that points at the duplicate moves to the survivor, and the duplicate is removed (decision 39).
-- It runs with the owner's rights, because it also moves history the engine never rewrites, such as rounds and outside ids.
create function merge_party(duplicate uuid, survivor uuid) returns void
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
	-- A link between the two says nothing once they are one. Of two current links that become one, the survivor's
	-- stays; ended links are history and both stay.
	delete from party_link where duplicate in (party_id, other_party_id) and survivor in (party_id, other_party_id);
	delete from party_link d using party_link s
	where duplicate in (d.party_id, d.other_party_id) and survivor in (s.party_id, s.other_party_id)
		and s.kind = d.kind
		and s.ended_on is null and d.ended_on is null
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

-- Pinned, with pg_temp last, so a caller's own tables cannot stand in for these.
do $$ begin
	execute format('alter function merge_party set search_path = %I, pg_temp', current_schema());
end $$;

-- Change history: one row per insert, update or delete of a stamped row, stamped with who made it and when.
create table change (
	id bigint generated always as identity primary key,
	table_name text not null,
	-- The row's primary key, or the whole row where its table has none.
	record jsonb not null,
	action text not null check (action in ('insert', 'update', 'delete', 'erase')),
	-- An insert has the whole new row and a delete the whole old one. An update has only the fields it changed.
	old_value jsonb,
	new_value jsonb,
	-- The duplicate whose merge made this change.
	merge_of uuid references merged_party
);

create index change_record on change (table_name, record);
create index change_deal_party on change (((record ->> 'deal_id')::uuid)) where table_name = 'deal_party';

alter table invoice_email add foreign key (payment_change_id) references change;
create index change_payment_invoice_date on change (record, id desc)
	where table_name = 'commission_payment' and new_value ? 'invoiced_on';

-- The owner's rights, so the engine's login writes history only by changing a row.
create function record_change() returns trigger
language plpgsql security definer as $$
declare
	stamp constant text[] := array['changed_by_user_id', 'changed_by_job', 'changed_for_user_id', 'changed_at'];
	hidden text[] := case when tg_table_name = 'deal_client_website' then stamp || array['password_hash'] else stamp end;
	was jsonb := to_jsonb(old) - hidden;
	became jsonb := to_jsonb(new) - hidden;
	whole jsonb := coalesce(was, became);
	row_key jsonb := coalesce((select jsonb_object_agg(k, whole -> k) from unnest(tg_argv) k), whole);
begin
	if tg_op = 'UPDATE' then
		select jsonb_object_agg(field, value), jsonb_object_agg(field, became -> field) into was, became
		from jsonb_each(was) as fields (field, value) where value is distinct from became -> field;
		-- A statement that changes nothing leaves no history.
		if was is null then
			return null;
		end if;
		if tg_table_name = 'weekly_review' then
			was := was || jsonb_build_object('week_of', whole -> 'week_of');
			became := became || jsonb_build_object('week_of', whole -> 'week_of');
		end if;
	end if;
	insert into change (table_name, record, action, old_value, new_value, merge_of)
	values (tg_table_name, row_key, lower(tg_op), was, became, (
		-- Only a merge saved in this transaction, so a setting alone cannot pass a change off as a merge's.
		select id from merged_party where id = nullif(current_setting('engine.merge', true), '')::uuid and created_at = now()
	));
	return null;
end $$;
-- Only the owner can attach this trigger to a table.
revoke execute on function record_change() from public;

-- Each of these rows says which user or job last changed it and when, set by the database, never by the statement.
-- The check holds the owner's load of old rows too, which turns the trigger off.
do $$
declare
	stamped text;
begin
	foreach stamped in array array['role', 'stage', 'phase', 'deal_kind', 'typical_length', 'deal_reason', 'how_found', 'lead_lane', 'candidate', 'lead_contact_draft', 'party', 'party_email', 'party_phone', 'party_role', 'vendor_vertical', 'vendor_loan_program', 'party_company',
		'do_not_contact', 'specialty', 'party_specialty', 'outside_id', 'property', 'market', 'market_county', 'market_city', 'territory',
		'territory_piece', 'party_territory', 'party_territory_review', 'deal', 'deal_plan_date', 'introduction', 'party_link', 'deal_phase_change', 'deal_property', 'deal_party', 'deal_client_website', 'imported_deal_party', 'imported_deal_owner', 'imported_deal_invoiced', 'imported_deal_board', 'activity', 'tour_plan', 'tour_stop',
		'calendar_agenda', 'calendar_review_dismissal', 'activity_about', 'proposal', 'reply_draft', 'reply_draft_document', 'lead_stage_move', 'next_step', 'user_preference', 'home_mark', 'home_update', 'document_kind', 'document', 'document_extraction', 'email', 'email_recipient', 'email_mailbox', 'offer', 'offer_document', 'claim_type', 'offer_claim', 'lease', 'lease_version', 'lease_option', 'critical_date', 'social_account', 'idea',
		'design_template', 'post', 'post_text', 'post_media', 'post_review', 'measurement', 'weekly_review', 'deal_star',
		'party_document', 'email_document', 'client_vertical', 'client_research', 'client_research_fact',
		'lease_suite', 'suite', 'space_need', 'building_ownership', 'merged_party', 'change', 'client_type', 'client', 'national_account', 'client_brand', 'national_account_owner',
		'invoice_email', 'invoice_mailbox', 'commission', 'commission_payment', 'commission_share', 'commission_tier'] loop
		execute format('alter table %1$I add changed_by_user_id uuid references app_user %2$s,
				add changed_by_job text references job,
				add changed_for_user_id uuid references app_user,
				add changed_at timestamptz not null,
				add constraint %3$I check (num_nonnulls(changed_by_user_id, changed_by_job) = 1
					and (changed_by_job is not null or changed_for_user_id is null));
			create trigger stamp_change before %4$s on %1$I
				for each row execute function stamp_change()',
			-- A new user's own person row, and its history, name them before their user row exists.
			stamped, case when stamped in ('party', 'change') then 'deferrable initially deferred' end,
			stamped || '_changed_by_a_user_or_a_job',
			case when stamped = 'change' then 'insert' else 'insert or update' end);
	end loop;
end $$;



alter table deal_phase_change add constraint deal_phase_change_call_source check (
	num_nonnulls(call_activity_id, call_move_id) = case when changed_by_job = 'call_capture' then 2 else 0 end);

-- Both partners see every call (docs/decisions.md). The partner who recorded a call still gets its follow-up.
-- Added after the stamps, so a fresh build keeps the column order of a database that had the call read policies.
alter table activity add column call_owner_user_id uuid references app_user;

-- Named to run after stamp_change, so a new call's recorder comes from its stamp.
create function keep_call_recorder() returns trigger
language plpgsql set search_path = next, pg_temp as $$
begin
	if tg_op = 'INSERT' then
		new.call_owner_user_id := case when new.kind = 'call' then coalesce(new.changed_by_user_id, new.changed_for_user_id) end;
		return new;
	end if;
	if old.kind = 'call' and current_user = 'engine' and new.from_party_id is distinct from old.from_party_id
		and not exists (select from app_user where id = nullif(current_setting('engine.user_id', true), '')::uuid
			and is_account_partner) then
		raise exception 'only a partner can correct a call''s caller' using errcode = 'insufficient_privilege';
	end if;
	new.call_owner_user_id := old.call_owner_user_id;
	return new;
end $$;
create trigger zz_keep_call_recorder before insert or update on activity
	for each row execute function keep_call_recorder();
revoke execute on function keep_call_recorder() from public;

alter table weekly_review
	add reviewer_is_partner boolean generated always as (true) stored,
	add constraint weekly_review_by_a_user check (changed_by_user_id is not null),
	add foreign key (changed_by_user_id, reviewer_is_partner) references app_user (id, is_account_partner);

alter table deal_star add constraint deal_star_by_its_user check (changed_by_user_id is not distinct from user_id);

-- A text edit, an edit's review and a cancel name a user, as its author or the one a job worked for.
alter table post_text add constraint post_text_edit_by_a_user
	check (version = 1 or coalesce(changed_by_user_id, changed_for_user_id) is not null);
alter table post_review add constraint post_review_by_a_user
	check ((outcome = 'no_response') = (coalesce(changed_by_user_id, changed_for_user_id) is null));

-- Every stamped row but history's own records its changes. Pinned like merge_party, because it runs with the owner's rights.
do $$
declare
	recorded regclass;
begin
	execute format('alter function record_change set search_path = %I, pg_temp', current_schema());
	for recorded in
		select t.tgrelid from pg_trigger t join pg_class c on c.oid = t.tgrelid
		where t.tgname = 'stamp_change' and c.relnamespace = current_schema()::regnamespace and c.relname <> 'change'
	loop
		execute format('create trigger record_change after insert or update or delete on %s
				for each row execute function record_change(%s)',
			recorded, (select string_agg(quote_literal(a.attname), ', ')
				from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
				where i.indrelid = recorded and i.indisprimary));
	end loop;
end $$;

-- An erase keeps the original stamps and keys. Its own change names who requested it.
create function erase_change(removed_change_id bigint, fields text[]) returns void
language plpgsql as $$
declare
	removed change;
	source_table regclass;
	still_present boolean;
	erased boolean;
begin
	select * into strict removed from change where id = removed_change_id and action = 'delete';
	select c.oid into strict source_table from pg_class c
	where c.relnamespace = current_schema()::regnamespace and c.relname = removed.table_name and c.relkind = 'r';
	execute format('lock table %s in share row exclusive mode', source_table);
	execute format('select exists (select from %s r where to_jsonb(r) @> $1)', source_table)
		into still_present using removed.record;
	if still_present then
		raise exception 'only a removed record can be erased'
			using errcode = 'check_violation', constraint = 'erase_only_removed';
	end if;
	if coalesce(cardinality(fields), 0) = 0 or exists (
		select from unnest(fields) f where f is null or removed.record ? f or not exists (
			select from pg_attribute a join pg_type t on t.oid = a.atttypid
			where a.attrelid = source_table and a.attname = f and not a.attisdropped
				and t.typcategory = 'S' and f not like 'changed_%'
		)
	) then
		raise exception 'erase names non-key text fields'
			using errcode = 'check_violation', constraint = 'erase_only_text_fields';
	end if;
	update change set old_value = old_value - fields, new_value = new_value - fields
	where table_name = removed.table_name and record = removed.record and action <> 'erase'
		and (old_value ?| fields or new_value ?| fields);
	erased := found;
	update imported_change set source_event = source_event - array['human_quote', 'agent_rationale']
		- case when field = any(fields) then array['old_value', 'new_value'] else '{}'::text[] end,
		erased_fields = array(select distinct f from unnest(erased_fields || fields) f order by f)
	where table_name = removed.table_name and record = removed.record and not erased_fields @> fields;
	if found or erased then
		insert into change (table_name, record, action, new_value)
		values (removed.table_name, removed.record, 'erase', jsonb_build_object('fields', fields));
	end if;
end $$;

do $$ begin
	execute format('alter function erase_change set search_path = %I, pg_temp', current_schema());
end $$;
revoke execute on function erase_change from public;

create function posts_at_day_7(as_of timestamptz) returns jsonb
language sql stable
begin atomic
	with day_7 as (
		select distinct on (p.id, r.metric) p.*, r.metric, m.value, m.taken_at
		from post p
		join platform_metric r on r.platform = p.platform
			and r.metric in ('views', 'reactions', 'comments', 'shares', 'saves')
			and r.reported_since <= p.published_at
		-- Hours, not days, so the session's time zone cannot move day 7 across a clock change.
		left join measurement m on m.post_id = p.id and m.metric = r.metric
			and m.taken_at <= p.published_at + interval '168 hours'
		where p.published_at + interval '168 hours' <= as_of
		order by p.id, r.metric, m.taken_at desc, m.value is null, m.source
	),
	compared as (
		select id, social_account_id, idea_id, design_template_id, published_at,
			sum(value) filter (where metric <> 'views') / max(value) filter (where metric = 'views')
				as engagement_per_view,
			-- The oldest reading used: under 168 shows the post was judged before day 7.
			round(extract(epoch from min(taken_at) - published_at) / 3600, 1) as reading_age_hours
		from day_7
		group by id, social_account_id, idea_id, design_template_id, published_at
		-- A reported metric missing or not measured at day 7 leaves the post out; it never counts as zero.
		having count(value) = count(*) and max(value) filter (where metric = 'views') > 0
	),
	ranked as (
		select social_account_id, count(*) as posts,
			jsonb_agg(c order by engagement_per_view desc, id) -> 0 as best,
			jsonb_agg(c order by engagement_per_view, id) -> 0 as worst
		from (
			select id, social_account_id, published_at, idea_id, design_template_id,
				round(engagement_per_view, 4) as engagement_per_view, reading_age_hours
			from compared
		) c
		group by social_account_id
	)
	select jsonb_build_object(
		'accounts', (
			select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object(
				'posts', r.posts, 'best', r.best - 'social_account_id', 'worst', r.worst - 'social_account_id'
			) order by a.platform, a.handle), '[]')
			from social_account a join ranked r on r.social_account_id = a.id
		)
	);
end;

-- Imported field events retain their source shape instead of claiming complete native snapshots.
create table imported_change (
 id uuid primary key,
 table_name text not null check (table_name in ('party', 'deal', 'party_role', 'client', 'activity', 'proposal')),
 record jsonb not null check (jsonb_typeof(record) = 'object' and record <> '{}'::jsonb),
 erased_fields text[] not null default '{}',
 old_value_absent boolean not null,
 new_value_absent boolean not null,
 field text not null check (field ~ '\S'),
 source_event jsonb not null check (jsonb_typeof(source_event) = 'object'
  and source_event ?& array['id', 'verb', 'cause', 'actor_id']
  and source_event ->> 'id' is not null and (source_event ->> 'id')::uuid = id and source_event ->> 'verb' is not null
  and source_event ->> 'cause' is not null and source_event ->> 'actor_id' is not null),
 changed_by_user_id uuid references app_user,
 changed_by_job text references job,
 changed_for_user_id uuid references app_user,
 changed_at timestamptz not null,
 check (num_nonnulls(changed_by_user_id, changed_by_job) = 1
  and (changed_by_job is not null or changed_for_user_id is null))
);
create index imported_change_record on imported_change (table_name, record);
create trigger stamp_imported_change before insert on imported_change
 for each row execute function stamp_change();

create type imported_deal_attachments as (pdf uuid, working uuid);

create type imported_deal_values as (
 account_client_id uuid, activity uuid, activity_id uuid, agent_name text, assignee text,
 attachments imported_deal_attachments, basis text, building uuid, building_created boolean,
 client text, client_name text, client_portal_url text, client_ref text,
 closed_on date, deal_type text, decision_event_id uuid, decision_id uuid, description text,
 document_id uuid, dropped_post_call_action_ids uuid[], due date, due_on date, expires_on date,
 filled integer, found boolean, invoiced_on date, kind text, lane text, lead text, market text,
 market_agent text, matched_on text, name text, next_action text, next_action_id uuid, next_date date,
 next_step text, notes_path text, outcome text, owed integer, owner text, owner_id uuid,
 ownership integer, party_ref text, phase text, premises uuid, proposal_id uuid,
 proposes_correction text, rate numeric, reason text, round integer,
 salesforce_id text, set_by text, side text, source text, spaces integer, status text,
 summary text, template text, version integer
);

create table imported_deal_history (
 id uuid primary key,
 deal_id uuid not null references deal,
 occurred_at timestamptz not null,
 recorded_at timestamptz not null,
 source_actor_id uuid not null,
 source_deal_id uuid not null,
 changed_by_user_id uuid references app_user,
 changed_by_job text references job,
 verb text not null check (verb ~ '\S'),
 field text,
 old_value imported_deal_values,
 new_value imported_deal_values,
 old_keys text[],
 new_keys text[],
 cause text not null,
 human_quote text,
 agent_rationale text,
 idempotency_key text,
 via text,
 client_id text,
 sponsoring_human_slug text,
 personal_scope text,
 authorization_class text,
 organization_tenant_id text,
 correlation_id uuid,
 mutation_order bigint not null,
 check (num_nonnulls(changed_by_user_id, changed_by_job) = 1),
 check ((old_keys is not null) = (old_value is distinct from null)),
 check ((new_keys is not null) = (new_value is distinct from null))
);
create index imported_deal_history_order on imported_deal_history (deal_id, recorded_at, id);

create view deal_imported_history with (security_invoker = true) as
 select h.deal_id, jsonb_agg(jsonb_build_object(
  'id', h.id, 'occurred_at', h.occurred_at, 'recorded_at', h.recorded_at,
  'actor', coalesce(u.slug, h.changed_by_job), 'verb', h.verb, 'field', h.field, 'imported', true,
  'old_value', display.old_value, 'new_value', display.new_value
 ) order by h.recorded_at, h.id) as events
 from imported_deal_history h left join app_user u on u.id = h.changed_by_user_id
 cross join lateral (
  select jsonb_object_agg(label.key, f.value) filter (where s.is_before) as old_value,
   jsonb_object_agg(label.key, f.value) filter (where not s.is_before) as new_value
  from (values (true, to_jsonb(h.old_value), h.old_keys), (false, to_jsonb(h.new_value), h.new_keys))
   s(is_before, payload, keys)
  cross join lateral jsonb_each(s.payload) f
  cross join lateral (select case
   when h.verb = 'new-deal' and f.key = 'deal_type'
    and f.value #>> '{}' in ('relocation', 'startup', 'additional_office', 'expansion', 'renewal')
   then 'reason' else f.key end as key) label
  where f.key = any(s.keys)
   and f.key not in ('client_portal_url', 'notes_path')
   and (h.verb, f.key) <> ('set-next-action', 'summary')
   and not (f.key = 'source' and f.value #>> '{}' ~* '^\s*https?://\S+\s*$')
   and (f.value not in ('null', '"None"', '""', '{"pdf":null,"working":null}')
    or (not s.is_before and f.value = 'null' and f.key = any(h.old_keys)
     and to_jsonb(h.old_value) -> f.key not in ('null', '"None"', '""', '{"pdf":null,"working":null}')))
 ) display
 where not exists (
  select from unnest(array[((h.new_value).attachments).pdf, ((h.new_value).attachments).working]) attachment(id)
  left join document doc on doc.id = attachment.id and doc.deal_id = h.deal_id
  where h.verb = 'backfill-document-attachments' and attachment.id is not null
  having count(*) > 0 and count(*) = count(doc.id)
 )
 group by h.deal_id;

-- A save's answer under its key, so a retry gets the same answer instead of saving twice.
-- The hash covers who saved and what, so a key reused for another save is refused.
create table save_receipt (
	idempotency_key uuid primary key,
	created_at timestamptz not null default now(),
	verb text not null,
	request_hash text not null,
	answer jsonb not null check (jsonb_typeof(answer) = 'object')
);

create function everything_about_deal(wanted uuid) returns jsonb
language sql stable
begin atomic
	select jsonb_build_object(
		'deal', to_jsonb(d),
		'phases', (
			select coalesce(jsonb_agg(to_jsonb(c) - array['deal_id', 'call_activity_id', 'call_kind', 'call_move_id']
				order by c.happened_at), '[]')
			from deal_phase_change c
			where c.deal_id = d.id
		),
		'properties', (
			select coalesce(jsonb_agg(to_jsonb(p) order by p.address), '[]')
			from deal_property dp join property p on p.id = dp.property_id
			where dp.deal_id = d.id
		),
		'parties', (
			select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('role', dp.role) order by dp.role, p.name), '[]')
			from deal_party dp join party p on p.id = dp.party_id
			where dp.deal_id = d.id
		),
		'offers', (
			select coalesce(jsonb_agg(to_jsonb(o) - array['deal_id', 'import_source', 'import_id', 'import_record'] || jsonb_build_object('documents', (
				select coalesce(jsonb_agg(to_jsonb(doc) order by doc.name, doc.id), '[]')
				from offer_document od join document doc on doc.id = od.document_id
				where od.offer_id = o.id
			), 'claims', (
				select coalesce(jsonb_agg(to_jsonb(c) - 'offer_id' order by c.claim_type), '[]')
				from offer_claim c
				where c.offer_id = o.id
			)) order by o.round), '[]')
			from offer o
			where o.deal_id = d.id
		),
		'activity', (
			select coalesce(jsonb_agg(activity_entry(a) order by a.happened_at, a.id), '[]')
			from activity_about aa join activity a on a.id = aa.activity_id
			where aa.deal_id = d.id
		),
		'next_steps', (
			select coalesce(jsonb_agg(to_jsonb(s) - array['deal_id', 'party_id', 'property_id', 'call_activity_id',
				'call_kind', 'call_evidence_quote', 'call_contact_party_id', 'home_step_id', 'home_call_follow_up_id']
				order by s.due_on nulls last, s.id), '[]')
			from next_step s
			where s.deal_id = d.id
		),
		'critical_dates', (
			select coalesce(jsonb_agg(to_jsonb(c) - 'deal_id' order by c.due_on, c.id), '[]')
			from critical_date c
			where c.deal_id = d.id and c.status = 'open'
		),
		'critical_date_proposals', (
			select coalesce(jsonb_agg(to_jsonb(c) - 'deal_id' order by c.due_on, c.id), '[]')
			from critical_date c
			where c.deal_id = d.id and c.status = 'proposed'
		),
		'earlier_parties', (
			select coalesce(jsonb_agg(to_jsonb(e) - 'deal_id' || jsonb_build_object('party', to_jsonb(p))
				order by e.ended_at, e.id), '[]')
			from imported_deal_party e join party p on p.id = e.party_id
			where e.deal_id = d.id
		),
		'earlier_owners', (
			select coalesce(jsonb_agg(to_jsonb(o) - 'deal_id' order by o.ended_at, o.id), '[]')
			from imported_deal_owner o
			where o.deal_id = d.id
		),
		'history', (
			select coalesce(jsonb_agg(to_jsonb(c) order by c.changed_at, c.id), '[]')
			from change c
			where c.table_name = 'deal' and c.record = jsonb_build_object('id', d.id)
				or c.table_name = 'deal_party' and (c.record ->> 'deal_id')::uuid = d.id
		),
		'imported_deal_history', coalesce((select events from deal_imported_history h where h.deal_id = d.id), '[]'),
		'imported_history', (
			select coalesce(jsonb_agg(to_jsonb(c) order by c.changed_at, c.id), '[]')
			from imported_change c
			where c.table_name = 'deal' and c.record = jsonb_build_object('id', d.id)
		)
	)
	from deal d
	where d.id = wanted;
end;

create function everything_about_party(wanted uuid) returns jsonb
language sql stable
begin atomic
	with subject as (
		select * from party where id = coalesce((select survivor_id from merged_party where id = wanted), wanted)
	), records as (
		select jsonb_build_object('id', id) as record from subject
		union all
		select jsonb_build_object('id', m.id) from merged_party m
		where m.survivor_id = (select id from subject)
	)
	select jsonb_build_object(
		'party', to_jsonb(p),
		'history', (
			select coalesce(jsonb_agg(to_jsonb(c) order by c.changed_at, c.id), '[]')
			from change c join records r on r.record = c.record where c.table_name = 'party'
		),
		'imported_history', (
			select coalesce(jsonb_agg(to_jsonb(c) order by c.changed_at, c.id), '[]')
			from imported_change c join records r on r.record = c.record where c.table_name = 'party'
		),
		'do_not_contact', (
			select to_jsonb(r) - 'party_id' || jsonb_build_object('active', a.party_id is not null)
			from do_not_contact r left join active_do_not_contact a using (party_id) where r.party_id = p.id
		),
		'outreach_draft', (
			select to_jsonb(d) - array['party_id', 'role', 'requires_human_send', 'dispatchable']
			from lead_contact_draft d where d.party_id = p.id
		),
		'brands', (
			select coalesce(jsonb_agg(to_jsonb(b) - 'brand_kind'
				|| jsonb_build_object('party', to_jsonb(other)) order by b.started_on, b.id), '[]')
			from client_brand b join party other on other.id = case when b.location_id = p.id then b.brand_id else b.location_id end
			where p.id in (b.location_id, b.brand_id)
		),
		'national_account_owners', (
			select coalesce(jsonb_agg(to_jsonb(o) - 'owner_is_partner'
				|| jsonb_build_object('party', to_jsonb(other)) order by o.started_on, o.id), '[]')
			from national_account_owner o join party other on other.id = case when o.account_id = p.id then o.owner_id else o.account_id end
			where p.id in (o.account_id, o.owner_id)
		),
		'leases', (
			select coalesce(jsonb_agg(to_jsonb(l) - array['party_id', 'client_role'] || jsonb_build_object(
				'property', to_jsonb(pr), 'versions', (
					select coalesce(jsonb_agg(to_jsonb(v) - array['lease_id', 'previous_version'] || jsonb_build_object(
						'document', (select to_jsonb(doc) from document doc where doc.id = v.document_id),
						'suites', (
							select coalesce(jsonb_agg(to_jsonb(s) order by s.label nulls last, s.id), '[]')
							from lease_suite ls join suite s on s.id = ls.suite_id where ls.lease_version_id = v.id
						), 'options', (
							select coalesce(jsonb_agg(to_jsonb(o) - 'lease_version_id' order by o.number), '[]')
							from lease_option o where o.lease_version_id = v.id
						)) order by v.version), '[]')
					from lease_version v where v.lease_id = l.id
				)) order by pr.address, l.id), '[]')
			from lease l join property pr on pr.id = l.property_id where l.party_id = p.id
		),
		'emails', (
			select coalesce(jsonb_agg(to_jsonb(e) - 'party_id' order by e.is_primary desc, e.address, e.id), '[]')
			from party_email e where e.party_id = p.id
		),
		'phones', (
			select coalesce(jsonb_agg(to_jsonb(n) - 'party_id'
				order by n.is_primary desc, n.number, n.extension nulls last, n.id), '[]')
			from party_phone n where n.party_id = p.id
		),
		'companies', (
			select coalesce(jsonb_agg(to_jsonb(c) - array['person_kind', 'company_kind'] || jsonb_build_object(
				'party', to_jsonb(other))
				order by c.started_on nulls last, c.id), '[]')
			from party_company c join party other on other.id = case when c.person_id = p.id then c.company_id else c.person_id end
			where p.id in (c.person_id, c.company_id)
		),
		'roles', (
			select coalesce(jsonb_agg(to_jsonb(r) - 'party_id' || jsonb_build_object('client', (
				select to_jsonb(c) - array['party_id', 'role'] || jsonb_build_object('current_status', cs.status)
				from client c join client_status cs using (party_id) where c.party_id = p.id and r.role = 'client'
			)) order by r.role), '[]')
			from party_role r where r.party_id = p.id
		),
		'specialties', (
			select coalesce(jsonb_agg(to_jsonb(s) - array['person_id', 'person_kind'] order by s.specialty), '[]')
			from party_specialty s where s.person_id = p.id
		),
		'territories', (
			select coalesce(jsonb_agg(to_jsonb(pt) - 'party_id' || jsonb_build_object('territory', to_jsonb(t) || jsonb_build_object(
				'pieces', (
					select coalesce(jsonb_agg(to_jsonb(piece) - 'territory_id' || jsonb_build_object('market', to_jsonb(m))
						order by piece.state_fips nulls last, m.name nulls last, piece.miles nulls last, piece.id), '[]')
					from territory_piece piece left join market m on m.id = piece.market_id where piece.territory_id = t.id
				))) order by pt.started_on nulls last, pt.id), '[]')
			from party_territory pt join territory t on t.id = pt.territory_id where pt.party_id = p.id
		),
		'vendor_verticals', (
			select coalesce(jsonb_agg(to_jsonb(v) - array['party_id', 'role'] order by v.vertical), '[]')
			from vendor_vertical v where v.party_id = p.id
		),
		'vendor_loan_programs', (
			select coalesce(jsonb_agg(to_jsonb(l) - array['party_id', 'role'] order by l.loan_program), '[]')
			from vendor_loan_program l where l.party_id = p.id
		),
		'deals', (
			select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object('role', dp.role)
				order by d.name, d.id, dp.role), '[]')
			from deal_party dp join deal d on d.id = dp.deal_id where dp.party_id = p.id
		),
		'links', (
			select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('party', to_jsonb(other)) order by l.kind, l.started_on nulls last, l.id), '[]')
			from party_link l join party other on other.id = case when l.party_id = p.id then l.other_party_id else l.party_id end
			where p.id in (l.party_id, l.other_party_id)
		),
		'introductions', (
			select coalesce(jsonb_agg(to_jsonb(i) - 'vendor_role' || jsonb_build_object('party', to_jsonb(other))
				order by i.introduced_on nulls last, i.id), '[]')
			from introduction i join party other on other.id = case when i.vendor_id = p.id then i.introduced_party_id else i.vendor_id end
			where p.id in (i.vendor_id, i.introduced_party_id)
		),
		'activity', (
			select coalesce(jsonb_agg(activity_entry(a) order by a.happened_at, a.id), '[]')
			from activity_about aa join activity a on a.id = aa.activity_id where aa.party_id = p.id
		),
		'next_steps', (
			select coalesce(jsonb_agg(to_jsonb(s) - array['deal_id', 'party_id', 'property_id', 'call_activity_id',
				'call_kind', 'call_evidence_quote', 'call_contact_party_id', 'home_step_id', 'home_call_follow_up_id']
				order by s.due_on nulls last, s.id), '[]')
			from next_step s where s.party_id = p.id
		),
		'proposals', (
			select coalesce(jsonb_agg(to_jsonb(s) - array['deal_id', 'party_id', 'property_id']
				order by s.created_at, s.id), '[]')
			from proposal s where s.party_id = p.id and s.status = 'pending'
		)
	)
	from subject p;
end;

-- The engine's role. A login takes it with "grant engine to <login>"; the owner's own login is not the engine's concern.
-- It reads everywhere, adds everywhere but app_user, job, merged_party, change, imported_change, imported_deal_history, imported_deal_party, imported_deal_owner, imported_deal_invoiced, imported_deal_board, platform_metric, platform_format and relationship_level, never empties a table, and changes or removes only what the grants below name.
-- History (document, document_extraction, lease, lease_version, lease_option, critical_date, deal_phase_change, offer, offer_document, offer_claim, post and its text, media and reviews, measurement, social_sign_in, outside_id, change, imported_change, imported_deal_history, imported_deal_party, imported_deal_owner, imported_deal_invoiced, imported_deal_board) is never removed.
do $$ declare role_name text; begin
	foreach role_name in array array['engine', 'engine_reader'] loop
		begin
			execute format('create role %I nologin', role_name);
		-- Roles belong to the server and outlive a database, so a second load reuses them.
		exception when duplicate_object or unique_violation then null;
		end;
		-- A reused role must hold nothing that would reach past the grants below.
		if exists (select from pg_roles where rolname = role_name
				and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication))
			or exists (select from pg_auth_members where member = role_name::regrole) then
			raise exception 'role % holds rights beyond its grants', role_name;
		end if;
	end loop;
end $$;

do $$ begin
	execute format('grant usage on schema %1$I to engine;
		grant select, insert on all tables in schema %1$I to engine', current_schema());
end $$;
-- Which metrics and formats a platform offers, and the relationship levels, are schema decisions.
revoke insert on platform_metric, platform_format, relationship_level from engine;
-- Only the owner adds a user or a job, because every change is signed with one.
revoke insert on app_user, job from engine;
revoke insert on lead_source_sender from engine;
-- Only a merge leaves a pointer.
revoke insert on merged_party from engine;
revoke insert on deal_open_name from engine;
-- Only a change to a row writes history, so the engine never adds, rewrites or removes it.
revoke insert on change, imported_change, imported_deal_history from engine;
-- Only the owner's copy adds the old system's earlier people, owners and board facts.
revoke insert on imported_automatic_phase_move, imported_deal_party, imported_deal_owner, imported_deal_invoiced, imported_deal_board from engine;
grant execute on function merge_party to engine;
grant execute on function carry_weekly_review to engine;
grant execute on function lock_weekly_review(date, uuid, uuid) to engine;
grant execute on function npi_check_digit_holds(text), is_time_zone(text) to engine;
grant execute on function invoice_email_target(invoice_email), invoice_name(text) to engine, engine_reader;
revoke execute on function deal_filing_reason(uuid, uuid) from public;
grant execute on function deal_filing_reason(uuid, uuid) to engine, engine_reader;

-- Only the owner sets when the engine starts publishing for an account, even on an account the engine adds.
revoke insert on social_account from engine;
grant insert (id, created_at, platform, owner_party_id, handle, platform_account_id) on social_account to engine;

grant delete on client_vertical, vendor_vertical, vendor_loan_program, party, party_email, party_phone, do_not_contact, party_specialty, property, market, market_county, market_city,
	territory, territory_piece, party_territory, party_territory_review, deal, party_role, party_company, deal_property, deal_party, activity,
	activity_about, email, next_step, home_mark, deal_attention_alert, social_account, idea, design_template, introduction, party_link, weekly_review, deal_star to engine;

-- Ids, created_at and the records a link or an about row joins never change; a different link is a removed row and a new one.
-- Who sent an activity and who owns a next step can be corrected.
grant update (label) on table role, stage, phase, specialty, document_kind, deal_kind, deal_reason, how_found, claim_type to engine;
grant select, insert, update (target_on) on deal_plan_date to engine;
grant update (days) on typical_length to engine;
grant update (lead_client_id) on party_role to engine;
grant update (relationship_origin, rivalry_note, refers_business, offers, seeking, stage, relationship_level, disposition, disposition_reason, is_target, owner_user_id, needs_attention) on party_role to engine;
grant update (acknowledged_by_user_id, acknowledged_at) on lead_email_attention to engine;
grant update (introduced_on, deal_id, note) on introduction to engine;
grant update (started_on, ended_on, note) on party_link to engine;
grant update (name) on party, market, territory, deal, document, design_template to engine;
grant update (kind, reason, renews_lease_id, owner_user_id, market_id, closed_value, parking_reason, parking_note, needs_attention) on deal to engine;
grant update (npi, how_found, city) on party to engine;
grant update (until_date) on do_not_contact to engine;
grant update (address, county_fips, latitude, longitude, name, building_class, building_type, year_built, stories) on property to engine;
grant update (title, started_on, ended_on) on party_company to engine;
grant update (started_on, ended_on) on party_territory to engine;
grant update (has_office, coverage, source) on party_territory_review to engine;
grant update (label, is_primary) on party_email, party_phone to engine;
grant update (happened_at, from_party_id, summary) on activity to engine;
grant update (planned_on, notes, completed_activity_id, cancelled_at) on tour_plan to engine;
grant delete on tour_stop to engine;
grant update (what, owner_party_id, due_on, hold_until, item_bullets, done_at, resolution, resolved_at, resolution_reason) on next_step to engine;
grant update (time_zone, quiet_from, quiet_until, push_to_device) on user_preference to engine;
grant update (disposition, snoozed_until, drop_reason, waiting_on_party_id, waiting_reason) on home_mark to engine;
grant update (read_at) on home_update to engine;
grant update (reason, owner_user_id, alerted_at) on deal_attention_alert to engine;
-- Only the owner's import supplies the old event that closed a step.
revoke insert on next_step from engine;
grant insert (id, created_at, what, owner_party_id, due_on, hold_until, item_title, item_bullets, source_ref,
	done_at, resolution, resolved_at, resolution_reason, deal_id, party_id, property_id,
	call_activity_id, call_evidence_quote) on next_step to engine;
-- Only the owner's import supplies provenance. A user's or job's new round has a known status.
revoke insert on offer from engine;
grant insert (id, deal_id, property_id, round, answers_round, from_party_id, from_role, offered_at,
	expires_on, status, rent_per_sf_yr, nnn_per_sf_yr, term_months, ti_per_sf, free_rent_months,
	escalation_pct, commencement_on, commencement_days_after_delivery, other_terms, submarket_condition) on offer to engine;
grant update (status) on offer to engine;
revoke insert on email from engine;
grant insert (activity_id, message_id, conversation_id, sender, sender_name, subject, body) on email to engine;
grant update (authored, history) on email to engine;
revoke insert on email_summary, email_current_summary from engine;
grant execute on function record_email_summary to engine;
grant update (handle, platform_account_id) on social_account to engine;
grant update (angle, hook, pillar) on idea to engine;
grant update (status, reason, platform_post_id, published_at) on post to engine;

grant update (status, resolution_reason) on critical_date to engine;

grant update (label) on client_type to engine;
grant update (status, client_type) on client to engine;
grant update (started_on, ended_on) on client_brand, national_account_owner to engine;
grant delete on client, national_account, client_brand, national_account_owner to engine;

grant update (status, filed_deal_id, filed_vendor_id, filing_reason, dismiss_reason) on proposal to engine;
grant update (subject, body, status, dismiss_reason, to_address, cc_address, sent_at, sent_item_id, failure_reason)
	on reply_draft to engine;

grant update (expected, gross, closing_share) on commission to engine;
grant update (amount, invoiced_on, due_on, received_on) on commission_payment to engine;
grant update (share) on commission_share to engine;
grant update (closing_share) on commission_tier to engine;
grant delete on commission, commission_payment, commission_share, commission_tier to engine;

grant update (subject, body, owner_user_id, scheduled_for, time_zone, approved) on lead_contact_draft to engine;
grant delete on lead_contact_draft to engine;


grant update (label) on lead_lane to engine;
grant update (how_found_detail) on party to engine;
grant update (lane, estimated_lease_on, lease_estimate_source, lease_estimate_confidence, segment) on party_role to engine;

grant update (deal_id, kind, content_type, sha256, bytes) on document to engine;
-- A mistaken party link is removed; its file stays.
grant delete on party_document, reply_draft_document to engine;
grant delete on suite, space_need, building_ownership to engine;
grant update (label, floor, area_sf, area_basis, condition) on suite to engine;
grant update (name, min_sf, max_sf, max_rate_sf_yr, space_type, market_id, must_haves, vendor_id, source_ref, source_revision, applicability) on space_need to engine;
grant update (started_on, ended_on, source) on building_ownership to engine;

revoke insert on lead_contact_draft from engine;
grant insert (id, party_id, owner_user_id, subject, body, scheduled_for, time_zone) on lead_contact_draft to engine;

-- The owner chooses trusted senders; captured evidence and application snapshots are never supplied as applied history.
revoke insert on invoice_mailbox, invoice_email from engine;
grant insert (id, created_at, evidence_ref, sender, deal_name, client_name, property_address, occurred_at, email_date, deal_id, payment_id)
	on invoice_email to engine;
grant update (status, deal_id, payment_id) on invoice_email to engine;

grant update (status, reason, promoted_party_id) on candidate to engine;

grant update (source_row, name, qualification, estimated_lease_on, lease_estimate_source) on candidate to engine;

-- The read role gets only schema usage and table reads.
do $$ begin
	execute format('grant usage on schema %1$I to engine_reader;
		grant select on all tables in schema %1$I to engine_reader', current_schema());
end $$;

grant update (observed_at, snapshot) on calendar_agenda to engine;

revoke select on deal_client_website from engine_reader;
grant select (slug, deal_id, client_party_id, disabled_at) on deal_client_website to engine_reader;

revoke select on deal_client_website_attempt, deal_client_website_grant from engine_reader;
revoke select on lead_email_evidence from engine_reader;
grant update (failed_attempts, window_started_at) on deal_client_website_attempt to engine;
grant delete on deal_client_website_attempt, deal_client_website_grant to engine;

create table doc_conversation (
	id uuid primary key default gen_random_uuid(),
	owner_user_id uuid not null,
	is_account_partner boolean not null generated always as (true) stored,
	created_at timestamptz not null default now(),
	unique (id, owner_user_id),
	foreign key (owner_user_id, is_account_partner) references app_user (id, is_account_partner)
);
create index doc_conversation_recent on doc_conversation (owner_user_id, created_at desc, id desc);

create table doc_turn (
	id uuid primary key default gen_random_uuid(),
	conversation_id uuid not null,
	owner_user_id uuid not null,
	position integer not null check (position > 0),
	created_at timestamptz not null default now(),
	idempotency_key uuid not null,
	request_hash text not null,
	question text not null check (question ~ '\S' and char_length(question) <= 4000),
	context jsonb check (jsonb_typeof(context) = 'object'),
	state text not null,
	claim_id uuid,
	claim_until timestamptz,
	claim_state jsonb,
	answer jsonb check (jsonb_typeof(answer) = 'object'),
	answered_by text not null default 'mac' constraint doc_turn_answered_by check (answered_by in ('mac', 'backup')),
	requeued_at timestamptz,
	confirmation_key uuid unique references save_receipt (idempotency_key) deferrable initially deferred,
	unique (conversation_id, position),
	unique (owner_user_id, idempotency_key),
	unique (id, owner_user_id),
	foreign key (conversation_id, owner_user_id) references doc_conversation (id, owner_user_id),
	constraint doc_turn_claim_state check (
		(state = 'working' and claim_id is not null and claim_until is not null
			and answer is null and claim_state is not null and jsonb_typeof(claim_state) = 'object')
		or (state in ('queued', 'failed', 'answered') and claim_id is null and claim_until is null
			and claim_state is null and ((state = 'answered') = (answer is not null)))
	),
	check (confirmation_key is null or coalesce(jsonb_typeof(answer -> 'proposal') = 'object', false))
);
create unique index doc_turn_one_pending on doc_turn (conversation_id) where state in ('queued', 'working');

create function stamp_doc_turn_requeue() returns trigger language plpgsql as $$
begin
	new.requeued_at := clock_timestamp();
	return new;
end;
$$;
revoke all on function stamp_doc_turn_requeue() from public;
create trigger stamp_doc_turn_requeue before update of state on doc_turn
	for each row when (old.state <> 'queued' and new.state = 'queued')
	execute function stamp_doc_turn_requeue();

alter table doc_conversation enable row level security;
alter table doc_turn enable row level security;
create policy doc_conversation_owner on doc_conversation to engine using (
	owner_user_id = nullif(current_setting('engine.user_id', true), '')::uuid
	and nullif(current_setting('engine.job', true), '') is null
);
create policy doc_turn_owner on doc_turn to engine using (
	owner_user_id = nullif(current_setting('engine.user_id', true), '')::uuid
	and nullif(current_setting('engine.job', true), '') is null
);
revoke all on doc_conversation, doc_turn from public, engine_reader;
grant select, insert on doc_conversation, doc_turn to engine;
-- FOR UPDATE needs UPDATE on one column. Row security keeps the owner fixed.
grant update (owner_user_id) on doc_conversation to engine;
grant update (state, claim_id, claim_until, claim_state, answer, answered_by, confirmation_key) on doc_turn to engine;

create table doc_link (
	owner_user_id uuid primary key,
	is_account_partner boolean not null generated always as (true) stored,
	credential_hash text not null unique check (credential_hash ~ '^[0-9a-f]{64}$'),
	issued_at timestamptz not null default now(),
	last_seen_at timestamptz,
	readiness text constraint doc_link_readiness check (readiness in ('ready', 'signed_out', 'plan_limited')),
	foreign key (owner_user_id, is_account_partner) references app_user (id, is_account_partner)
);

alter table doc_link enable row level security;
create policy doc_link_owner on doc_link to engine using (
	owner_user_id = nullif(current_setting('engine.user_id', true), '')::uuid
	and nullif(current_setting('engine.job', true), '') is null
);
create policy doc_link_credential on doc_link for select to engine using (
	credential_hash = nullif(current_setting('engine.doc_link_hash', true), '')
	and nullif(current_setting('engine.user_id', true), '') is null
	and nullif(current_setting('engine.job', true), '') is null
);
revoke all on doc_link from public, engine_reader;
grant select, insert, delete on doc_link to engine;
grant update (credential_hash, issued_at, last_seen_at, readiness) on doc_link to engine;

alter table reply_draft
	add column confirmed_doc_turn_id uuid,
	alter column proposed_by_job drop not null,
	add constraint reply_draft_confirmed_doc_turn_key unique (confirmed_doc_turn_id),
	add constraint reply_draft_confirmed_doc_turn_owner_fkey
		foreign key (confirmed_doc_turn_id, owner_user_id) references doc_turn (id, owner_user_id),
	add constraint reply_draft_one_origin check (num_nonnulls(proposed_by_job, confirmed_doc_turn_id) = 1);

create function reply_draft_doc_origin() returns trigger
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

create trigger reply_draft_doc_origin before insert on reply_draft
	for each row when (new.confirmed_doc_turn_id is not null and new.proposed_by_job is null)
	execute function reply_draft_doc_origin();

create table doc_judgment_job (
	id uuid primary key default gen_random_uuid(),
	owner_user_id uuid not null,
	is_account_partner boolean not null generated always as (true) stored,
	activity_id uuid not null,
	idempotency_key uuid not null,
	created_at timestamptz not null default now(),
	kind text not null check (kind in ('email_summary', 'email_filing', 'email_split', 'introduction')),
	first_destination integer generated always as (case when kind = 'email_filing' then 1 end) stored,
	state text not null default 'queued',
	claim_id uuid unique,
	claim_until timestamptz,
	claim_source_hash bytea,
	result jsonb check (jsonb_typeof(result) = 'object'),
	unique (id, kind),
	unique (owner_user_id, idempotency_key),
	foreign key (owner_user_id, is_account_partner) references app_user (id, is_account_partner),
	foreign key (activity_id, owner_user_id) references email_mailbox on delete cascade,
	check ((state = 'working' and claim_id is not null and claim_until is not null
			and claim_source_hash is not null and result is null)
		or (state in ('queued', 'failed', 'answered') and claim_id is null and claim_until is null
			and claim_source_hash is null and ((state = 'answered') = (result is not null)))
	)
);

alter table doc_judgment_job enable row level security;
create policy doc_judgment_owner on doc_judgment_job to engine using (
	owner_user_id = nullif(current_setting('engine.user_id', true), '')::uuid
	and nullif(current_setting('engine.job', true), '') is null
);
revoke all on doc_judgment_job from public, engine_reader;
grant select on doc_judgment_job to engine;
grant update (state, claim_id, claim_until, claim_source_hash, result) on doc_judgment_job to engine;

create function queue_email_summary(email_id uuid) returns void
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

-- Two captures can both pass the not-exists check. The index keeps one row.
create unique index doc_judgment_job_one_split on doc_judgment_job (activity_id) where kind = 'email_split';

-- One split per email, whichever mailbox captured it first.
create function queue_email_split(email_id uuid) returns void
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

create unique index doc_judgment_job_one_introduction on doc_judgment_job (activity_id) where kind = 'introduction';

create function queue_introduction(email_id uuid) returns void
language sql security definer as $$
	insert into doc_judgment_job (owner_user_id, activity_id, idempotency_key, kind)
	select m.user_id, m.activity_id, md5('introduction:' || m.activity_id)::uuid, 'introduction'
	from email_mailbox m join app_user u on u.id = m.user_id
	where current_setting('engine.job', true) = 'mail_capture'
		and m.user_id = nullif(current_setting('engine.user_id', true), '')::uuid
		and u.is_account_partner and m.activity_id = email_id
	on conflict do nothing;
$$;

do $$ begin
	execute format('alter function queue_introduction set search_path = pg_catalog, %I, pg_temp', current_schema());
end $$;
revoke execute on function queue_introduction from public;
grant execute on function queue_introduction to engine;

alter table introduction add foreign key (source_job_id) references doc_judgment_job on delete restrict;
alter table introduction enable row level security;
create policy confirmed_introduction on introduction to engine, engine_reader
	using (confirmed) with check (confirmed or current_setting('engine.job', true) = 'mail_capture');
create policy remove_recorded_introduction on introduction as restrictive for delete to engine
	using (confirmed and source_job_id is null);

-- A recorded row wins, including when a partner records it after the mail job.
create function keep_recorded_introduction() returns trigger
language plpgsql security definer as $$
begin
	perform from party where id in (new.vendor_id, new.introduced_party_id) order by id for key share;
	perform pg_advisory_xact_lock(hashtextextended('introduction:' || new.vendor_id, 0));
	if new.confirmed then
		delete from introduction i where not i.confirmed and i.id <> new.id
			and (i.vendor_id, i.made_by, i.introduced_party_id) = (new.vendor_id, new.made_by, new.introduced_party_id)
			and (new.introduced_on is null or i.introduced_on = new.introduced_on);
	elsif exists (
		select from introduction i where i.id <> new.id
			and (i.vendor_id, i.made_by, i.introduced_party_id) = (new.vendor_id, new.made_by, new.introduced_party_id)
			and (i.introduced_on is null or i.introduced_on = new.introduced_on)
	) then
		if tg_when = 'AFTER' then
			delete from introduction where id = new.id;
		end if;
		return null;
	end if;
	return new;
end $$;

do $$ begin
	execute format('alter function keep_recorded_introduction set search_path = pg_catalog, %I, pg_temp', current_schema());
end $$;
revoke execute on function keep_recorded_introduction from public;
create trigger keep_recorded_introduction before insert or update of introduced_on, confirmed on introduction
	for each row execute function keep_recorded_introduction();

-- The old row must move before discarding a duplicate so a party merge can release its foreign keys.
create trigger dedup_moved_introduction after update of vendor_id, introduced_party_id on introduction
	for each row when (old.vendor_id <> new.vendor_id or old.introduced_party_id <> new.introduced_party_id)
	execute function keep_recorded_introduction();

create table doc_judgment_destination (
	job_id uuid not null,
	job_kind text generated always as ('email_filing') stored,
	position integer not null check (position > 0),
	deal_id uuid references deal,
	vendor_id uuid references party,
	vendor_role text generated always as ('vendor') stored,
	primary key (job_id, position),
	foreign key (job_id, job_kind) references doc_judgment_job (id, kind) on delete cascade,
	-- The merge moves roles first, then follows the party reference above.
	foreign key (vendor_id, vendor_role) references party_role (party_id, role) deferrable initially deferred,
	check (num_nonnulls(deal_id, vendor_id) = 1)
);

-- A filing job and its first destination must be written in the same transaction.
alter table doc_judgment_job add foreign key (id, first_destination)
	references doc_judgment_destination (job_id, position) deferrable initially deferred;

alter table doc_judgment_destination enable row level security;
create policy doc_judgment_destination_owner on doc_judgment_destination to engine using (
	exists (select 1 from doc_judgment_job where id = job_id)
);
revoke all on doc_judgment_destination from public, engine_reader;
grant select on doc_judgment_destination to engine;

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

-- The partner login reads through these views, never the tables. Both partners see every call.
create schema next_partner;
grant usage on schema next_partner to engine, engine_reader;

create view next_partner.activity as
	select a.* from activity a;

create view next_partner.next_step as
	select s.call_activity_id, s.call_contact_party_id, s.call_kind, s.changed_at, s.changed_by_job,
		s.changed_by_user_id, s.changed_for_user_id, s.created_at, s.deal_id, s.done_at, s.due_on, s.hold_until,
		s.home_call_follow_up_id, s.home_step_id, s.id, s.item_bullets, s.item_title, s.owner_party_id, s.party_id,
		s.property_id, s.resolution, s.resolution_event_id, s.resolved_at, s.source_ref,
		s.status, s.what, s.call_evidence_quote, s.resolution_reason
	from next_step s;

create view next_partner.deal_phase_change as
	-- Plain columns let a deal filter reach the table instead of checking every row.
	select m.deal_id, m.happened_at, m.phase, m.reason,
		m.call_activity_id, m.call_move_id, m.call_kind, m.changed_by_user_id, m.changed_by_job,
		m.changed_for_user_id, m.changed_at
	from deal_phase_change m;

create view next_partner.imported_automatic_phase_move as
	select c.source_event_id, c.deal_id, c.happened_at, c.prior_phase, c.reason
	from imported_automatic_phase_move c;

create view next_partner.proposal as
	select p.activity_id, p.activity_kind, p.call_deal_id, p.candidate_id, p.changed_at, p.changed_by_job,
		p.changed_by_user_id, p.changed_for_user_id, p.created_at, p.deal_id, p.decided_at, p.decided_by_user_id,
		p.due_on, p.due_source, p.filed_deal_id, p.filed_vendor_id, p.filing_reason,
		p.filing_scope, p.from_phase, p.from_stage, p.held_deal_id, p.how_found, p.id, p.keeps_deal_date, p.kind,
		p.lead_role, p.merged_step_id, p.next_step_id, p.owner_party_id, p.party_id, p.phase_on, p.phase_stated,
		p.property_id, p.proposed_by_job, p.status, p.step_seen_at, p.strength, p.superseded_reason, p.to_phase,
		p.to_stage, p.evidence, p.reason, p.dismiss_reason, p.what
	from proposal p;

create view next_partner.lead_stage_move as
	select m.* from lead_stage_move m;

-- Each partner reads only their own updates. A checklist update whose item is gone keeps no wording.
create view next_partner.home_update with (security_barrier = true) as
	select visible.* from home_update u left join next_step s on s.deal_id = u.deal_id
		and 'deal-item:' || s.id = u.checklist_item_ref
	cross join lateral jsonb_populate_record(u, jsonb_build_object('what',
		case when u.checklist_item_ref like 'deal-item:%' and s.id is null
			then 'A deal checklist item is due. Open the deal checklist for details.'
			else u.what end)) visible
	where u.user_id = nullif(current_setting('engine.user_id', true), '')::uuid;

create view next_partner.change with (security_barrier = true) as
	-- Preserve audit keys so the planner can use the table-name index condition.
	select c.id, c.table_name, c.record, c.action,
		case when c.table_name = 'home_update' then c.old_value - 'what' else c.old_value end as old_value,
		case when c.table_name = 'home_update' then c.new_value - 'what' else c.new_value end as new_value,
		c.merge_of, c.changed_by_user_id, c.changed_by_job, c.changed_for_user_id, c.changed_at
	from change c
	where case
	when c.table_name = 'lead_stage_move' then exists (
		select from lead_stage_move m left join next_partner.activity a on a.id = m.activity_id
		where m.id = (c.record ->> 'id')::uuid and (m.activity_id is null or a.id is not null))
	when c.table_name = 'home_update' then exists (
		select from next_partner.home_update u where u.id = (c.record ->> 'id')::uuid)
	else true end;

create view next_partner.imported_change as
	select visible.* from imported_change c
	cross join lateral jsonb_populate_record(c, jsonb_build_object('source_event',
		c.source_event - array['human_quote', 'agent_rationale'])) visible;

alter view deal_imported_history set (security_invoker = false);
create view next_partner.deal_imported_history as
	select h.deal_id, h.events from deal_imported_history h;

create view next_partner.deal_next_date as
	select distinct on (s.deal_id) s.deal_id, s.due_on from next_partner.next_step s
	where s.deal_id is not null and s.item_title is null and (s.status = 'open' or exists (
		select from next_partner.proposal p where p.next_step_id = s.id and p.keeps_deal_date and p.decided_at = s.done_at
		and not exists (select from next_partner.next_step newer where newer.deal_id = s.deal_id
			and newer.item_title is null and newer.created_at > p.decided_at)))
	order by s.deal_id, s.created_at desc, s.id desc;

revoke all on activity, next_step, proposal, deal_phase_change, lead_stage_move, change, imported_change,
	imported_automatic_phase_move, imported_deal_history, deal_imported_history, home_update, doc_turn
	from public, engine_reader;
revoke select (deal_id, happened_at, phase, call_activity_id, call_kind, call_move_id,
	changed_at, changed_by_user_id, changed_by_job, changed_for_user_id) on deal_phase_change from engine_reader;
revoke execute on function everything_about_deal(uuid), everything_about_party(uuid), activity_entry(activity)
	from public, engine_reader;
grant execute on function everything_about_deal(uuid), everything_about_party(uuid), activity_entry(activity) to engine;
grant select on next_partner.activity, next_partner.next_step, next_partner.deal_phase_change,
	next_partner.imported_automatic_phase_move, next_partner.proposal, next_partner.lead_stage_move,
	next_partner.home_update, next_partner.change, next_partner.imported_change,
	next_partner.deal_imported_history, next_partner.deal_next_date to engine_reader;
grant select on next_partner.home_update to engine;
