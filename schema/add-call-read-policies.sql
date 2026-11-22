begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table activity
	add column if not exists call_owner_user_id uuid references app_user,
	add column if not exists call_shared boolean;

create or replace function call_visible_to(source activity, viewer uuid default nullif(current_setting('engine.user_id', true), '')::uuid)
returns boolean language sql stable set search_path = next, pg_temp as $$
	select call_visible_to(source.call_owner_user_id,
		case when source.call_shared then 'old_system' end, null, viewer);
$$;

create or replace function keep_call_audience() returns trigger
language plpgsql set search_path = next, pg_temp as $$
declare viewer uuid := nullif(current_setting('engine.user_id', true), '')::uuid;
begin
	if tg_op = 'INSERT' then
		if new.kind = 'call' then
			new.call_owner_user_id := coalesce(new.changed_by_user_id, new.changed_for_user_id);
			new.call_shared := new.changed_by_job is not distinct from 'old_system' and new.call_owner_user_id is null;
		end if;
	elsif old.call_shared is not null then
		if current_user = 'engine' and new.from_party_id is distinct from old.from_party_id and (
			not call_visible_to(old, viewer) or not exists (select from app_user where id = viewer and is_account_partner)
		) then
			raise exception 'only a partner who can see the call can correct its caller'
				using errcode = 'insufficient_privilege';
		end if;
		new.call_owner_user_id := old.call_owner_user_id;
		new.call_shared := old.call_shared;
	end if;
	return new;
end $$;

-- Native inserts keep the original actor in audit. A later edit can obscure the original stamp of a copied call.
alter table activity disable trigger stamp_change, disable trigger record_change;
with original as (
	select a.id, case when c.id is null or c.changed_by_job = 'old_system'
		then coalesce(a.changed_by_user_id, a.changed_for_user_id)
		else coalesce(c.changed_by_user_id, c.changed_for_user_id) end as owner_id,
		case when c.id is null or c.changed_by_job = 'old_system'
		then a.changed_by_job else c.changed_by_job end as job
	from activity a left join lateral (
		select id, changed_by_user_id, changed_for_user_id, changed_by_job from change
		where table_name = 'activity' and record = jsonb_build_object('id', a.id) and action = 'insert'
		order by id limit 1
	) c on true where a.kind = 'call' and a.call_shared is null
), corrected_copy as (
	select o.id from original o join change c
		on c.table_name = 'activity' and c.record = jsonb_build_object('id', o.id)
	where c.action = 'insert' and c.changed_by_job = 'old_system'
		and exists (select from change edit where edit.table_name = c.table_name and edit.record = c.record
			and edit.action = 'update' and edit.changed_by_job is distinct from 'old_system')
)
update activity a set call_owner_user_id = case when copy.id is null then original.owner_id end,
	call_shared = copy.id is null and original.job is not distinct from 'old_system' and original.owner_id is null
from original left join corrected_copy copy using (id) where original.id = a.id;
alter table activity enable trigger stamp_change, enable trigger record_change;

create or replace trigger zz_keep_call_audience before insert or update on activity
	for each row execute function keep_call_audience();

create or replace function call_source_visible(source uuid, viewer uuid default nullif(current_setting('engine.user_id', true), '')::uuid)
returns boolean language sql stable set search_path = next, pg_temp as $$
	select exists (select from activity a where a.id = source and call_visible_to(a, viewer));
$$;

create or replace function call_step_visible_to(source uuid, owner uuid, viewer uuid default nullif(current_setting('engine.user_id', true), '')::uuid)
returns boolean language sql stable set search_path = next, pg_temp as $$
	select source is null or coalesce(owner = viewer, false) or call_source_visible(source, viewer);
$$;

revoke execute on function call_visible_to(activity, uuid), keep_call_audience(),
	call_source_visible(uuid, uuid), call_step_visible_to(uuid, uuid, uuid) from public;
grant execute on function call_visible_to(activity, uuid), call_source_visible(uuid, uuid),
	call_step_visible_to(uuid, uuid, uuid) to engine, engine_reader;

create or replace function visible_phase_reason(wanted uuid, happened timestamptz) returns text
language sql stable security definer set search_path = next, pg_temp as $$
	select reason from deal_phase_change
	where deal_id = wanted and happened_at = happened
		and (call_activity_id is null or call_source_visible(call_activity_id));
$$;
revoke execute on function visible_phase_reason(uuid, timestamptz) from public;
grant execute on function visible_phase_reason(uuid, timestamptz) to engine, engine_reader;

create table if not exists call_audit_evidence (
	change_id bigint primary key references change,
	field text not null,
	old_value jsonb,
	new_value jsonb
);

