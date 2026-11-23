-- Lists the stored emails that Outlook recovery should re-read for their split or Message-ID (#1223).
-- Run as the schema owner: psql -X -v out=FILE -f schema/email-text-recovery-candidates.sql
-- FILE gets one CSV row per email and mailbox, with subjects and addresses, so name it in a private directory.
-- Stdout shows only a count per reason. Nothing is written to the database.
\set ON_ERROR_STOP on
\set QUIET on
\if :{?out}
\else
do $$ begin raise exception 'Name the private CSV file with -v out=FILE'; end $$;
\endif
begin transaction read only;
set local search_path = next;
-- happened_at is listed as text, so its zone is fixed.
set local time zone 'UTC';

-- Today's rows live in public.activity until the old system is gone.
select to_regclass('public.activity') is not null as has_old_activity \gset
\if :has_old_activity
\set old_activity 'public.activity'
\else
\set old_activity '(select null::uuid as id, null::jsonb as email_identity where false)'
\endif

-- The rows are read once, so the file and the counts agree.
with candidate as (
	select e.activity_id, m.user_id, u.slug, e.sender, a.happened_at::text as happened_at, e.subject,
		encode(sha256(convert_to(e.body, 'UTF8')), 'hex') as body_sha256, e.message_id,
		case when e.authored is null and e.message_id is null then 'both'
			when e.authored is null then 'pair' else 'message_id' end as needs
	from email e join activity a on a.id = e.activity_id
	join email_mailbox m on m.activity_id = e.activity_id join app_user u on u.id = m.user_id
	where e.authored is null or e.message_id is null
),
-- Today's system filed an email as a row per record and mailbox; outside_id names the email each became.
linked as (
	select x.email_activity_id, o.email_identity ->> 'mailbox_owner' as owner,
		o.email_identity ->> 'mailbox_account' as account, o.email_identity ->> 'item_id' as item_id
	from outside_id x join :old_activity o on x.value = o.id::text
	where x.source = 'old_system' and x.email_activity_id in (select activity_id from candidate)
),
-- Only an hxstore key finds the item again; rows filed to several records share one.
locator as (
	select email_activity_id, owner, item_id,
		case when count(distinct account) = 1 then min(account) end as account
	from linked where starts_with(item_id, 'hxstore-key:')
	group by email_activity_id, owner, item_id
),
found as (
	select c.activity_id, c.user_id, count(l.email_activity_id) as linked,
		count(*) filter (where l.owner = c.slug) as owned,
		coalesce(bool_or(l.owner <> c.slug), false) as other_owner,
		(select count(*) from locator k where k.email_activity_id = c.activity_id and k.owner = c.slug) as locators
	from candidate c left join linked l on l.email_activity_id = c.activity_id
	group by c.activity_id, c.user_id, c.slug
),
-- Read only where the mailbox filed exactly one key.
only_locator as (
	select c.activity_id, c.user_id, k.item_id, k.account
	from candidate c join found f using (activity_id, user_id)
	join locator k on k.email_activity_id = c.activity_id and k.owner = c.slug
	where f.locators = 1
)
select coalesce(jsonb_agg(to_jsonb(r) order by r.activity_id, r.user_id), '[]') as candidates
from (
	select c.*, k.account as mailbox_account, k.item_id as item_locator,
		case when f.locators = 1 then 'locator'
			when f.locators > 1 then 'several_locators'
			when f.owned > 0 then 'no_locator'
			when f.other_owner then 'mailbox_mismatch'
			when f.linked > 0 then 'no_identity'
			else 'no_old_activity' end as reason
	from candidate c join found f using (activity_id, user_id)
	left join only_locator k using (activity_id, user_id)
) r \gset

select activity_id, user_id, slug, sender, happened_at, subject, body_sha256, message_id, needs,
	mailbox_account, item_locator, reason
from jsonb_to_recordset(:'candidates'::jsonb) r(activity_id uuid, user_id uuid, slug text, sender text,
	happened_at text, subject text, body_sha256 text, message_id text, needs text,
	mailbox_account text, item_locator text, reason text)
order by activity_id, user_id \g (format=csv) :out

\pset format csv
select v.reason, count(r.reason) as candidates
from (values (1, 'locator'), (2, 'several_locators'), (3, 'no_locator'),
	(4, 'mailbox_mismatch'), (5, 'no_identity'), (6, 'no_old_activity')) v(n, reason)
left join jsonb_to_recordset(:'candidates'::jsonb) r(reason text) on r.reason = v.reason
group by v.n, v.reason order by v.n;
commit;
