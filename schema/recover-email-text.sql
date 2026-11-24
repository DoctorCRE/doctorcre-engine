-- Fills the split and Message-ID that Outlook recovery verified for stored emails (#1225).
-- Run as the schema owner in the session that loaded the private input:
--   psql -X -f load.sql -v apply=on -f schema/recover-email-text.sql
-- load.sql fills pg_temp.email_text_recovery (activity_id uuid, user_id uuid, sender text, happened_at text,
-- subject text, body_sha256 text, authored text, history text, message_id text), the candidates columns
-- plus what Outlook gave. Without -v apply=on the run counts its outcomes and rolls back.
-- Stdout shows only a count per outcome, then dry_run or applied.
\set ON_ERROR_STOP on
\set QUIET on
\if :{?apply}
\else
\set apply off
\endif
select :'apply' in ('on', 'off') as apply_known \gset
\if :apply_known
\else
do $$ begin raise exception 'Set -v apply=on to commit, or apply=off for a dry run'; end $$;
\endif
select to_regclass('pg_temp.email_text_recovery') is not null as has_input \gset
\if :has_input
\else
do $$ begin raise exception 'Load the private input into pg_temp.email_text_recovery first'; end $$;
\endif

begin;
set local search_path = next;
-- happened_at is compared as text, so its zone is fixed like the candidates list's.
set local time zone 'UTC';
-- The old system's stamp; mail_capture would route the email again.
select set_config('engine.job', 'old_system', true) as recovery_job,
	set_config('engine.user_id', '', true) as recovery_user \gset

do $$ begin
	if exists (select from pg_temp.email_text_recovery group by activity_id having count(*) > 1) then
		raise exception 'an activity_id appears twice in pg_temp.email_text_recovery';
	end if;
	if exists (select from pg_temp.email_text_recovery
		where num_nulls(activity_id, user_id, sender, happened_at, subject, body_sha256, authored, history) > 0) then
		raise exception 'pg_temp.email_text_recovery has a row without its key, expected source or split';
	end if;
	if exists (select from pg_temp.email_text_recovery where message_id !~ '\S' or message_id <> btrim(message_id)) then
		raise exception 'pg_temp.email_text_recovery has a blank or padded message_id';
	end if;
end $$;

-- Capture's lock on each Message-ID, and filing's on an email without one, in one sorted pass.
do $$
declare
	locked text;
begin
	for locked in
		select k from (
			select message_id as k from pg_temp.email_text_recovery where message_id is not null
			union
			select coalesce(e.message_id, e.activity_id::text)
			from email e join pg_temp.email_text_recovery r on r.activity_id = e.activity_id
		) keys order by k
	loop
		perform pg_advisory_xact_lock(hashtextextended('email ' || locked, 0));
	end loop;
end $$;

select count(*) as locked_emails from (
	select from email where activity_id in (select activity_id from pg_temp.email_text_recovery)
	order by activity_id for update
) targets \gset

-- Each row is classified once; the fill and the counts read the same outcome.
create temporary table email_text_recovery_outcome on commit drop as
with checked as (
	select r.activity_id, r.authored, r.history, r.message_id as given_id, e.message_id as stored_id,
		e.authored is not null as has_pair,
		case
			when e.activity_id is null then 'not_found'
			when not exists (select from email_mailbox m where m.activity_id = r.activity_id and m.user_id = r.user_id)
				then 'not_in_mailbox'
			when (e.sender::text, a.happened_at::text, e.subject, encode(sha256(convert_to(e.body, 'UTF8')), 'hex'))
				is distinct from (r.sender, r.happened_at, r.subject, r.body_sha256) then 'source_changed'
		end as gate
	from pg_temp.email_text_recovery r
	left join email e on e.activity_id = r.activity_id
	left join activity a on a.id = e.activity_id
),
claimable as (
	select c.*, c.gate is null and c.given_id is not null and c.stored_id is null
		and not exists (select from email o where o.message_id = c.given_id) as can_claim
	from checked c
),
-- Rows given one new id fill it in activity id order; the first wins.
claimed as (
	select c.*, c.can_claim and row_number() over (partition by c.given_id, c.can_claim order by c.activity_id) = 1
		as claims
	from claimable c
)
select activity_id, authored, history, given_id, gate,
	case when gate is null then case when has_pair then 'pair_kept' else 'pair_filled' end end as pair,
	case when gate is not null then null
		when given_id is null then 'message_id_not_given'
		when stored_id = given_id then 'message_id_kept'
		when stored_id is not null then 'message_id_differs'
		when not claims then 'message_id_conflict'
		else 'message_id_filled' end as message
from claimed;

update email e set
	authored = case when o.pair = 'pair_filled' then o.authored else e.authored end,
	history = case when o.pair = 'pair_filled' then o.history else e.history end,
	message_id = case when o.message = 'message_id_filled' then o.given_id else e.message_id end
from pg_temp.email_text_recovery_outcome o
where o.activity_id = e.activity_id and (o.pair = 'pair_filled' or o.message = 'message_id_filled');

\pset format csv
select v.outcome, count(x.outcome) as rows
from (values (1, 'not_found'), (2, 'not_in_mailbox'), (3, 'source_changed'), (4, 'pair_filled'), (5, 'pair_kept'),
	(6, 'message_id_filled'), (7, 'message_id_kept'), (8, 'message_id_differs'), (9, 'message_id_conflict'),
	(10, 'message_id_not_given')) v(n, outcome)
left join (
	select gate as outcome from pg_temp.email_text_recovery_outcome
	union all select pair from pg_temp.email_text_recovery_outcome
	union all select message from pg_temp.email_text_recovery_outcome
) x on x.outcome = v.outcome
group by v.n, v.outcome order by v.n;

\if :apply
commit;
\echo applied
\else
rollback;
\echo dry_run
\endif
