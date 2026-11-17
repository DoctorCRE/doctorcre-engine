-- Run after copy-deals.sql, copy-commissions.sql and copy-attribution.sql in an owner transaction in the new schema.
-- History is loaded with decision 73's trigger controls, without replaying a close or an undo.
select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
alter table invoice_email disable trigger invoice_email_transition;
alter table invoice_email disable trigger stamp_change;
alter table invoice_email disable trigger record_change;
alter table change disable trigger stamp_change;
alter table commission_payment disable trigger stamp_change;
alter table commission_payment disable trigger record_change;
create temp table not_copied (old_id uuid, field text, value text, reason text) on commit drop;

do $$
declare
 i public.deal_invoice_email;
 capture public.event;
 phase_event public.event;
 invoice_event public.event;
 actor record;
 mapped_deal uuid;
 payment uuid;
 prior_at timestamptz;
 payment_change bigint;
 candidates integer;
 payload jsonb;
 saved invoice_email;
 failure text;
 phase_slug text;
 current_date_value date;
begin
 for i in select * from public.deal_invoice_email order by occurred_at, id loop
  begin
   select * into saved from jsonb_populate_record(null::invoice_email, (select new_value from change
    where table_name = 'invoice_email' and record = jsonb_build_object('id', i.id) and action = 'insert'));
   if exists (select from invoice_email where id = i.id) then
    if (saved.id,saved.evidence_ref,saved.sender::text,saved.deal_name,saved.client_name,saved.property_address,saved.occurred_at,saved.email_date)
     is distinct from (i.id,i.evidence_ref,i.from_address,i.deal_name,i.client_name,i.property_address,i.occurred_at,i.email_date)
     or not exists (select from invoice_email where id = i.id and status = i.status)
     or i.status <> 'captured' and not exists (select from change where table_name = 'invoice_email'
      and record = jsonb_build_object('id', i.id) and changed_at = i.applied_at
      and new_value ->> 'status' = 'applied' and new_value ->> 'reason' = i.reason) then
     insert into not_copied values (i.id, 'id', i.id::text, 'existing_evidence_conflicts');
    end if;
    continue;
   end if;
   if exists (select from invoice_email where evidence_ref = i.evidence_ref) then
    raise check_violation using constraint = 'evidence_ref_taken';
   end if;
   if not pg_input_is_valid(i.from_address, 'email_address') then
    raise check_violation using constraint = 'invalid_sender';
   end if;
   select * into capture from public.event where subject_type = 'deal_invoice_email' and subject_id = i.id
    and verb = 'record-deal-invoice' and actor_id = i.created_by
    and new_value ->> 'evidence_ref' = i.evidence_ref and new_value ->> 'email_date' = i.email_date::text
    order by mutation_order limit 1;
   if capture.id is null then raise check_violation using constraint = 'capture_evidence_missing'; end if;
   if capture.occurred_at < i.occurred_at or i.applied_at < capture.occurred_at or i.undone_at < i.applied_at then
    raise check_violation using constraint = 'history_dates_disagree';
   end if;
   if i.status <> 'captured' then
    if exists (select from public.deal_invoice_email other where other.deal_id = i.deal_id
     and other.email_date = i.email_date and other.status <> 'captured' and (other.applied_at,other.id) < (i.applied_at,i.id)) then
     raise check_violation using constraint = 'duplicate_application';
    end if;
   end if;
   mapped_deal := null; payment := null; prior_at := null; payment_change := null;
   if i.deal_id is not null then
    select m.deal_id into mapped_deal from outside_id m join deal d on d.id = m.deal_id
     where m.source = 'old_system' and m.value = i.deal_id::text;
    if mapped_deal is null then raise check_violation using constraint = 'deal_not_copied'; end if;
    select invoiced_on into current_date_value from public.deal where id = i.deal_id;
    select count(*), (array_agg(p.id))[1] into candidates, payment
     from commission_payment p join public.commission c on c.id = p.id and c.deal_id = i.deal_id and c.status <> 'expected'
     where p.deal_id = mapped_deal and (p.invoiced_on is null or p.invoiced_on is not distinct from current_date_value)
      and c.invoiced_on is not distinct from p.invoiced_on;
    if candidates <> 1 then raise check_violation using constraint = 'payment_not_identified'; end if;
   end if;
   if i.status <> 'captured' then
    if current_date_value is distinct from (case when i.status = 'undone' then i.prior_invoiced_on else i.email_date end) then
     raise check_violation using constraint = 'invoice_dates_disagree';
    end if;
    select * into phase_event from public.event where id = i.phase_event_id and subject_type = 'deal'
     and subject_id = i.deal_id and field = 'phase' and new_value ->> 'phase' = 'closed';
    select * into invoice_event from public.event where id = i.invoice_event_id and subject_type = 'deal'
     and subject_id = i.deal_id and field = 'invoiced_on' and actor_id = i.applied_by
     and new_value ->> 'invoiced_on' = i.email_date::text
     and (old_value ->> 'invoiced_on') is not distinct from i.prior_invoiced_on::text;
    select happened_at, phase into prior_at, phase_slug from deal_phase_change
     where deal_id = mapped_deal and happened_at < phase_event.occurred_at order by happened_at desc limit 1;
    if invoice_event.id is null or phase_event.id is null or prior_at is null or phase_slug <> i.prior_phase
     or not exists (select from deal_phase_change where deal_id = mapped_deal and happened_at = phase_event.occurred_at and phase = 'closed') then
     raise check_violation using constraint = 'application_evidence_missing';
    end if;
   end if;
   -- Every historical actor must resolve before any history is written.
   for actor in
    select v.*, a.* from (values ('capture', i.created_by, capture.id, capture.occurred_at),
     ('application', i.applied_by, i.invoice_event_id, i.applied_at), ('undo', i.undone_by, null::uuid, i.undone_at)) v(kind, actor_id, event_id, happened_at)
    cross join lateral copy_event_attribution(v.actor_id, v.event_id) a where v.actor_id is not null
   loop
    if not exists (select from public.actor where id = actor.actor_id)
     or actor.changed_by_user_id is not null and not exists (select from app_user where id = actor.changed_by_user_id)
     or actor.changed_for_user_id is not null and not exists (select from app_user where id = actor.changed_for_user_id)
     or actor.kind = 'undo' and actor.changed_by_user_id is null then
     raise check_violation using constraint = 'actor_not_copied';
    end if;
   end loop;
   if i.status = 'applied' then
    update commission_payment p set invoiced_on = i.email_date, changed_at = invoice_event.occurred_at,
     changed_by_user_id = a.changed_by_user_id, changed_by_job = a.changed_by_job, changed_for_user_id = a.changed_for_user_id
    from copy_event_attribution(i.applied_by, i.invoice_event_id) a where p.id = payment and p.invoiced_on is null;
   end if;
   if i.status <> 'captured' then
    insert into change (table_name, record, action, old_value, new_value, changed_at,
     changed_by_user_id, changed_by_job, changed_for_user_id)
    select 'commission_payment', jsonb_build_object('id', payment), 'update',
     jsonb_build_object('invoiced_on', i.prior_invoiced_on), jsonb_build_object('invoiced_on', i.email_date),
     invoice_event.occurred_at, a.* from copy_event_attribution(invoice_event.actor_id, invoice_event.id) a
    returning id into payment_change;
   end if;
   insert into invoice_email (id, created_at, evidence_ref, sender, deal_name, client_name, property_address,
    occurred_at, email_date, status, deal_id, payment_id, prior_phase_at, applied_phase_at, prior_invoiced_on,
    payment_change_id, changed_at, changed_by_user_id, changed_by_job, changed_for_user_id)
   select i.id, capture.occurred_at, i.evidence_ref, i.from_address::email_address, i.deal_name, i.client_name, i.property_address,
    i.occurred_at, i.email_date, i.status, mapped_deal, payment, prior_at,
    case when i.status <> 'captured' then phase_event.occurred_at end, i.prior_invoiced_on, payment_change,
    coalesce(i.undone_at, i.applied_at, capture.occurred_at), a.*
   from copy_event_attribution(coalesce(i.undone_by, i.applied_by, i.created_by),
    case when i.status = 'captured' then capture.id when i.status = 'applied' then i.invoice_event_id end) a
   returning to_jsonb(invoice_email) - array['changed_at','changed_by_user_id','changed_by_job','changed_for_user_id'] into payload;
   insert into change (table_name, record, action, new_value, changed_at,
    changed_by_user_id, changed_by_job, changed_for_user_id)
   select 'invoice_email', jsonb_build_object('id', i.id), 'insert',
    (payload - array['prior_phase_at','applied_phase_at','prior_invoiced_on','payment_change_id'])
     || jsonb_build_object('status', 'captured', 'application_root_id', null,
      'deal_id', case when i.status = 'captured' then mapped_deal end, 'payment_id', case when i.status = 'captured' then payment end), capture.occurred_at, a.*
   from copy_event_attribution(i.created_by, capture.id) a;
   if i.status <> 'captured' then
    insert into change (table_name, record, action, old_value, new_value, changed_at,
     changed_by_user_id, changed_by_job, changed_for_user_id)
    select 'invoice_email', jsonb_build_object('id', i.id), 'update', jsonb_build_object('status', 'captured'),
     jsonb_build_object('status', 'applied', 'deal_id', mapped_deal, 'payment_id', payment, 'reason', i.reason, 'prior_phase_at', prior_at,
      'applied_phase_at', phase_event.occurred_at, 'prior_invoiced_on', i.prior_invoiced_on, 'payment_change_id', payment_change), i.applied_at, a.*
    from copy_event_attribution(i.applied_by, i.invoice_event_id) a;
   end if;
   if i.status = 'undone' then
    insert into change (table_name, record, action, old_value, new_value, changed_at,
     changed_by_user_id, changed_by_job, changed_for_user_id)
    select 'commission_payment', jsonb_build_object('id', payment), 'update', jsonb_build_object('invoiced_on', i.email_date),
     jsonb_build_object('invoiced_on', i.prior_invoiced_on), i.undone_at, a.* from copy_event_attribution(i.undone_by, null) a;
    insert into change (table_name, record, action, old_value, new_value, changed_at,
     changed_by_user_id, changed_by_job, changed_for_user_id)
    select 'invoice_email', jsonb_build_object('id', i.id), 'update', jsonb_build_object('status', 'applied'),
     jsonb_build_object('status', 'undone'), i.undone_at, a.* from copy_event_attribution(i.undone_by, null) a;
   end if;
  exception when check_violation or foreign_key_violation or unique_violation or not_null_violation then
   get stacked diagnostics failure = constraint_name;
   insert into not_copied values (i.id, 'invoice_email', i.id::text, failure);
  end;
 end loop;
end $$;
insert into not_copied
select d.id, 'invoiced_on', d.invoiced_on::text, 'invoice_date_not_reconciled' from public.deal d
where d.invoiced_on is not null and not exists (select from outside_id m join deal_invoiced p on p.deal_id = m.deal_id
 where m.source = 'old_system' and m.value = d.id::text and p.invoiced_on = d.invoiced_on);
set constraints all immediate;
alter table invoice_email enable trigger invoice_email_transition;
alter table invoice_email enable trigger stamp_change;
alter table invoice_email enable trigger record_change;
alter table change enable trigger stamp_change;
alter table commission_payment enable trigger stamp_change;
alter table commission_payment enable trigger record_change;
select * from not_copied order by old_id, field, reason;
