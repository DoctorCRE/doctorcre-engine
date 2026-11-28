-- Apply after add-introduction-job.sql.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table introduction
	add column maker_client_role text,
	drop constraint introduction_made_by_check,
	add constraint introduction_made_by_check check (made_by in ('vendor', 'team', 'client')),
	add constraint introduction_client_maker_names_deal check (
		(made_by = 'client') = (maker_client_role is not null)
		and (maker_client_role is null or (maker_client_role = 'client' and deal_id is not null))
	),
	add constraint introduction_maker_is_deal_client
		foreign key (deal_id, introduced_party_id, maker_client_role) references deal_party on update cascade;

create policy remove_recorded_introduction on introduction as restrictive for delete to engine
	using (confirmed and source_job_id is null);

commit;
