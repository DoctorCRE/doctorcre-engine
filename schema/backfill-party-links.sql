-- Run as the schema owner with psql after owner approval (#1161).
\set ON_ERROR_STOP on
begin;
set local search_path = next;
lock table public.party_link, public.party_link_deal in share mode;

do $$
declare
	actual jsonb;
	expected constant jsonb := '{"introduced":9,"intro":7,"referral":4,"can_introduce":6,"knows":24,"works_with":4}';
begin
	select jsonb_object_agg(kind, total) into actual
	from (select kind, count(*) as total from public.party_link group by kind) counts;
	if actual is distinct from expected then
		raise exception 'Expected legacy party link counts %, found %', expected, actual;
	end if;
	if exists (select from public.party_link_deal) then
		raise exception 'Expected no legacy party link deal bindings';
	end if;
end $$;

select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table introduction disable trigger stamp_change;
alter table party_link disable trigger stamp_change;
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;

\ir copy-party-links.sql

set constraints all immediate;
alter table introduction enable trigger stamp_change;
alter table party_link enable trigger stamp_change;

select l.kind, count(*) as source_rows, count(i.id) as introductions, count(n.id) as relationship_links
from public.party_link l left join introduction i on i.id = l.id left join party_link n on n.id = l.id
group by l.kind order by l.kind;
select old_id, field, reason from not_copied order by old_id, field, reason;
commit;
