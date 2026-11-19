-- Run after copy-deals.sql in an owner transaction with the new schema on search_path.
-- Load copy-attribution.sql first. Only public is read; existing notes are never overwritten.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table activity disable trigger stamp_change;
alter table activity_about disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

create temp table old_market_agent_source on commit drop as
select m.*, md5('old_system:market_agent_source:' || m.deal_id)::uuid as activity_id,
 o.deal_id as mapped_deal_id, plain.source_note, dates.text as dated_note, 'Market agent source' || E'\n\n' || dates.text as summary, author.*
from public.deal_market_assignment m
left join outside_id o on o.source = 'old_system' and o.value = m.deal_id::text
cross join (values ('^\s*salesforce (opportunity|record) 006[[:alnum:]]{12}([[:alnum:]]{3})?')) reference(pattern)
cross join lateral (select case
 when m.source ~* (reference.pattern || '(, observed \d{4}-\d\d-\d\d)?\s*$') then null
 else regexp_replace(m.source, reference.pattern || '[,;][[:blank:]]+(?=\S)', '', 'i') end as source_note) plain
cross join lateral (
 select string_agg(case when pg_input_is_valid(day.parts[2], 'date')
  then day.parts[1] || to_char(day.parts[2]::date, 'FMMonth FMDD, YYYY') || day.parts[3]
  else token[1] end, '' order by position) as text
 from regexp_matches(plain.source_note, '\S+|\s+', 'g') with ordinality as tokens(token, position)
 cross join lateral (select regexp_match(token[1],
  $re$^([(\[{"']*)(\d{4}-\d\d-\d\d)([)\]}"',;:!?]*\.?)$$re$) as parts) day
) dates
cross join lateral copy_event_attribution(m.set_by, (select e.id from public.event e
 where e.subject_type = 'deal' and e.subject_id = m.deal_id
 and (e.verb, coalesce(e.field, '')) in (('set-market-agent', 'market_agent'), ('create-national-market-deal', ''))
 and e.actor_id = m.set_by and e.occurred_at = m.set_at
 order by e.mutation_order desc limit 1)) author;

create temp table examined_market_agent_source on commit drop as
select m.*, case when source !~ '\S' then 'empty_deal_note'
 when source_note is null then 'technical_deal_note'
 when mapped_deal_id is null then 'deal_not_copied'
 when exists (select from activity a where a.id = m.activity_id and
  (a.kind, a.happened_at, a.summary, a.from_party_id, a.changed_at,
   a.changed_by_user_id, a.changed_by_job, a.changed_for_user_id) is distinct from
  ('note', m.set_at, m.summary, null::uuid, m.set_at,
   m.changed_by_user_id, m.changed_by_job, m.changed_for_user_id))
 or exists (select from activity_about a where a.activity_id = m.activity_id
  and (a.deal_id is distinct from m.mapped_deal_id or a.party_id is not null or a.property_id is not null))
 then 'existing_note_conflict' end as refusal
from old_market_agent_source m;

insert into activity (id, kind, happened_at, summary, changed_at,
 changed_by_user_id, changed_by_job, changed_for_user_id)
select activity_id, 'note', set_at, summary, set_at,
 changed_by_user_id, changed_by_job, changed_for_user_id
from examined_market_agent_source where refusal is null on conflict do nothing;
insert into activity_about (activity_id, deal_id, created_at, changed_at,
 changed_by_user_id, changed_by_job, changed_for_user_id)
select activity_id, mapped_deal_id, set_at, set_at,
 changed_by_user_id, changed_by_job, changed_for_user_id
from examined_market_agent_source where refusal is null on conflict do nothing;

insert into not_copied select deal_id, 'market_agent_source',
 case when refusal not in ('empty_deal_note', 'technical_deal_note') then source end, refusal
from examined_market_agent_source where refusal is not null;
insert into not_copied select deal_id, 'market_agent_source', null, 'technical_deal_note_prefix'
from examined_market_agent_source where refusal is null and source_note <> source;
insert into not_copied select deal_id, 'market_agent_source', null, 'iso_date_rendered'
from examined_market_agent_source where refusal is null and dated_note <> source_note;
insert into not_copied select deal_id, 'changed_for_user_id', null, 'agent_user_unknown'
from old_market_agent_source where changed_by_job = 'agent' and changed_for_user_id is null;
set constraints all immediate;
alter table activity enable trigger stamp_change;
alter table activity_about enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
