-- Run after copy-change-history.sql in its own owner transaction with the new schema on search_path.
do $$
begin
 if not exists (select from pg_attribute where attrelid = 'imported_deal_history'::regclass
  and attname = 'activity_id' and not attisdropped) then
  alter table imported_deal_history
   add column activity_id uuid unique,
   add column activity_kind text generated always as ('note') stored,
   add foreign key (activity_id, activity_kind) references activity (id, kind),
   add foreign key (activity_id, deal_id) references activity_about (activity_id, deal_id) on delete set null (activity_id),
   add check (activity_id is null or (verb = 'set-next-step' and field is not distinct from 'next_step'));
 end if;
end $$;

with linked as (
 update imported_deal_history h set activity_id = p.note_id
 from copy_next_step_event() p
 join public.event e on e.id = p.event_id
 join activity a on a.id = p.note_id and a.kind = 'note'
 join activity_about ab on ab.activity_id = a.id
 where h.id = e.id and h.deal_id = ab.deal_id and h.activity_id is null
  and h.verb = 'set-next-step' and h.field = 'next_step'
  and (h.source_deal_id, h.source_actor_id, h.occurred_at, h.recorded_at)
   = (e.subject_id, e.actor_id, e.occurred_at, e.recorded_at)
  and (h.new_value).next_step = copy_note_text(e.new_value ->> 'next_step')
  and not exists (select from imported_deal_history prior where prior.activity_id = p.note_id)
 returning 1
)
select count(*) as links_added from linked;
