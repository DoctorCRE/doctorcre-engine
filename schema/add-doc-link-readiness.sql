-- Install after the Doc link migration and before enabling queued Doc turns (#978).
-- Read-only preflight:
-- SELECT EXISTS (SELECT 1 FROM information_schema.columns
--   WHERE table_schema = 'next' AND table_name = 'doc_link' AND column_name = 'readiness')
--   AS doc_link_readiness_exists;
-- If false, apply this file. If true, skip the already-applied migration.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table doc_link add column readiness text
	constraint doc_link_readiness check (readiness in ('ready', 'signed_out', 'plan_limited'));
grant update (readiness) on doc_link to engine;

commit;
