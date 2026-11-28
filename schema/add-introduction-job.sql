-- Apply after the email split job migration.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

do $$ begin
	if to_regclass('next.doc_judgment_job') is null or to_regclass('next.lead_source_sender') is null
		or to_regclass('next.lead_email_source') is null
		or to_regprocedure('next.queue_email_summary(uuid)') is null
		or to_regclass('next.doc_judgment_job_one_split') is null
		or to_regprocedure('next.queue_email_split(uuid)') is null
		or not exists (select from pg_attribute where attrelid = to_regclass('next.email')
			and attname = 'authored' and not attisdropped) then
		raise exception 'Install the email split job and its prerequisites before the introduction job';
	end if;
end $$;

alter table introduction
	add column if not exists confirmed boolean not null default true,
	add column if not exists source_job_id uuid,
	add column if not exists source text generated always as (case when source_job_id is not null then 'found in email' end) stored,
	drop constraint if exists introduction_source_job_id_fkey,
	add foreign key (source_job_id) references doc_judgment_job on delete restrict,
	drop constraint if exists introduction_email_evidence,
	add constraint introduction_email_evidence check (
		(confirmed or source_job_id is not null) and (source_job_id is null or introduced_on is not null)
	);

alter table introduction enable row level security;
drop policy if exists confirmed_introduction on introduction;
create policy confirmed_introduction on introduction to engine, engine_reader
	using (confirmed) with check (confirmed or current_setting('engine.job', true) = 'mail_capture');

-- A recorded row wins, including when a partner records it after the mail job.
create or replace function keep_recorded_introduction() returns trigger
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
create or replace trigger keep_recorded_introduction before insert or update of introduced_on, confirmed on introduction
	for each row execute function keep_recorded_introduction();

-- The old row must move before discarding a duplicate so a party merge can release its foreign keys.
create or replace trigger dedup_moved_introduction after update of vendor_id, introduced_party_id on introduction
	for each row when (old.vendor_id <> new.vendor_id or old.introduced_party_id <> new.introduced_party_id)
	execute function keep_recorded_introduction();

alter table doc_judgment_job drop constraint if exists doc_judgment_job_kind_check,
	add constraint doc_judgment_job_kind_check check (kind in ('email_summary', 'email_filing', 'email_split', 'introduction'));

create unique index if not exists doc_judgment_job_one_introduction on doc_judgment_job (activity_id) where kind = 'introduction';

create or replace function queue_introduction(email_id uuid) returns void
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

create or replace view vendor_track_record as
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

commit;
