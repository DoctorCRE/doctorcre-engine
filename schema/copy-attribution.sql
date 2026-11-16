-- Load once with search_path set to the new schema, after next.sql and before any copy.
-- The last event must name the row's author; an older author's sponsor cannot sign a later change.
create or replace function copy_attribution(old_type text, old_id uuid, author_id uuid, old_field text default null)
returns table (changed_by_user_id uuid, changed_by_job text, changed_for_user_id uuid)
language sql stable
begin atomic
	with last_event as (
		select actor_id, cause, sponsoring_human_slug
		from public.event
		where subject_type = old_type and subject_id = old_id and (old_field is null or field = old_field)
		order by mutation_order desc limit 1
	), attribution as (
		select a.kind, a.id, case
			when a.kind = 'human' then null
			when a.kind = 'automation' and a.slug in ('claude', 'codex', 'grok', 'joe-local', 'dell-local') then 'agent'
			when a.kind = 'automation' and e.cause = 'ingest_email' then 'mail_capture'
			else 'old_system'
		end as job, sponsor.id as sponsor_id
		from (values (author_id)) as author (id)
		left join public.actor a on a.id = author.id
		left join last_event e on e.actor_id = a.id
		left join public.actor sponsor on sponsor.slug = e.sponsoring_human_slug and sponsor.kind = 'human'
	)
	select case when kind = 'human' then id end, job,
		case when job in ('agent', 'mail_capture') then sponsor_id end
	from attribution;
end;
