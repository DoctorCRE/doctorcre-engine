# next.party_company

## Columns

| Name                | Type                     | Default           | Nullable | Extra Definition                           | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | ------------------------------------------ | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |                   | false    |                                            |          |                                   |         |
| changed_by_job      | text                     |                   | true     |                                            |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |                   | true     |                                            |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |                   | true     |                                            |          | [next.app_user](next.app_user.md) |         |
| company_id          | uuid                     |                   | false    |                                            |          | [next.party](next.party.md)       |         |
| company_kind        | text                     |                   | false    | GENERATED ALWAYS AS 'company'::text STORED |          | [next.party](next.party.md)       |         |
| created_at          | timestamp with time zone | now()             | false    |                                            |          |                                   |         |
| ended_on            | date                     |                   | true     |                                            |          |                                   |         |
| id                  | uuid                     | gen_random_uuid() | false    |                                            |          |                                   |         |
| person_id           | uuid                     |                   | false    |                                            |          | [next.party](next.party.md)       |         |
| person_kind         | text                     |                   | false    | GENERATED ALWAYS AS 'person'::text STORED  |          | [next.party](next.party.md)       |         |
| started_on          | date                     |                   | true     |                                            |          |                                   |         |
| title               | text                     |                   | true     |                                            |          |                                   |         |

## Viewpoints

| Name                          | Definition                                             |
| ----------------------------- | ------------------------------------------------------ |
| [People](viewpoint-people.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                              | Type        | Definition                                                                                                                           |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| party_company_changed_at_not_null                 | n           | NOT NULL changed_at                                                                                                                  |
| party_company_changed_by_a_user_or_a_job          | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| party_company_changed_by_job_fkey                 | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| party_company_changed_by_user_id_fkey             | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| party_company_changed_for_user_id_fkey            | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| party_company_check                               | CHECK       | CHECK ((ended_on >= started_on))                                                                                                     |
| party_company_company_id_company_kind_fkey        | FOREIGN KEY | FOREIGN KEY (company_id, company_kind) REFERENCES party(id, kind)                                                                    |
| party_company_company_id_not_null                 | n           | NOT NULL company_id                                                                                                                  |
| party_company_company_kind_not_null               | n           | NOT NULL company_kind                                                                                                                |
| party_company_created_at_not_null                 | n           | NOT NULL created_at                                                                                                                  |
| party_company_id_not_null                         | n           | NOT NULL id                                                                                                                          |
| party_company_person_id_company_id_started_on_key | UNIQUE      | UNIQUE NULLS NOT DISTINCT (person_id, company_id, started_on)                                                                        |
| party_company_person_id_not_null                  | n           | NOT NULL person_id                                                                                                                   |
| party_company_person_id_person_kind_fkey          | FOREIGN KEY | FOREIGN KEY (person_id, person_kind) REFERENCES party(id, kind)                                                                      |
| party_company_person_kind_not_null                | n           | NOT NULL person_kind                                                                                                                 |
| party_company_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |

## Indexes

| Name                                              | Definition                                                                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| party_company_person_id_company_id_started_on_key | CREATE UNIQUE INDEX party_company_person_id_company_id_started_on_key ON next.party_company USING btree (person_id, company_id, started_on) NULLS NOT DISTINCT |
| party_company_pkey                                | CREATE UNIQUE INDEX party_company_pkey ON next.party_company USING btree (id)                                                                                  |

## Triggers

| Name          | Definition                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.party_company FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.party_company FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
