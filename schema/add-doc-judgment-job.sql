-- Install before the mail summary and filing enqueue functions.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

create table if not exists doc_judgment_job (
	id uuid primary key default gen_random_uuid(),
	owner_user_id uuid not null,
	is_account_partner boolean not null generated always as (true) stored,
	activity_id uuid not null,
	idempotency_key uuid not null,
	created_at timestamptz not null default now(),
	kind text not null check (kind in ('email_summary', 'email_filing')),
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
do $$ begin
	if not exists (
		select from pg_policy where polrelid = 'doc_judgment_job'::regclass and polname = 'doc_judgment_owner'
	) then
		create policy doc_judgment_owner on doc_judgment_job to engine using (
			owner_user_id = nullif(current_setting('engine.user_id', true), '')::uuid
			and nullif(current_setting('engine.job', true), '') is null
		);
	end if;
end $$;
revoke all on doc_judgment_job from public, engine_reader;
grant select on doc_judgment_job to engine;
grant update (state, claim_id, claim_until, claim_source_hash, result) on doc_judgment_job to engine;

create table if not exists doc_judgment_destination (
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
do $$ begin
	if not exists (
		select from pg_constraint where conrelid = 'doc_judgment_job'::regclass
			and conname = 'doc_judgment_job_id_first_destination_fkey'
	) then
		alter table doc_judgment_job add foreign key (id, first_destination)
			references doc_judgment_destination (job_id, position) deferrable initially deferred;
	end if;
end $$;

alter table doc_judgment_destination enable row level security;
do $$ begin
	if not exists (
		select from pg_policy where polrelid = 'doc_judgment_destination'::regclass and polname = 'doc_judgment_destination_owner'
	) then
		create policy doc_judgment_destination_owner on doc_judgment_destination to engine using (
			exists (select 1 from doc_judgment_job where id = job_id)
		);
	end if;
end $$;
revoke all on doc_judgment_destination from public, engine_reader;
grant select on doc_judgment_destination to engine;

commit;

-- Read back queue tables, row security, and engine grants.
-- select oid::regclass, relrowsecurity, relacl
-- from pg_class where oid in ('next.doc_judgment_job'::regclass, 'next.doc_judgment_destination'::regclass);
-- select tablename, policyname, roles, qual from pg_policies
-- where schemaname = 'next' and tablename in ('doc_judgment_job', 'doc_judgment_destination');
-- select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
-- where conrelid in ('next.doc_judgment_job'::regclass, 'next.doc_judgment_destination'::regclass);
-- select attname, attacl from pg_attribute
-- where attrelid = 'next.doc_judgment_job'::regclass and attacl is not null;
