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

-- A person who uses the system, and the home for their own preferences. "user" is reserved in PostgreSQL.
create table app_user (
	id uuid primary key,
	kind text not null generated always as ('person') stored,
	created_at timestamptz not null default now(),
	foreign key (id, kind) references party (id, kind)
);

-- The automatic jobs that change rows. A change names a user or a job, so a person's change is told from a job's.
create table job (
	slug text primary key,
	label text not null
);

insert into job values
	('intake', 'Post intake'), ('mail_capture', 'Mail filing'), ('publisher', 'Publisher'), ('readings', 'Post readings'),
	('review_close', 'Review close'), ('agent', 'Agent'), ('old_system', 'Old system');

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
	primary key (party_id, role),
	foreign key (role, stage) references stage,
	constraint party_role_level_on_vendor check (relationship_level is null or role = 'vendor'),
	constraint party_role_disposition_on_vendor check (disposition is null or role = 'vendor'),
	constraint party_role_ruling_has_a_reason check ((disposition is null) = (disposition_reason is null)),
	constraint party_role_target_on_vendor check (not is_target or role = 'vendor')
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
	reason text not null check (reason ~ '\S')
);

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

create table deal (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	name text not null
);

-- Import history only: another system's id for a record, such as Salesforce's or a roster's. People never search by it.
create table outside_id (
	source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
	value text not null check (value ~ '^\S(.*\S)?$'),
	party_id uuid references party,
	deal_id uuid references deal,
	constraint outside_id_one_record check (num_nonnulls(party_id, deal_id) = 1),
	primary key (source, value)
);

create table phase (
	slug text primary key,
	label text not null
);

create table deal_phase_change (
	deal_id uuid not null references deal,
	happened_at timestamptz not null,
	phase text not null references phase,
	reason text,
	primary key (deal_id, happened_at),
	constraint deal_phase_change_dead_has_reason check (phase <> 'dead' or reason is not null)
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

-- An introduction between a vendor and the team, made either way, and the deal it led to once there is one.
create table introduction (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	vendor_id uuid not null,
	vendor_role text not null default 'vendor' check (vendor_role = 'vendor'),
	made_by text not null check (made_by in ('vendor', 'team')),
	introduced_by_user_id uuid references app_user,
	-- Whom the vendor introduced to the team, or the team to the vendor.
	introduced_party_id uuid not null references party,
	introduced_on date,
	deal_id uuid references deal,
	note text check (note ~ '\S'),
	constraint introduction_of_someone_else check (introduced_party_id <> vendor_id),
	constraint introduction_team_names_its_user check ((made_by = 'team') = (introduced_by_user_id is not null)),
	-- Only a merge changes a party_role key, and its introductions move with it.
	foreign key (vendor_id, vendor_role) references party_role on update cascade
);

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
	(select count(distinct deal_id) from introduction where vendor_id = v.party_id and made_by = 'vendor')
		as deals_it_introduced,
	(select count(distinct deal_id) from introduction where vendor_id = v.party_id and made_by = 'team')
		as deals_we_introduced
from party_role v
left join worked w using (party_id)
where v.role = 'vendor'
group by v.party_id;

create table activity (
	id uuid primary key default gen_random_uuid(),
	kind text not null check (kind in ('email', 'call', 'meeting', 'note')),
	happened_at timestamptz not null,
	from_party_id uuid references party,
	summary text,
	unique (id, kind)
);

create table activity_about (
	activity_id uuid not null references activity,
	deal_id uuid references deal,
	party_id uuid references party,
	property_id uuid references property,
	created_at timestamptz not null default now(),
	constraint activity_about_one_record check (num_nonnulls(deal_id, party_id, property_id) = 1),
	unique nulls not distinct (activity_id, deal_id, party_id, property_id)
);

-- Only the new text is kept; the date is the activity's, and the mailbox stays the full record.
create table email (
	activity_id uuid primary key,
	activity_kind text not null generated always as ('email') stored,
	message_id text not null unique check (message_id = btrim(message_id)),
	-- Matched to a person through party_email.
	sender email_address not null,
	subject text not null,
	body text not null,
	foreign key (activity_id, activity_kind) references activity (id, kind)
);

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

create table next_step (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	what text not null,
	owner_party_id uuid references party,
	due_on date,
	done_at timestamptz,
	deal_id uuid references deal,
	party_id uuid references party,
	property_id uuid references property,
	constraint next_step_one_record check (num_nonnulls(deal_id, party_id, property_id) = 1)
);

create table document (
	id uuid primary key default gen_random_uuid(),
	created_at timestamptz not null default now(),
	name text not null,
	r2_key text not null,
	-- Read from the file's own bytes when it is stored.
	content_type text,
	email_activity_id uuid references email,
	unique (id, content_type)
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
	status text not null default 'open'
		check (status in ('open', 'countered', 'accepted', 'rejected', 'withdrawn', 'superseded')),
	rent_per_sf_yr numeric(10, 2) check (rent_per_sf_yr >= 0),
	nnn_per_sf_yr numeric(10, 2) check (nnn_per_sf_yr >= 0),
	term_months integer check (term_months >= 0),
	ti_per_sf numeric(10, 2) check (ti_per_sf >= 0),
	free_rent_months numeric(4, 1) check (free_rent_months >= 0),
	escalation_pct numeric(5, 2) check (escalation_pct >= 0),
	commencement_on date,
	commencement_days_after_delivery integer check (commencement_days_after_delivery >= 0),
	other_terms text,
	constraint offer_answers_earlier_round check (answers_round < round),
	constraint offer_commencement_date_or_days
		check (commencement_on is null or commencement_days_after_delivery is null),
	unique (deal_id, round),
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
	if not (old.status = 'open' and new.status <> 'superseded'
		or old.status = 'accepted' and new.status = 'superseded') then
		raise exception 'a round''s status moves only out of open, or from accepted to superseded'
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

create function everything_about_deal(wanted uuid) returns jsonb
language sql stable
begin atomic
	select jsonb_build_object(
		'deal', to_jsonb(d),
		'phases', (
			select coalesce(jsonb_agg(to_jsonb(c) - 'deal_id' order by c.happened_at), '[]')
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
			select coalesce(jsonb_agg(to_jsonb(o) - 'deal_id' || jsonb_build_object('documents', (
				select coalesce(jsonb_agg(to_jsonb(doc) order by doc.name, doc.id), '[]')
				from offer_document od join document doc on doc.id = od.document_id
				where od.offer_id = o.id
			)) order by o.round), '[]')
			from offer o
			where o.deal_id = d.id
		),
		'activity', (
			select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('email', (
				select to_jsonb(e) - 'activity_id' - 'activity_kind' || jsonb_build_object('documents', (
					select coalesce(jsonb_agg(to_jsonb(doc) order by doc.name, doc.id), '[]')
					from document doc
					where doc.email_activity_id = e.activity_id
				))
				from email e
				where e.activity_id = a.id
			)) order by a.happened_at, a.id), '[]')
			from activity_about aa join activity a on a.id = aa.activity_id
			where aa.deal_id = d.id
		),
		'next_steps', (
			select coalesce(jsonb_agg(to_jsonb(s) - 'deal_id' - 'party_id' - 'property_id'
				order by s.due_on nulls last, s.id), '[]')
			from next_step s
			where s.deal_id = d.id
		)
	)
	from deal d
	where d.id = wanted;
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

