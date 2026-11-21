begin;

alter table next.home_update add column if not exists held_until timestamptz;

insert into next.job (slug, label) values ('nightly_checklist', 'Nightly checklist reminders')
on conflict (slug) do nothing;

commit;

-- Read back the nullable timestamp and nightly job registration. Expect one of each.
-- The delta does not change grants; the ACL columns show existing access.
-- select attname, format_type(atttypid, atttypmod), attnotnull, attacl
-- from pg_attribute where attrelid = 'next.home_update'::regclass
--   and attname = 'held_until' and not attisdropped;
-- select slug, label from next.job where slug = 'nightly_checklist';
