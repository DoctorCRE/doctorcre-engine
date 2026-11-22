begin;

insert into next.job (slug, label) values ('sign-in-rehearsal', 'Sign-in rehearsal')
on conflict (slug) do nothing;

-- The rehearsal can clear its own phase and tour rows without granting general delete rights.
create or replace function next.clear_sign_in_fixture(run_id uuid) returns void
language plpgsql security definer set search_path = next, pg_temp as $$
declare
	fixture jsonb;
	prepared_at timestamptz;
	fixture_client uuid;
	fixture_deal uuid;
	fixture_tour uuid;
	fixture_property uuid;
	fixture_notes uuid[];
begin
	if current_setting('engine.job', true) is distinct from 'sign-in-rehearsal' then
		raise insufficient_privilege using message = 'sign-in rehearsal job required';
	end if;

	perform pg_advisory_xact_lock(hashtextextended(run_id::text, 0));
	select answer, created_at into fixture, prepared_at from save_receipt
	where idempotency_key = run_id and verb = 'prepare-sign-in-rehearsal';
	if not found then return; end if;

	fixture_client := (fixture ->> 'client_id')::uuid;
	fixture_deal := (fixture ->> 'deal_id')::uuid;
	fixture_tour := (fixture ->> 'tour_id')::uuid;
	fixture_property := (fixture ->> 'property_id')::uuid;
	select array_agg(id::uuid) into fixture_notes
	from jsonb_array_elements_text(fixture -> 'note_ids') as notes(id);

	if exists (
		select from (
			values ('party', fixture_client), ('deal', fixture_deal),
				('tour_plan', fixture_tour), ('property', fixture_property)
			union all select 'activity', id from unnest(fixture_notes) as notes(id)
		) as wanted(table_name, id)
		where not exists (
			select from change c where c.table_name = wanted.table_name
				and c.record = jsonb_build_object('id', wanted.id)
				and c.action = 'insert' and c.changed_by_job = 'sign-in-rehearsal'
				and c.changed_at = prepared_at
		)
	) or cardinality(fixture_notes) is distinct from 2
		or (fixture ->> 'run_id')::uuid is distinct from run_id then
		raise check_violation using message = 'sign-in rehearsal receipt does not match its rows';
	end if;

	-- The stop trigger restamps its plan if it still exists.
	with removed_plan as (
		delete from tour_plan where id = fixture_tour and deal_id = fixture_deal returning id
	)
	delete from tour_stop using removed_plan
	where tour_plan_id = removed_plan.id and position = 1 and property_id = fixture_property;
	delete from property where id = fixture_property;
	delete from activity_about where activity_id = any(fixture_notes) and deal_id = fixture_deal;
	delete from activity where id = any(fixture_notes) and kind = 'note';
	delete from deal_phase_change where deal_id = fixture_deal
		and happened_at = (fixture ->> 'phase_changed_at')::timestamptz;
	delete from deal_party where deal_id = fixture_deal and party_id = fixture_client and role = 'client';
	delete from deal where id = fixture_deal;
	delete from client where party_id = fixture_client;
	delete from party_role where party_id = fixture_client and role = 'client';
	delete from party where id = fixture_client;
	delete from save_receipt where idempotency_key = run_id and verb = 'prepare-sign-in-rehearsal';
end $$;

revoke execute on function next.clear_sign_in_fixture(uuid) from public;
grant execute on function next.clear_sign_in_fixture(uuid) to engine;

commit;
