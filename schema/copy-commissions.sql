-- Load copy-attribution.sql after next.sql first. Run after copy-deals.sql in its own transaction in the new schema.
-- Only reads public. The partners enter their ladders first; this copy never creates tiers or shares.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table commission disable trigger stamp_change;
alter table commission_payment disable trigger stamp_change;
create temp table not_copied (old_id uuid not null, field text not null, value text, reason text not null) on commit drop;

create temp table old_commission on commit drop as
select c.*, m.deal_id as record_id, d.owner_user_id, a.*
from public.commission c
left join outside_id m on m.source = 'old_system' and m.value = c.deal_id::text
left join deal d on d.id = m.deal_id
cross join lateral copy_attribution('commission', c.id, coalesce(c.updated_by, c.created_by)) a;

create temp table commission_total on commit drop as
select record_id, sum(gross_amount) filter (where status = 'expected') as expected,
 sum(gross_amount) filter (where status <> 'expected') as gross,
 min(created_at) as created_at
from old_commission where record_id is not null group by record_id;

create temp table refusal on commit drop as
select c.id, c.record_id, f.reason from old_commission c
left join commission_total t on t.record_id = c.record_id
cross join lateral (values
 ('deal_not_copied', c.record_id is null),
 ('nonpositive_amount', c.gross_amount <= 0),
 ('amount_out_of_range', t.expected > 999999999999.99 or t.gross > 999999999999.99),
 ('status_disagrees_with_dates', c.status = 'invoiced' and (c.invoiced_on is null or c.received_on is not null)),
 ('received_without_date', c.status = 'received' and c.received_on is null),
 ('dates_out_of_order', c.status <> 'expected' and (c.due_on < c.invoiced_on or c.received_on < c.invoiced_on)),
 ('ladder_not_entered', t.gross is not null and not exists (select from commission_tier where user_id = c.owner_user_id)),
 ('author_not_copied', c.changed_by_user_id is not null and not exists (select from app_user where id = c.changed_by_user_id)
  or c.changed_for_user_id is not null and not exists (select from app_user where id = c.changed_for_user_id)),
 ('payment_id_taken', c.status <> 'expected' and exists (select from commission_payment p where p.id = c.id
  and (p.deal_id, p.amount, p.invoiced_on, p.due_on, p.received_on)
  is distinct from (c.record_id, c.gross_amount, c.invoiced_on, c.due_on, c.received_on)))) f(reason, refused)
where f.refused;

-- Never overwrite a saved commission, including one a user changed after a copy.
insert into refusal
select c.id, c.record_id, 'existing_commission_conflict'
from old_commission c join commission_total t on t.record_id = c.record_id join commission n on n.deal_id = c.record_id
where (n.expected, n.gross) is distinct from (t.expected, t.gross)
 or exists (select from old_commission o where o.record_id = c.record_id and o.status <> 'expected'
  and not exists (select from commission_payment p where (p.id, p.deal_id, p.amount, p.invoiced_on, p.due_on, p.received_on)
   is not distinct from (o.id, o.record_id, o.gross_amount, o.invoiced_on, o.due_on, o.received_on)))
 or exists (select from commission_payment p where p.deal_id = c.record_id
  and not exists (select from old_commission o where o.record_id = c.record_id and o.status <> 'expected' and o.id = p.id));

-- A deal waits whole, so refusing a payment never silently lowers its gross.
create temp table copied on commit drop as
select t.* from commission_total t where not exists (select from refusal r where r.record_id = t.record_id)
 and not exists (select from commission n where n.deal_id = t.record_id);
insert into commission (deal_id, expected, gross, created_at, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select t.record_id, t.expected, t.gross, t.created_at, a.updated_at, a.changed_by_user_id, a.changed_by_job, a.changed_for_user_id
from copied t cross join lateral (select * from old_commission c where c.record_id = t.record_id
 order by updated_at desc, id desc limit 1) a;
insert into commission_payment (id, deal_id, amount, invoiced_on, due_on, received_on, created_at,
 changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
select c.id, c.record_id, c.gross_amount, c.invoiced_on, c.due_on, c.received_on, c.created_at,
 c.updated_at, c.changed_by_user_id, c.changed_by_job, c.changed_for_user_id
from old_commission c join copied t on t.record_id = c.record_id where c.status <> 'expected';

insert into not_copied
select c.id, case r.reason when 'deal_not_copied' then 'deal_id' when 'nonpositive_amount' then 'gross_amount'
 when 'received_without_date' then 'received_on' when 'dates_out_of_order' then 'dates'
 when 'status_disagrees_with_dates' then 'status' else 'commission' end,
 jsonb_build_object('deal_id', c.deal_id, 'status', c.status, 'gross_amount', c.gross_amount,
  'expected_total', t.expected, 'gross_total', t.gross, 'owner_user_id', c.owner_user_id,
  'author_id', coalesce(c.updated_by, c.created_by), 'sponsor_id', c.changed_for_user_id,
  'invoiced_on', c.invoiced_on, 'due_on', c.due_on, 'received_on', c.received_on)::text, r.reason
from refusal r join old_commission c on c.id = r.id left join commission_total t on t.record_id = c.record_id;
insert into not_copied
select c.id, 'deal_id', c.deal_id::text, 'another_row_on_deal_waits' from old_commission c
where exists (select from refusal r where r.record_id = c.record_id) and not exists (select from refusal r where r.id = c.id);
insert into not_copied
select id, f.field, f.value::text, 'expected_date_has_no_destination' from old_commission
cross join lateral (values ('invoiced_on', invoiced_on), ('due_on', due_on), ('received_on', received_on)) f(field, value)
where status = 'expected' and f.value is not null;
set constraints all immediate;
alter table commission enable trigger stamp_change;
alter table commission_payment enable trigger stamp_change;
select * from not_copied order by old_id, field, reason;
