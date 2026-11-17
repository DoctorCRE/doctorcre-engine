-- Owner transaction after party, client and attribution copies, with the new schema on search_path.
-- Supply reviewed first known dates in pg_temp.copy_account_owner_date before running this file.
create temp table if not exists copy_account_owner_date (
 account_client_id uuid primary key, started_on date not null
) on commit drop;
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table national_account_owner disable trigger stamp_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

create temp table old_account_owner on commit drop as
select o.*, md5('old_system:national_account_owner:' || o.account_client_id)::uuid as id,
 account.party_id as account_id, person.id as owner_id, d.started_on, author.*,
 case when d.started_on is null then 'owner_start_date_required'
 when account.party_id is null then 'account_not_copied'
 when actor.kind <> 'human' then 'owner_not_human'
 when person.id is null then 'owner_person_not_copied' end as refusal
from public.national_account_owner o
left join pg_temp.copy_account_owner_date d using (account_client_id)
left join public.actor actor on actor.id = o.owner_actor_id
left join outside_id account_map on account_map.source = 'old_system' and account_map.value = o.account_client_id::text
left join national_account account on account.party_id = account_map.party_id
left join outside_id owner_map on owner_map.source = 'old_system' and owner_map.value = o.owner_actor_id::text
left join party person on person.id = owner_map.party_id and person.kind = 'person' and actor.kind = 'human'
cross join lateral copy_attribution('national_account_owner', o.account_client_id, o.set_by) author
where not exists (select from national_account_owner done
 where done.id = md5('old_system:national_account_owner:' || o.account_client_id)::uuid);

create temp table examined_account_owner on commit drop as
select o.*, coalesce(refusal, case when
 exists (select from national_account_owner held where held.account_id = o.account_id
  and daterange(held.started_on, held.ended_on) && daterange(o.started_on, null))
 or exists (select from old_account_owner other where other.account_client_id <> o.account_client_id
  and other.account_id = o.account_id and other.refusal is null)
 then 'owner_dates_overlap' end) as reason
from old_account_owner o;

insert into national_account_owner (id, account_id, owner_id, started_on, created_at, changed_at,
 changed_by_user_id, changed_by_job, changed_for_user_id)
select id, account_id, owner_id, started_on, set_at, set_at,
 changed_by_user_id, changed_by_job, changed_for_user_id
from examined_account_owner where reason is null;

insert into not_copied
select account_client_id, case reason when 'owner_start_date_required' then 'started_on'
 when 'account_not_copied' then 'account_client_id' else 'owner_actor_id' end,
 case reason when 'owner_start_date_required' then null when 'account_not_copied' then account_client_id::text
 else owner_actor_id::text end, reason
from examined_account_owner where reason is not null;

set constraints all immediate;
alter table national_account_owner enable trigger stamp_change;
select * from not_copied order by old_id, field, value;
