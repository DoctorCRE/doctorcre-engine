begin;

insert into next.job (slug, label) values ('sign-in-rehearsal', 'Sign-in rehearsal')
on conflict (slug) do nothing;

drop function if exists next.clear_sign_in_fixture(uuid);

create or replace function next.guard_sign_in_fixture_receipt() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
	if new.verb = 'sign-in-rehearsal' and current_user <> tg_argv[0] then
		raise insufficient_privilege using message = 'sign-in rehearsal receipts are written by the fixture function';
	end if;
	return new;
end $$;

do $$ begin
	execute format('create or replace trigger guard_sign_in_fixture_receipt before insert on next.save_receipt
		for each row execute function next.guard_sign_in_fixture_receipt(%L)', current_user);
end $$;

-- Receipts written inside savepoints still reserve the top-level transaction.
create unique index if not exists sign_in_fixture_prepared_xact
	on next.save_receipt ((answer ->> 'prepared_xact'))
	where verb = 'sign-in-rehearsal' and answer ? 'prepared_xact';

create or replace function next.sign_in_fixture(run_id uuid, operation text, fixture jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, next, pg_temp as $$
declare
	receipt save_receipt;
	actor text := nullif(current_setting('engine.user_id', true), '');
	client_id uuid;
	fixture_deal uuid;
	tour_id uuid;
	property_id uuid;
	step_id uuid;
	phase_at timestamptz;
	note_ids uuid[];
	inserts bigint[];
begin
	if current_setting('engine.job', true) is distinct from 'sign-in-rehearsal' then
		raise insufficient_privilege using message = 'sign-in rehearsal job required';
	end if;
	perform pg_advisory_xact_lock(hashtextextended(run_id::text, 0));
	select * into receipt from save_receipt where idempotency_key = run_id;
	if receipt.verb <> 'sign-in-rehearsal' then return '{"conflict":true}'; end if;

	if operation = 'prepare' then
		if receipt.idempotency_key is null then return null; end if;
		if receipt.answer ->> 'state' = 'cleaned' or receipt.request_hash is distinct from actor then
			return '{"conflict":true}';
		end if;
		return (receipt.answer -> 'fixture') || '{"replayed":true}';
	end if;

	if operation = 'cleanup' then
		if receipt.idempotency_key is null then
			insert into save_receipt (idempotency_key, verb, request_hash, answer)
			values (run_id, 'sign-in-rehearsal', '', '{"state":"cleaned"}') on conflict do nothing;
			if not found then return '{"conflict":true}'; end if;
			return null;
		end if;
		if receipt.answer ->> 'state' = 'cleaned' then return null; end if;
		fixture := receipt.answer -> 'fixture';
	elsif operation is distinct from 'record' or actor is null or receipt.idempotency_key is not null then
		return '{"conflict":true}';
	end if;

	client_id := (fixture ->> 'client_id')::uuid;
	fixture_deal := (fixture ->> 'deal_id')::uuid;
	tour_id := (fixture ->> 'tour_id')::uuid;
	property_id := (fixture ->> 'property_id')::uuid;
	step_id := (fixture ->> 'next_step_id')::uuid;
	phase_at := (fixture ->> 'phase_changed_at')::timestamptz;
	note_ids := array(select id::uuid from jsonb_array_elements_text(fixture -> 'note_ids') as notes(id));

	if operation = 'record' then
		-- The audit rows must come from the same transaction as this receipt.
		with wanted(table_name, record) as (
			values ('party', jsonb_build_object('id', client_id)),
				('party_role', jsonb_build_object('party_id', client_id, 'role', 'client')),
				('client', jsonb_build_object('party_id', client_id)),
				('deal', jsonb_build_object('id', fixture_deal)),
				('deal_party', jsonb_build_object('deal_id', fixture_deal, 'party_id', client_id, 'role', 'client')),
				('deal_phase_change', jsonb_build_object('deal_id', fixture_deal, 'happened_at', phase_at)),
				('next_step', jsonb_build_object('id', step_id)),
				('property', jsonb_build_object('id', property_id)),
				('tour_plan', jsonb_build_object('id', tour_id)),
				('tour_stop', jsonb_build_object('tour_plan_id', tour_id, 'position', 1))
			union all select 'activity', jsonb_build_object('id', id) from unnest(note_ids) as notes(id)
			union all select 'activity_about', to_jsonb(a) - array[
				'changed_at', 'changed_by_user_id', 'changed_by_job', 'changed_for_user_id']
				from activity_about a where a.activity_id = any(note_ids) and a.deal_id = fixture_deal
		)
		select array_agg(c.id) into inserts from wanted w join change c using (table_name, record)
		where c.action = 'insert' and c.changed_by_job = 'sign-in-rehearsal'
			and c.xmin = pg_current_xact_id()::xid;
		if cardinality(inserts) is distinct from 14 or cardinality(note_ids) <> 2
			or (fixture ->> 'run_id')::uuid is distinct from run_id then
			raise check_violation using message = 'sign-in rehearsal receipt does not match its inserts';
		end if;
		insert into save_receipt (idempotency_key, verb, request_hash, answer)
		values (run_id, 'sign-in-rehearsal', actor,
			jsonb_build_object('state', 'prepared', 'prepared_xact', pg_current_xact_id()::text,
				'fixture', fixture, 'inserts', inserts))
		on conflict do nothing;
		if not found then return '{"conflict":true}'; end if;
		return null;
	end if;

	-- Lock the parents so a deleted row or link cannot be replaced during cleanup.
	perform 1 from party where id = client_id for update;
	perform 1 from deal where id = fixture_deal for update;
	perform 1 from activity where id = any(note_ids) for update;
	perform 1 from property where id = property_id for update;
	perform 1 from tour_plan where id = tour_id for update;
	perform 1 from next_step where id = step_id for update;

	if exists (
		select from jsonb_array_elements_text(receipt.answer -> 'inserts') as saved(id)
		join change original on original.id = saved.id::bigint
		join change later using (table_name, record)
		where later.id > original.id and later.action in ('delete', 'insert')
	) then
		raise check_violation using message = 'a sign-in rehearsal row has been replaced or removed';
	end if;

	-- The stop trigger restamps its plan if it still exists.
	with removed_plan as (
		delete from tour_plan where id = tour_id returning id
	)
	delete from tour_stop using removed_plan
	where tour_plan_id = removed_plan.id and position = 1;
	delete from property where id = property_id;
	delete from activity_about a where a.activity_id = any(note_ids) and a.deal_id = fixture_deal;
	delete from activity where id = any(note_ids);
	delete from next_step where id = step_id;
	delete from deal_phase_change p where p.deal_id = fixture_deal and p.happened_at = phase_at;
	delete from deal_party p where p.deal_id = fixture_deal and p.party_id = client_id and p.role = 'client';
	delete from deal where id = fixture_deal;
	delete from client where party_id = client_id;
	delete from party_role where party_id = client_id and role = 'client';
	delete from party where id = client_id;
	update save_receipt set answer = (answer - 'fixture' - 'inserts') || '{"state":"cleaned"}'
	where idempotency_key = run_id;
	return null;
end $$;

revoke execute on function next.guard_sign_in_fixture_receipt(), next.sign_in_fixture(uuid, text, jsonb) from public;
grant execute on function next.sign_in_fixture(uuid, text, jsonb) to engine;

commit;
