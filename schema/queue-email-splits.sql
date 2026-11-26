-- Queues one split for each stored email that still has no authored text (#1404).
-- Run once as the schema owner, after add-email-split-job.sql and the Outlook recovery apply:
--   psql -X -v apply=on -f schema/queue-email-splits.sql
-- Without -v apply=on the run counts what it would queue and rolls back. Stdout shows only counts.
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

begin;
set local search_path = next;

do $$
declare
	copy record;
begin
	if to_regprocedure('next.queue_email_split(uuid)') is null then
		raise exception 'Install schema/add-email-split-job.sql first';
	end if;
	-- Capture's stamp and lock, so each email gets the same single split capture would give it.
	perform set_config('engine.job', 'mail_capture', true);
	for copy in
		select e.activity_id, m.user_id, coalesce(e.message_id, e.activity_id::text) as lock_key
		from email e join email_mailbox m using (activity_id)
		where e.authored is null order by e.activity_id, m.user_id
	loop
		perform pg_advisory_xact_lock(hashtextextended('email ' || copy.lock_key, 0));
		perform set_config('engine.user_id', copy.user_id::text, true);
		perform queue_email_split(copy.activity_id);
	end loop;
end $$;

\pset format csv
-- A later capture's queued_at is not this transaction's now(). Count every existing job as already queued.
select count(*) as unsplit,
	count(*) filter (where queued_at = now()) as queued,
	count(*) filter (where queued_at is not null and queued_at <> now()) as already_queued,
	count(*) filter (where queued_at is null) as not_queued
from email e, lateral (
	select min(created_at) as queued_at from doc_judgment_job
	where activity_id = e.activity_id and kind = 'email_split'
) j
where e.authored is null;

\if :apply
commit;
\echo applied
\else
rollback;
\echo dry_run
\endif
