begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

alter table doc_link add column if not exists readiness_by_kind jsonb;
do $$
begin
	if not exists (
		select 1 from pg_constraint
		where conrelid = 'next.doc_link'::regclass
			and conname = 'doc_link_readiness_by_kind'
	) then
		alter table doc_link add constraint doc_link_readiness_by_kind check (
			jsonb_typeof(readiness_by_kind) = 'object'
			and readiness_by_kind ?& array['chat', 'mail']
			and readiness_by_kind - 'chat' - 'mail' = '{}'::jsonb
			and (readiness_by_kind ->> 'chat') in ('ready', 'signed_out', 'plan_limited') is not false
			and (readiness_by_kind ->> 'mail') in ('ready', 'signed_out', 'plan_limited') is not false
		);
	end if;
end $$;
grant update (readiness_by_kind) on doc_link to engine;

commit;
