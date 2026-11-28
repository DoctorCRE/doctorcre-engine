begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table doc_link add column readiness_by_kind jsonb
	constraint doc_link_readiness_by_kind check (
		jsonb_typeof(readiness_by_kind) = 'object'
		and readiness_by_kind ?& array['chat', 'mail']
		and readiness_by_kind - 'chat' - 'mail' = '{}'::jsonb
		and (readiness_by_kind ->> 'chat') in ('ready', 'signed_out', 'plan_limited') is not false
		and (readiness_by_kind ->> 'mail') in ('ready', 'signed_out', 'plan_limited') is not false
	);
grant update (readiness_by_kind) on doc_link to engine;

commit;
