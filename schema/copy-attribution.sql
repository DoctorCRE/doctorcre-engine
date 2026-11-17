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

-- Setting or restoring a next step writes its note under the deal's lock, after its event's transaction starts and before it is recorded.
-- A waiting transaction can start before an earlier one writes, so a note pairs only with an event when each is the other's nearest match.
create or replace function copy_next_step_event()
returns table (note_id uuid, event_id uuid)
language sql stable
begin atomic
	select note_id, event_id from (
	 select n.id as note_id, e.id as event_id,
	  -- Each counts the candidates at least as near as this one, so a tie pairs nothing.
	  count(*) over (partition by n.id order by e.recorded_at) as nearer_events,
	  count(*) over (partition by e.id order by n.created_at desc) as nearer_notes
	 from public.deal_note n join public.event e on e.subject_type = 'deal' and e.subject_id = n.deal_id and e.actor_id = n.actor_id
	  and e.field = 'next_step' and e.new_value ->> 'next_step' = n.text and n.created_at between e.occurred_at and e.recorded_at
	 where n.kind = 'next_step'
	) m where nearer_events = 1 and nearer_notes = 1;
end;

-- Each old action's end state as its latest closing event proves it. A later keep or reopen leaves no proof.
-- A cancellation needs one partner drop with its reason, on the row as that drop left it.
create or replace function copy_action_end()
returns table (id uuid, resolution text, proven boolean, done_at timestamptz, resolved_at timestamptz,
	resolution_reason text, resolution_event_id uuid, refusal text)
language sql stable
begin atomic
	with closure as (
		select distinct on (e.action_id, e.resolution) e.*, count(*) over (partition by e.action_id, e.resolution) as events
		from (select e.new_value ->> 'next_action_id' as action_id, 'cancelled' as resolution, e.id, e.occurred_at, e.mutation_order,
				coalesce(e.new_value ->> 'reason', e.human_quote) as reason, e.new_value ->> 'version' as version, true as proves
			from public.event e where e.verb = 'drop-action'
			union all
			select r ->> 'id', 'expired', e.id, e.occurred_at, e.mutation_order, null, null, e.new_value ->> 'action' = 'drop'
			from public.event e cross join jsonb_array_elements(e.new_value -> 'rows') r
			where e.verb = 'clear-the-deck-apply' and e.new_value ->> 'kind' = 'next_action'
				and (e.new_value ->> 'action' = 'keep' or r ->> 'status' = 'open')
			union all
			select coalesce(e.new_value ->> 'next_action_id', e.new_value ->> 'item_id', e.new_value ->> 'action_id', e.new_value ->> 'completed'),
				'done', e.id, e.occurred_at, e.mutation_order, null, null, e.verb <> 'reopen-one-action'
			from public.event e
			where e.verb in ('complete-one-action', 'complete-deal-item', 'reopen-one-action', 'complete-action', 'log-outreach')) e
		order by e.action_id, e.resolution, e.mutation_order desc
	), action as (
		select n.id, n.status, n.version, null::timestamptz as completed_at from public.next_action n
		union all
		select n.id, n.status, n.version, n.completed_at from public.capture_post_call_action n
	)
	select n.id, s.resolution, p.proven,
		case when s.resolution = 'done' then coalesce(n.completed_at, case when p.proven then c.occurred_at end) end,
		case when s.resolution <> 'done' and p.proven then c.occurred_at end,
		case when s.resolution = 'cancelled' and p.proven then c.reason end,
		case when s.resolution <> 'done' and p.proven then c.id end,
		case when s.resolution = 'cancelled' and not p.proven then case when coalesce(c.reason, '') !~ '\S'
			then 'cancellation_reason_missing' else 'cancellation_evidence_conflict' end end
	from action n
	cross join lateral (values (case n.status when 'done' then 'done' when 'dropped' then 'cancelled'
		when 'expired' then 'expired' end)) s(resolution)
	left join closure c on c.action_id = n.id::text and c.resolution = s.resolution
	cross join lateral (values (coalesce(case when s.resolution <> 'cancelled' then c.proves
		else c.events = 1 and c.version = n.version::text and c.reason ~ '\S' end, false))) p(proven)
	where s.resolution is not null;
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

-- Logging an activity today writes an event on the record it is about, naming the activity.
create or replace function copy_activity_event()
returns table (activity_id uuid, event_id uuid)
language sql stable
begin atomic
	select distinct on (new_value ->> 'activity') (new_value ->> 'activity')::uuid, id
	from public.event where verb = 'log-activity' and new_value ->> 'activity' ~ '^[0-9a-f-]{36}$'
	order by new_value ->> 'activity', mutation_order desc;
end;

-- A client, lead or vendor is about its person or company; merged-away ids reach their survivor through the map.
create or replace function copy_activity_link()
returns table (id uuid, field text, value uuid, deal_id uuid, party_id uuid)
language sql stable
begin atomic
	select k.id, k.field, k.value, o.deal_id, o.party_id
	from (
		select a.id, f.field, f.value, f.lookup from public.activity a
		left join public.client c on c.id = a.client_id
		left join public.lead l on l.id = a.lead_id
		left join public.vendor v on v.id = a.vendor_id
		cross join lateral (values ('deal_id', a.deal_id, a.deal_id), ('client_id', a.client_id, c.party_id),
			('lead_id', a.lead_id, l.party_id), ('vendor_id', a.vendor_id, v.party_id), ('party_id', a.party_id, a.party_id)) f(field, value, lookup)
		where f.value is not null
		union all
		select id, 'deal_id', deal_id, deal_id from public.deal_note
	) k left join outside_id o on o.source = 'old_system' and o.value = k.lookup::text;
end;
