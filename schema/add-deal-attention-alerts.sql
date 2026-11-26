-- Add deal attention alert state and job registration to an existing next schema (#1416).
begin;
set local lock_timeout = '1s';
set local search_path = next, pg_temp;

insert into job (slug, label) values ('attention_alerts', 'Deal attention alerts')
on conflict (slug) do nothing;

create table if not exists deal_attention_alert (
	deal_id uuid primary key references deal on delete cascade,
	reason text not null check (reason ~ '\S'),
	owner_user_id uuid not null references app_user,
	alerted_at timestamptz not null default now()
);

grant select, insert, delete on deal_attention_alert to engine;
grant update (reason, owner_user_id, alerted_at) on deal_attention_alert to engine;
grant select on deal_attention_alert to engine_reader;

commit;

-- Read back the job registration, table columns and grants. Expect one job row,
-- four columns, select/insert/delete on engine, select on engine_reader, and update
-- on the three non-key columns only.
-- select slug, label from next.job where slug = 'attention_alerts';
-- select attname, format_type(atttypid, atttypmod), attnotnull
-- from pg_attribute where attrelid = 'next.deal_attention_alert'::regclass
--   and attnum > 0 and not attisdropped order by attnum;
-- select has_table_privilege('engine', 'next.deal_attention_alert', 'select') as engine_select,
--   has_table_privilege('engine', 'next.deal_attention_alert', 'insert') as engine_insert,
--   has_table_privilege('engine', 'next.deal_attention_alert', 'delete') as engine_delete,
--   has_table_privilege('engine_reader', 'next.deal_attention_alert', 'select') as reader_select;
