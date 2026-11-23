begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

-- Reads find a party's old ids by party.
create index if not exists outside_id_by_party on outside_id (party_id);

commit;
