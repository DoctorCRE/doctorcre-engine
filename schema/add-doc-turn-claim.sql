-- Read-only preflight:
-- SELECT EXISTS (SELECT FROM information_schema.columns
--   WHERE table_schema = 'next' AND table_name = 'doc_turn' AND column_name = 'claim_state')
--   AS claim_state_exists;
-- Apply only if claim_state is absent. Existing working claims start with an empty
-- source map and zero reads used. Existing answers, failures and questions are preserved.
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table doc_turn add column claim_state jsonb;
update doc_turn set claim_state = '{"reads":0,"sources":{}}' where state = 'working';
alter table doc_turn drop constraint doc_turn_check,
	add constraint doc_turn_claim_state check (
		(state = 'working' and claim_id is not null and claim_until is not null
			and answer is null and claim_state is not null and jsonb_typeof(claim_state) = 'object')
		or (state in ('queued', 'failed', 'answered') and claim_id is null and claim_until is null
			and claim_state is null and ((state = 'answered') = (answer is not null)))
	);
drop index doc_turn_one_working;
create unique index doc_turn_one_pending on doc_turn (conversation_id) where state in ('queued', 'working');
grant update (claim_state) on doc_turn to engine;

commit;
