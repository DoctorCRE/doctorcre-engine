-- Let a partner drop a reply that failed for good from Home on an existing next schema (#1259).
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table home_mark drop constraint if exists home_mark_drop_kind;
alter table home_mark add constraint home_mark_drop_kind
	check (disposition is distinct from 'dropped' or item_kind in ('call_follow_up', 'home_update', 'reply_draft'));

-- Rule 99 keeps any other failure failed, so the drop stays true of the draft.
create or replace function home_mark_drops_failed_reply() returns trigger
language plpgsql as $$
begin
	if not exists (select from reply_draft where id = new.reply_draft_id and status = 'failed'
		and failure_reason not in ('aborted_before_dispatch', 'submission_recipients_invalid')
		and failure_reason !~ '^unconfirmed_after_[0-9]+$') then
		raise exception 'only a reply that failed for good is dropped from Home'
			using errcode = 'check_violation', constraint = 'home_mark_drops_failed_reply';
	end if;
	return new;
end $$;

create or replace trigger home_mark_drops_failed_reply before insert or update on home_mark
	for each row when (new.disposition = 'dropped' and new.reply_draft_id is not null)
	execute function home_mark_drops_failed_reply();

commit;
