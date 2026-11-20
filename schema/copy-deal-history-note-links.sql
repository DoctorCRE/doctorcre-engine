-- Run after copy-change-history.sql in its own owner transaction with the new schema on search_path.
with proven as (
 select e.id, e.subject_id, e.actor_id, e.occurred_at, e.recorded_at,
  e.new_value ->> 'next_step' as next_step, n.id as note_id, count(*) over (partition by n.id) as claims
 from public.event e
 join public.tool_call t on t.idempotency_key = e.idempotency_key and t.actor_id = e.actor_id
  and t.verb in ('set-next-step', 'add-deal-note') and t.response ->> 'deal_id' = e.subject_id::text
  -- The event and receipt share a transaction timestamp, even if the retry key is later reused.
  and t.created_at = e.occurred_at
 join public.deal_note n on n.id = case when pg_input_is_valid(t.response ->> 'next_step_id', 'uuid')
  then (t.response ->> 'next_step_id')::uuid end
  and n.deal_id = e.subject_id and n.actor_id = e.actor_id and n.kind = 'next_step'
 where e.subject_type = 'deal' and e.verb = 'set-next-step' and e.field = 'next_step'
  and t.response -> 'ok' = 'true'::jsonb
), linked as (
 update imported_deal_history h set activity_id = e.note_id
 from proven e
 join activity a on a.id = e.note_id and a.kind = 'note'
 join activity_about ab on ab.activity_id = a.id
 where e.claims = 1 and h.id = e.id and h.deal_id = ab.deal_id and h.activity_id is null
  and h.verb = 'set-next-step' and h.field = 'next_step'
  and (h.source_deal_id, h.source_actor_id, h.occurred_at, h.recorded_at)
   = (e.subject_id, e.actor_id, e.occurred_at, e.recorded_at)
  and (h.new_value).next_step = copy_note_text(e.next_step)
  and not exists (select from imported_deal_history prior where prior.activity_id = e.note_id)
 returning 1
)
select count(*) as links_added from linked;
