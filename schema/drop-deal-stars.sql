begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

drop table if exists next.deal_star;

commit;
