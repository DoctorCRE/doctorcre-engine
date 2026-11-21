begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create table if not exists lead_source_sender (
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
create unique index if not exists lead_source_sender_address_unique on lead_source_sender (lower(address));

do $$ begin
	if exists (select from pg_roles where rolname = 'engine') then
		revoke all on lead_source_sender from engine;
		grant select on lead_source_sender to engine;
	end if;
	if exists (select from pg_roles where rolname = 'engine_reader') then
		revoke all on lead_source_sender from engine_reader;
		grant select on lead_source_sender to engine_reader;
	end if;
end $$;

commit;