-- Everything that points at the duplicate moves to the survivor, and the duplicate is removed (decision 39).
-- It runs with the owner's rights, because it also moves history the engine never rewrites, such as rounds and outside ids.
create function merge_party(duplicate uuid, survivor uuid) returns void
language plpgsql security definer as $$
declare
	pointer record;
	duplicate_npi text;
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

	-- Moved first, because the duplicate's vendor role is removed next when the survivor holds one.
	update introduction set vendor_id = survivor
	where vendor_id = duplicate and exists (select from party_role where party_id = survivor and role = vendor_role);
	-- Where both hold the same link, the survivor's row stays, and so does its primary email and phone.
	-- Its stage and level stay too, and the duplicate's fill any it lacks. A target on either holds.
	-- The stricter ruling stays with its reason, so a merge never puts an avoided vendor back in play.
	update party_role s set stage = coalesce(s.stage, d.stage),
		relationship_level = coalesce(s.relationship_level, d.relationship_level),
		(disposition, disposition_reason) = (
			select ruling, reason
			from (values (s.disposition, s.disposition_reason, 1), (d.disposition, d.disposition_reason, 2)) r (ruling, reason, side)
			order by array_position(array['parked', 'avoid'], ruling) desc nulls last, side limit 1),
		is_target = s.is_target or d.is_target
	from party_role d where s.party_id = survivor and d.party_id = duplicate and d.role = s.role;
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
	delete from activity_about d using activity_about s
	where d.party_id = duplicate and s.party_id = survivor and s.activity_id = d.activity_id;
	delete from party_territory d using party_territory s
	where d.party_id = duplicate and s.party_id = survivor and s.territory_id = d.territory_id
		and s.started_on is not distinct from d.started_on;

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

	delete from party where id = duplicate returning npi into duplicate_npi;
	update party set npi = coalesce(npi, duplicate_npi) where id = survivor;
	insert into merged_party (id, survivor_id) values (duplicate, survivor);
end $$;

-- Pinned, with pg_temp last, so a caller's own tables cannot stand in for these.
do $$ begin
	execute format('alter function merge_party set search_path = %I, pg_temp', current_schema());
end $$;

