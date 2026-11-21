-- Read back: select has_column_privilege('engine', 'next.doc_turn', 'confirmation_key', 'UPDATE');
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;
grant update (confirmation_key) on doc_turn to engine;
commit;
