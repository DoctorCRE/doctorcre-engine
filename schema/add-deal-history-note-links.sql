-- Run as the owner with the new schema on search_path. This file owns its transactions.
begin;
set local lock_timeout = '250ms';
set local statement_timeout = '1s';

do $$
begin
 if not exists (select from pg_attribute where attrelid = 'imported_deal_history'::regclass
  and attname = 'activity_id' and not attisdropped) then
  alter table imported_deal_history
   add column activity_id uuid,
   add column activity_kind text not null default 'note',
   add constraint imported_deal_history_note_kind check (activity_kind = 'note') not valid,
   add foreign key (activity_id, activity_kind) references activity (id, kind) not valid,
   add foreign key (activity_id, deal_id) references activity_about (activity_id, deal_id) on delete set null (activity_id) not valid,
   add constraint imported_deal_history_note_event
    check (activity_id is null or (verb = 'set-next-step' and field is not distinct from 'next_step')) not valid;
 end if;
end $$;
commit;

begin;
set local lock_timeout = '250ms';
create unique index if not exists imported_deal_history_activity_id_key
 on imported_deal_history (activity_id) where activity_id is not null;
alter table imported_deal_history
 validate constraint imported_deal_history_note_kind,
 validate constraint imported_deal_history_activity_id_activity_kind_fkey,
 validate constraint imported_deal_history_activity_id_deal_id_fkey,
 validate constraint imported_deal_history_note_event;
commit;