create or replace function separate_call_audit_evidence() returns trigger
language plpgsql set search_path = next, pg_temp as $$
declare protected_field text;
begin
	if new.action = 'erase' then
		delete from call_audit_evidence e using change c
		where c.id = e.change_id and c.table_name = new.table_name and c.record = new.record
			and new.new_value -> 'fields' ? e.field;
		return null;
	end if;
	protected_field := case
		when new.table_name = 'next_step' then 'call_evidence_quote'
		when new.table_name = 'deal_phase_change'
			and coalesce(new.old_value ->> 'call_activity_id', new.new_value ->> 'call_activity_id') is not null then 'reason'
	end;
	if coalesce(new.old_value ->> protected_field, new.new_value ->> protected_field) is not null then
		insert into call_audit_evidence values (new.id, protected_field,
			new.old_value -> protected_field, new.new_value -> protected_field);
		-- Keep the keys so erase_change can still erase these fields.
		update change set old_value = jsonb_set(new.old_value, array[protected_field], 'null', false),
			new_value = jsonb_set(new.new_value, array[protected_field], 'null', false) where id = new.id;
	end if;
	return null;
end $$;
create or replace trigger separate_call_audit_evidence after insert or update on change
	for each row execute function separate_call_audit_evidence();
revoke execute on function separate_call_audit_evidence() from public;

alter table activity enable row level security;
drop policy if exists activity_engine on activity;
create policy activity_engine on activity to engine using (true);
drop policy if exists activity_reader on activity;
create policy activity_reader on activity for select to engine_reader using (
	kind <> 'call' or call_visible_to(activity)
);

alter table change enable row level security;
drop policy if exists change_engine on change;
create policy change_engine on change to engine using (true);
drop policy if exists change_reader on change;
create policy change_reader on change for select to engine_reader using (
	case when table_name = 'activity' and (old_value ? 'summary' or new_value ? 'summary') then
		exists (select from activity a where a.id = (change.record ->> 'id')::uuid and (
			a.kind <> 'call'
			-- The change stamp identifies the new text's author, not the previous text's owner.
			or (old_value ->> 'summary' is null and call_visible_to(
				change.changed_by_user_id, change.changed_by_job, change.changed_for_user_id))
		))
	when table_name = 'next_step' and (old_value ?| array['what', 'item_title', 'item_bullets']
		or new_value ?| array['what', 'item_title', 'item_bullets']) then
		coalesce((select call_step_visible_to(s.call_activity_id, s.owner_party_id)
			from next_step s where s.id = (change.record ->> 'id')::uuid),
			case when action in ('insert', 'delete') then call_step_visible_to(
				(coalesce(new_value, old_value) ->> 'call_activity_id')::uuid,
				(coalesce(new_value, old_value) ->> 'owner_party_id')::uuid) else false end)
	else true end
);

alter table imported_change enable row level security;
drop policy if exists imported_change_engine on imported_change;
create policy imported_change_engine on imported_change to engine using (true);
drop policy if exists imported_change_reader on imported_change;
create policy imported_change_reader on imported_change for select to engine_reader using (
	case when table_name = 'activity' then
		exists (select from activity a where a.id = (imported_change.record ->> 'id')::uuid)
	else true end
);

revoke all on call_audit_evidence from public, engine, engine_reader;

revoke select on deal_phase_change from engine_reader;
grant select (deal_id, happened_at, phase, call_activity_id, call_kind, call_move_id,
	changed_at, changed_by_user_id, changed_by_job, changed_for_user_id) on deal_phase_change to engine_reader;


create or replace function activity_entry(a activity) returns jsonb
language sql stable
begin atomic
	select to_jsonb(a) - array['calendar_review_key', 'calendar_review_user_id', 'call_owner_user_id', 'call_shared']
		|| jsonb_build_object('email', (
		select to_jsonb(e) - array['activity_id', 'activity_kind', 'imported', 'conversation_id', 'authored', 'history'] || jsonb_build_object('documents', (
			select coalesce(jsonb_agg(to_jsonb(doc) order by doc.name, doc.id), '[]')
			from email_document ed join document doc on doc.id = ed.document_id
			where ed.email_activity_id = e.activity_id
		)) from email e where e.activity_id = a.id
	));
end;

update change set old_value = old_value
where (table_name = 'next_step' and coalesce(old_value ->> 'call_evidence_quote', new_value ->> 'call_evidence_quote') is not null)
	or (table_name = 'deal_phase_change' and coalesce(old_value ->> 'call_activity_id', new_value ->> 'call_activity_id') is not null
		and coalesce(old_value ->> 'reason', new_value ->> 'reason') is not null);

commit;
