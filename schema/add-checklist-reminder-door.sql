begin;

alter table next.home_update add column if not exists held_until timestamptz;

insert into next.job (slug, label) values ('nightly_checklist', 'Nightly checklist reminders')
on conflict (slug) do nothing;

commit;
