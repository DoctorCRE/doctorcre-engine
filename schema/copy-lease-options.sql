-- Run in a separate owner transaction after copy-leases.sql, with the new schema on search_path.
-- Private reviewed input supplies the complete option set for each old lease version; no prose is parsed.
create temp table if not exists copy_lease_option (
 old_id uuid not null, number integer, kind text, notice_on date, terms text
) on commit drop;
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table lease_option disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

create temp table reviewed_option on commit drop as
select r.*, count(*) over (partition by old_id, number) as reviews
from (select distinct * from pg_temp.copy_lease_option) r;
create temp table examined_option on commit drop as
select r.*, l.created_at, l.updated_at, author.*,
 case when r.reviews > 1 then 'option_reviews_conflict'
 when l.id is null then 'old_lease_not_found'
 when v.id is null then 'lease_version_not_copied'
 when r.number is null or r.number not between 1 and 32767 then 'option_number_invalid'
 when r.kind is null or r.kind not in ('renewal', 'expansion', 'early_termination') then 'option_kind_invalid'
 when r.notice_on is null then 'option_notice_required'
 when r.notice_on > v.expiration_on then 'option_notice_after_expiration'
 when r.terms is null or r.terms !~ '\S' then 'option_terms_required'
 when author.changed_by_user_id is not null and not exists (select from app_user u where u.id = author.changed_by_user_id)
  then 'option_author_not_copied'
 when author.changed_for_user_id is not null and not exists (select from app_user u where u.id = author.changed_for_user_id)
  then 'option_sponsor_not_copied'
 when held.lease_version_id is not null and (held.kind, held.notice_on, held.terms)
  is distinct from (r.kind, r.notice_on, r.terms) then 'option_number_taken' end as reason,
 held.lease_version_id is not null as copied
from reviewed_option r
left join public.lease l on l.id = r.old_id
left join lease_version v on v.id = l.id
left join lease_option held on (held.lease_version_id, held.number) = (r.old_id, r.number)
cross join lateral copy_attribution('lease', l.id, coalesce(l.updated_by, l.created_by)) author;

insert into lease_option (lease_version_id, number, kind, notice_on, terms, created_at,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select old_id, number, kind, notice_on, terms, created_at,
 updated_at, changed_by_user_id, changed_by_job, changed_for_user_id
from examined_option where reason is null and not copied;

insert into not_copied
select distinct old_id, 'lease_option', jsonb_build_object('number', number, 'kind', kind,
 'notice_on', notice_on, 'terms', terms)::text, reason
from examined_option where reason is not null;
insert into not_copied
select l.id, 'options_note', l.options_note, 'option_terms_unparsed'
from public.lease l join lease_version v on v.id = l.id
where l.options_note ~ '\S' and not exists (select from pg_temp.copy_lease_option r where r.old_id = l.id);

set constraints all immediate;
alter table lease_option enable trigger stamp_change;
select * from not_copied order by old_id, field, value, reason;