-- Each of these rows says which user or job last changed it and when, set by the database, never by the statement.
-- The check holds the owner's load of old rows too, which turns the trigger off.
do $$
declare
	stamped text;
begin
	foreach stamped in array array['role', 'stage', 'phase', 'party', 'party_email', 'party_phone', 'party_role', 'party_company',
		'do_not_contact', 'specialty', 'party_specialty', 'outside_id', 'property', 'market', 'market_county', 'territory',
		'territory_piece', 'party_territory', 'deal', 'introduction', 'deal_phase_change', 'deal_property', 'deal_party', 'activity',
		'activity_about', 'next_step', 'document', 'email', 'offer', 'offer_document', 'social_account', 'idea',
		'design_template', 'post', 'post_text', 'post_media', 'post_review', 'measurement',
		'merged_party'] loop
		execute format('alter table %1$I add changed_by_user_id uuid references app_user %2$s,
				add changed_by_job text references job,
				add changed_for_user_id uuid references app_user,
				add changed_at timestamptz not null,
				add constraint %3$I check (num_nonnulls(changed_by_user_id, changed_by_job) = 1
					and (changed_by_job is not null or changed_for_user_id is null));
			create trigger stamp_change before insert or update on %1$I
				for each row execute function stamp_change()',
			-- A new user's own person row names them before their user row exists.
			stamped, case stamped when 'party' then 'deferrable initially deferred' end,
			stamped || '_changed_by_a_user_or_a_job');
	end loop;
end $$;

-- A text edit, an edit's review and a cancel name a user, as its author or the one a job worked for.
alter table post_text add constraint post_text_edit_by_a_user
	check (version = 1 or coalesce(changed_by_user_id, changed_for_user_id) is not null);
alter table post_review add constraint post_review_by_a_user
	check ((outcome = 'no_response') = (coalesce(changed_by_user_id, changed_for_user_id) is null));

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

-- The engine's role. A login takes it with "grant engine to <login>"; the owner's own login is not the engine's concern.
-- It reads everywhere, adds everywhere but app_user, job, merged_party, platform_metric, platform_format and relationship_level, never empties a table, and changes or removes only what the grants below name.
-- History (deal_phase_change, offer, offer_document, post and its text, media and reviews, measurement, social_sign_in, outside_id) is never removed.
do $$ begin
	begin
		create role engine nologin;
	-- Roles belong to the server and outlive a database, so a second load reuses it.
	exception when duplicate_object or unique_violation then null;
	end;
	-- A reused role must hold nothing that would reach past the grants below.
	if exists (select from pg_roles where rolname = 'engine'
			and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication))
		or exists (select from pg_auth_members where member = 'engine'::regrole) then
		raise exception 'role engine holds rights beyond its grants';
	end if;
end $$;

do $$ begin
	execute format('grant usage on schema %1$I to engine;
		grant select, insert on all tables in schema %1$I to engine', current_schema());
end $$;
-- Which metrics and formats a platform offers, and the relationship levels, are schema decisions.
revoke insert on platform_metric, platform_format, relationship_level from engine;
-- Only the owner adds a user or a job, because every change is signed with one.
revoke insert on app_user, job from engine;
-- Only a merge leaves a pointer, after it has moved everything.
revoke insert on merged_party from engine;
revoke execute on function merge_party from public;
grant execute on function merge_party to engine;

-- Only the owner sets when the engine starts publishing for an account, even on an account the engine adds.
revoke insert on social_account from engine;
grant insert (id, created_at, platform, owner_party_id, handle, platform_account_id) on social_account to engine;

grant delete on party, party_email, party_phone, do_not_contact, party_specialty, property, market, market_county,
	territory, territory_piece, party_territory, deal, party_role, party_company, deal_property, deal_party, activity,
	activity_about, email, next_step, document, social_account, idea, design_template, introduction to engine;

-- Ids, created_at and the records a link or an about row joins never change; a different link is a removed row and a new one.
-- Who sent an activity and who owns a next step can be corrected.
grant update (label) on table role, stage, phase, specialty to engine;
grant update (stage, relationship_level, disposition, disposition_reason, is_target) on party_role to engine;
grant update (introduced_on, deal_id, note) on introduction to engine;
grant update (name) on party, market, territory, deal, document, design_template to engine;
grant update (npi) on party to engine;
grant update (address, county_fips, latitude, longitude) on property to engine;
grant update (title, started_on, ended_on) on party_company to engine;
grant update (started_on, ended_on) on party_territory to engine;
grant update (label, is_primary) on party_email, party_phone to engine;
grant update (happened_at, from_party_id, summary) on activity to engine;
grant update (what, owner_party_id, due_on, done_at) on next_step to engine;
grant update (status) on offer to engine;
grant update (handle, platform_account_id) on social_account to engine;
grant update (angle, hook, pillar) on idea to engine;
grant update (status, reason, platform_post_id, published_at) on post to engine;
