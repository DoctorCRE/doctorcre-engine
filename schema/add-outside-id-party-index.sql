begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

-- Leads, quiet follow-ups and action links find a party's copied old-system ids.
create index if not exists outside_id_by_party on outside_id (party_id);

commit;
