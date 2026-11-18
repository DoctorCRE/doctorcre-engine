select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table deal_client_website disable trigger stamp_change;

create temp table old_client_website on commit drop as
select p.deal_id as old_id, d.deal_id, c.party_id as client_party_id, p.slug, p.password_hash,
 p.disabled_at, p.created_at, p.updated_at,
 case
  when d.deal_id is null then 'deal_not_copied'
  when p.client_id is distinct from legacy.client_id or dp.deal_id is null then 'client_link_not_copied'
  when p.updated_at is null then 'registration_update_time_missing'
  when exists (
   select from deal_client_website w where
    (w.slug = p.slug and (w.deal_id, w.client_party_id) is distinct from (d.deal_id, c.party_id))
    or (w.deal_id = d.deal_id and w.slug <> p.slug and w.disabled_at is null and p.disabled_at is null)
  ) then 'registration_conflict'
 end as reason
from ops.client_portal p
join public.deal legacy on legacy.id = p.deal_id
left join outside_id d on d.source = 'old_system' and d.value = p.deal_id::text
left join outside_id c on c.source = 'old_system' and c.value = p.client_id::text
left join deal_party dp on dp.deal_id = d.deal_id and dp.party_id = c.party_id and dp.role = 'client';

insert into deal_client_website
 (slug, deal_id, client_party_id, password_hash, disabled_at, created_at, changed_at, changed_by_job)
select slug, deal_id, client_party_id, password_hash, disabled_at, created_at, updated_at, 'old_system'
from old_client_website where reason is null
on conflict (slug) do nothing;

alter table deal_client_website enable trigger stamp_change;
select old_id, 'client_website' as field, null::text as value, reason
from old_client_website where reason is not null order by old_id, reason;
