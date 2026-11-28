# next.national_account_owner

## Columns

| Name                | Type                     | Default           | Nullable | Extra Definition                | Children | Parents                                           | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | ------------------------------- | -------- | ------------------------------------------------- | ------- |
| account_id          | uuid                     |                   | false    |                                 |          | [next.national_account](next.national_account.md) |         |
| changed_at          | timestamp with time zone |                   | false    |                                 |          |                                                   |         |
| changed_by_job      | text                     |                   | true     |                                 |          | [next.job](next.job.md)                           |         |
| changed_by_user_id  | uuid                     |                   | true     |                                 |          | [next.app_user](next.app_user.md)                 |         |
| changed_for_user_id | uuid                     |                   | true     |                                 |          | [next.app_user](next.app_user.md)                 |         |
| created_at          | timestamp with time zone | now()             | false    |                                 |          |                                                   |         |
| ended_on            | date                     |                   | true     |                                 |          |                                                   |         |
| id                  | uuid                     | gen_random_uuid() | false    |                                 |          |                                                   |         |
| owner_id            | uuid                     |                   | false    |                                 |          | [next.app_user](next.app_user.md)                 |         |
| owner_is_partner    | boolean                  |                   | true     | GENERATED ALWAYS AS true STORED |          | [next.app_user](next.app_user.md)                 |         |
| started_on          | date                     |                   | false    |                                 |          |                                                   |         |

## Viewpoints

| Name                            | Definition                                             |
| ------------------------------- | ------------------------------------------------------ |
| [Clients](viewpoint-clients.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                                  | Type        | Definition                                                                                                                           |
| ----------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| national_account_owner_account_id_daterange_excl      | x           | EXCLUDE USING gist (account_id WITH =, daterange(started_on, ended_on) WITH &&)                                                      |
| national_account_owner_account_id_fkey                | FOREIGN KEY | FOREIGN KEY (account_id) REFERENCES national_account(party_id) ON UPDATE CASCADE                                                     |
| national_account_owner_account_id_not_null            | n           | NOT NULL account_id                                                                                                                  |
| national_account_owner_changed_at_not_null            | n           | NOT NULL changed_at                                                                                                                  |
| national_account_owner_changed_by_a_user_or_a_job     | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| national_account_owner_changed_by_job_fkey            | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| national_account_owner_changed_by_user_id_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| national_account_owner_changed_for_user_id_fkey       | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| national_account_owner_check                          | CHECK       | CHECK ((ended_on > started_on))                                                                                                      |
| national_account_owner_created_at_not_null            | n           | NOT NULL created_at                                                                                                                  |
| national_account_owner_id_not_null                    | n           | NOT NULL id                                                                                                                          |
| national_account_owner_owner_id_not_null              | n           | NOT NULL owner_id                                                                                                                    |
| national_account_owner_owner_id_owner_is_partner_fkey | FOREIGN KEY | FOREIGN KEY (owner_id, owner_is_partner) REFERENCES app_user(id, is_account_partner)                                                 |
| national_account_owner_pkey                           | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| national_account_owner_started_on_not_null            | n           | NOT NULL started_on                                                                                                                  |

## Indexes

| Name                                             | Definition                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| national_account_owner_account_id_daterange_excl | CREATE INDEX national_account_owner_account_id_daterange_excl ON next.national_account_owner USING gist (account_id, daterange(started_on, ended_on)) |
| national_account_owner_pkey                      | CREATE UNIQUE INDEX national_account_owner_pkey ON next.national_account_owner USING btree (id)                                                       |

## Triggers

| Name          | Definition                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.national_account_owner FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.national_account_owner FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
