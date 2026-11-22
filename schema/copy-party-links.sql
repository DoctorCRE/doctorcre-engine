-- The backfill and the self-contained vendor copy use this same block.
-- This legacy contact stands for its partner only when interpreting introductions (#1161).
create temp table link_party on commit drop as
select o.value, o.party_id, coalesce(u.id, o.party_id) as introduction_party_id
from outside_id o
left join app_user u on o.value = '7cb42c06-ba3c-447b-937d-a591860fa04f' and u.id = 'b6c38b27-d006-4fad-9c38-49edf3130a07'
where o.source = 'old_system' and o.party_id is not null;

-- Each introduction today, with the vendor, maker and party it introduced it can be told to have.
-- A referral on a deal brought that deal's client, as today's referral binding checks, and stands for its link.
create temp table typed_introduction on commit drop as
select l.*, made.vendor_id, made.user_id, introduced.party_id as introduced_party_id, introduced.count, case
	when made.ends_copied < made.ends or not made.via_copied then 'a party it links is not copied'
	when made.via_copied is null and made.vendor_ends = 0 then 'no copied vendor on either side'
	when made.via_copied is null then 'who made it is not recorded'
	when made.vendor_id is null and made.user_id is null then 'made by neither a copied vendor nor a user'
	when made.vendor_id is null then 'no single copied vendor on either side'
	when introduced.count <> 1 then 'whom it introduced cannot be told'
	when l.old_deal_id is not null and l.deal_id is null then 'its deal is not copied'
end as reason
from (
	select l.id, l.id as old_id, 'party_link' as field, l.kind as value, l.from_party, l.to_party, l.via_party, l.occurred_on, l.note,
		l.created_at, l.created_by, l.from_party as event_party, null::uuid as old_deal_id, null::uuid as deal_id
	from public.party_link l
	where l.kind in ('introduced', 'referred', 'intro', 'intro_received', 'referral')
		and not exists (select from public.party_link_deal d where d.link_id = l.id)
	union all
	select md5(d.link_id::text || d.deal_id::text)::uuid, d.link_id, 'party_link_deal', d.deal_id::text, null, l.to_party, d.referred_by,
		d.occurred_on, d.note, d.created_at, d.created_by, d.referred_by, d.deal_id, deal.deal_id
	from public.party_link_deal d
	join public.party_link l on l.id = d.link_id
	left join outside_id deal on deal.source = 'old_system' and deal.value = d.deal_id::text
) as l
left join link_party v on v.value = l.via_party::text
cross join lateral (values (case when l.old_deal_id is null then v.introduction_party_id else v.party_id end)) via(party_id)
cross join lateral (
	select count(e.party_id) as ends_copied, count(*) as ends, count(*) filter (where e.vendor) as vendor_ends,
		case when l.via_party is not null then via.party_id is not null end as via_copied,
		case when exists (select from party_role where party_id = via.party_id and role = 'vendor') then via.party_id
			when exists (select from app_user where id = via.party_id) and count(e.party_id) filter (where e.vendor) = 1
				then (array_agg(e.party_id) filter (where e.vendor))[1] end as vendor_id,
		case when exists (select from app_user where id = via.party_id)
			and not exists (select from party_role where party_id = via.party_id and role = 'vendor') then via.party_id end as user_id
	from unnest(array[l.from_party, l.to_party]) as old (id)
	left join link_party map on map.value = old.id::text
	left join lateral (select p.party_id,
		exists (select from party_role where party_id = p.party_id and role = 'vendor') as vendor
		from (values (case when l.old_deal_id is null then map.introduction_party_id else map.party_id end)) p(party_id)) as e on true
	where old.id is not null
) as made
cross join lateral (
	select count(*), min(p.party_id::text)::uuid as party_id
	from unnest(array[l.from_party, l.to_party]) as old (id)
	join link_party map on map.value = old.id::text
	cross join lateral (values (case when l.old_deal_id is null then map.introduction_party_id else map.party_id end)) p(party_id)
	where p.party_id <> made.vendor_id and p.party_id is distinct from made.user_id
		and p.party_id not in (select id from app_user)
) as introduced
where not exists (select from introduction i where i.id = l.id);

-- Today's link writer records a link as an event of the party it is from, and a referral on a deal of its referrer.
-- Referrals by vendors merged into one record, on one deal, are one introduction, the first stored.
insert into introduction (id, created_at, vendor_id, made_by, introduced_by_user_id, introduced_party_id, introduced_on,
	deal_id, note, changed_by_user_id, changed_by_job, changed_for_user_id, changed_at)
select distinct on (i.vendor_id, i.deal_id, case when i.deal_id is null then i.id end) i.id, i.created_at, i.vendor_id, case when i.user_id is null then 'vendor' else 'team' end, i.user_id,
	i.introduced_party_id, i.occurred_on, i.deal_id, nullif(regexp_replace(i.note, '^\s+|\s+$', '', 'g'), ''), a.changed_by_user_id, a.changed_by_job,
	a.changed_for_user_id, i.created_at
from typed_introduction i cross join lateral copy_attribution('party', i.event_party, i.created_by) a
where i.reason is null and (i.deal_id is null
	or not exists (select from introduction x where (x.vendor_id, x.deal_id, x.made_by) = (i.vendor_id, i.deal_id, 'vendor')))
order by i.vendor_id, i.deal_id, case when i.deal_id is null then i.id end, i.created_at, i.old_id;

insert into not_copied select old_id, field, value, reason from typed_introduction where reason is not null;

-- Each other link today, at the records its parties became. A can-introduce link through a broker says the broker can
-- introduce the team, so it is the broker's to the end that is not a user.
create temp table typed_link on commit drop as
select l.id, l.kind, l.from_party, l.via_party, l.occurred_on, l.created_at, l.created_by,
	case when l.kind = 'works_with' then 'knows' else l.kind end as copied_kind,
	case when l.kind = 'works_with' then coalesce('Works with: ' || text.note, 'Works with') else text.note end as note, ends.party_id, ends.other_party_id, case
	when l.kind = 'intro_requested' then 'outside the owner''s ruling'
	when l.kind not in ('knows', 'can_introduce', 'works_with') then 'not a kind of link'
	when f.party_id is null or t.party_id is null or brokered and v.party_id is null then 'a party it links is not copied'
	when brokered and users.from_user = users.to_user then
		case when users.from_user then 'both ends are users' else 'neither end is a user' end
	when ends.party_id = ends.other_party_id then 'it links a record to itself'
end as reason
from public.party_link l
left join link_party f on f.value = l.from_party::text
left join link_party t on t.value = l.to_party::text
left join link_party v on v.value = l.via_party::text
cross join lateral (values (copy_note_text(nullif(regexp_replace(l.note, '^\s+|\s+$', '', 'g'), '')))) text(note)
cross join lateral (select l.kind = 'can_introduce' and l.via_party is not null as brokered) b
cross join lateral (select exists (select from app_user where id = f.introduction_party_id) as from_user,
	exists (select from app_user where id = t.introduction_party_id) as to_user) users
cross join lateral (select case when brokered then v.introduction_party_id else f.party_id end as party_id,
	case when brokered and users.from_user then t.party_id when brokered then f.party_id else t.party_id end as other_party_id) ends
where l.kind not in ('introduced', 'referred', 'intro', 'intro_received', 'referral')
	and not exists (select from party_link n where n.id = l.id);

-- Of links that are one, such as a knows link stored each way round, the first stored is kept.
insert into party_link (id, created_at, kind, party_id, other_party_id, started_on, note, changed_by_user_id, changed_by_job,
	changed_for_user_id, changed_at)
select l.id, l.created_at, l.copied_kind, l.party_id, l.other_party_id, l.occurred_on, l.note, a.changed_by_user_id, a.changed_by_job,
	a.changed_for_user_id, l.created_at
from typed_link l cross join lateral copy_attribution('party', l.from_party, l.created_by) a
where l.reason is null
order by l.created_at, l.id
on conflict do nothing;

insert into not_copied
select id, 'party_link', kind, coalesce(reason, 'the same link is kept already')
from typed_link l where reason is not null or not exists (select from party_link n where n.id = l.id);

insert into not_copied
select id, 'via_party', via_party::text, 'a knows link has no broker' from public.party_link where kind = 'knows' and via_party is not null;
