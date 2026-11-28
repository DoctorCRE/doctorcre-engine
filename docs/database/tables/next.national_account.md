# next.national_account

## Columns

| Name                | Type                     | Default                  | Nullable | Extra Definition                           | Children                                                      | Parents                                                           | Comment |
| ------------------- | ------------------------ | ------------------------ | -------- | ------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------- | ------- |
| changed_at          | timestamp with time zone |                          | false    |                                            |                                                               |                                                                   |         |
| changed_by_job      | text                     |                          | true     |                                            |                                                               | [next.job](next.job.md)                                           |         |
| changed_by_user_id  | uuid                     |                          | true     |                                            |                                                               | [next.app_user](next.app_user.md)                                 |         |
| changed_for_user_id | uuid                     |                          | true     |                                            |                                                               | [next.app_user](next.app_user.md)                                 |         |
| created_at          | timestamp with time zone | now()                    | false    |                                            |                                                               |                                                                   |         |
| kind                | text                     |                          | true     | GENERATED ALWAYS AS 'company'::text STORED |                                                               | [next.party](next.party.md)                                       |         |
| party_id            | uuid                     |                          | false    |                                            | [next.national_account_owner](next.national_account_owner.md) | [next.party](next.party.md) [next.party_role](next.party_role.md) |         |
| role                | text                     | 'national_account'::text | false    |                                            |                                                               | [next.party_role](next.party_role.md)                             |         |

## Viewpoints

| Name                            | Definition                                             |
| ------------------------------- | ------------------------------------------------------ |
| [Clients](viewpoint-clients.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                        | Type        | Definition                                                                                                                           |
| ------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| national_account_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| national_account_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| national_account_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| national_account_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| national_account_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| national_account_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| national_account_party_id_kind_fkey         | FOREIGN KEY | FOREIGN KEY (party_id, kind) REFERENCES party(id, kind)                                                                              |
| national_account_party_id_not_null          | n           | NOT NULL party_id                                                                                                                    |
| national_account_party_id_role_fkey         | FOREIGN KEY | FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE                                                 |
| national_account_pkey                       | PRIMARY KEY | PRIMARY KEY (party_id)                                                                                                               |
| national_account_role_check                 | CHECK       | CHECK ((role = 'national_account'::text))                                                                                            |
| national_account_role_not_null              | n           | NOT NULL role                                                                                                                        |

## Indexes

| Name                  | Definition                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------- |
| national_account_pkey | CREATE UNIQUE INDEX national_account_pkey ON next.national_account USING btree (party_id) |

## Triggers

| Name          | Definition                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.national_account FOR EACH ROW EXECUTE FUNCTION record_change('party_id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.national_account FOR EACH ROW EXECUTE FUNCTION stamp_change()                      |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
