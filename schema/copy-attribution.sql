-- Load once with search_path set to the new schema, after next.sql and before any copy.
-- The event must name the author; an older author's sponsor cannot sign a later change.
create or replace function copy_event_attribution(author_id uuid, event_id uuid)
returns table (changed_by_user_id uuid, changed_by_job text, changed_for_user_id uuid)
language sql stable
begin atomic
	with attribution as (
		select a.kind, a.id, case
			when a.kind = 'human' then null
			-- Interactive runtimes registered in old migrations 0074, 0095, 0169 and 0469.
			when a.kind = 'automation' and a.slug in ('claude', 'codex', 'grok', 'hermes-pilot', 'joe-local', 'dell-local') then 'agent'
			when a.kind = 'automation' and e.cause = 'ingest_email' then 'mail_capture'
			else 'old_system'
		end as job, sponsor.id as sponsor_id
		from (values (author_id)) as author (id)
		left join public.actor a on a.id = author.id
		left join public.event e on e.id = event_id and e.actor_id = a.id
		left join public.actor sponsor on sponsor.slug = e.sponsoring_human_slug and sponsor.kind = 'human'
	)
	select case when kind = 'human' then id end, job,
		case when job in ('agent', 'mail_capture') then sponsor_id end
	from attribution;
end;

create or replace function copy_attribution(old_type text, old_id uuid, author_id uuid, old_field text default null)
returns table (changed_by_user_id uuid, changed_by_job text, changed_for_user_id uuid)
language sql stable
begin atomic
	select * from copy_event_attribution(author_id, (
		select id from public.event
		where subject_type = old_type and subject_id = old_id and (old_field is null or field = old_field)
		order by mutation_order desc limit 1));
end;

-- A phone projection wins; otherwise the one text-bearing meeting record, unless a logged activity carries it.
create or replace function copy_capture_summary(capture_session_id uuid, is_logged boolean)
returns table (summary text, records bigint)
language sql stable
begin atomic
	select coalesce(nullif(concat_ws(E'\n\n', nullif(btrim(p.projection ->> 'summary'), ''),
		(select 'Decisions:' || string_agg(E'\n- ' || btrim(d.value), '' order by d.n)
			from jsonb_array_elements_text(p.projection -> 'decisions') with ordinality d(value, n) where d.value ~ '\S'),
		(select 'Open questions:' || string_agg(E'\n- ' || btrim(q.value), '' order by q.n)
			from jsonb_array_elements_text(p.projection -> 'open_questions') with ordinality q(value, n) where q.value ~ '\S')), ''),
		case when not is_logged then record.text end), record.records
	from (select count(*) as records, case when count(*) = 1 then max(concat_ws(E'\n\n',
			case when c.payload ->> 'summary' ~ '\S' then c.payload ->> 'summary' end,
			case when c.payload ->> 'detail' ~ '\S' then c.payload ->> 'detail' end)) end as text
		from public.capture_candidate c
		where c.session_id = capture_session_id and c.kind = 'meeting_record' and c.status <> 'skipped'
			and (c.payload ->> 'summary' ~ '\S' or c.payload ->> 'detail' ~ '\S')) record
	left join public.phone_call_session p on p.id = capture_session_id;
end;

create or replace function copy_outside_id(source_system text, external_key text)
returns table (source text, value text)
language sql immutable
begin atomic
	select btrim(regexp_replace(lower(source_system), '[^a-z0-9]+', '_', 'g'), '_'),
		regexp_replace(external_key, '^\s+|\s+$', '', 'g');
end;
