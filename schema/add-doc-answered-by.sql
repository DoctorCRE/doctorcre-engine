-- Read-only preflight:
-- SELECT EXISTS (SELECT FROM information_schema.columns
--   WHERE table_schema = 'next' AND table_name = 'doc_turn' AND column_name = 'answered_by')
--   AS doc_turn_answered_by_exists;
-- Apply only if the column is absent. Existing answers were made by the Mac.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table doc_turn add column answered_by text not null default 'mac'
	constraint doc_turn_answered_by check (answered_by in ('mac', 'backup'));
grant update (answered_by) on doc_turn to engine;

commit;
