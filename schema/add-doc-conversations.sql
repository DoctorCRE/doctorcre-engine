-- Install on an existing next schema before enabling Doc (#953).
-- Read-only preflight:
-- SELECT to_regclass('next.doc_conversation') IS NOT NULL AS conversation_exists,
--        to_regclass('next.doc_turn') IS NOT NULL AS turn_exists;
-- If both are false, apply this file. If both are true, skip the already-applied migration.
-- If only one exists, stop and inspect the schema.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

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
	answer jsonb check (jsonb_typeof(answer) = 'object'),
	confirmation_key uuid unique references save_receipt (idempotency_key) deferrable initially deferred,
	unique (conversation_id, position),
	unique (owner_user_id, idempotency_key),
	unique (id, owner_user_id),
	foreign key (conversation_id, owner_user_id) references doc_conversation (id, owner_user_id),
	check (
		(state = 'working' and claim_id is not null and claim_until is not null and answer is null)
		or (state = 'failed' and claim_id is null and claim_until is null and answer is null)
		or (state = 'answered' and claim_id is null and claim_until is null and answer is not null)
	),
	check (confirmation_key is null or coalesce(jsonb_typeof(answer -> 'proposal') = 'object', false))
);
create unique index doc_turn_one_working on doc_turn (conversation_id) where state = 'working';

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
grant update (state, claim_id, claim_until, answer) on doc_turn to engine;

commit;
