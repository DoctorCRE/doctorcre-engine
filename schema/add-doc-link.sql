-- Install on an existing next schema before enabling Doc link (#976).
-- Read-only preflight:
-- SELECT to_regclass('next.doc_link') IS NOT NULL AS doc_link_exists;
-- If false, apply this file. If true, skip the already-applied migration.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create table doc_link (
	owner_user_id uuid primary key,
	is_account_partner boolean not null generated always as (true) stored,
	credential_hash text not null unique check (credential_hash ~ '^[0-9a-f]{64}$'),
	issued_at timestamptz not null default now(),
	last_seen_at timestamptz,
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
grant update (credential_hash, issued_at, last_seen_at) on doc_link to engine;

commit;
