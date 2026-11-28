# next.party_territory

## Columns

| Name                | Type                     | Default           | Nullable | Children                                                      | Parents                             | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | ------------------------------------------------------------- | ----------------------------------- | ------- |
| changed_at          | timestamp with time zone |                   | false    |                                                               |                                     |         |
| changed_by_job      | text                     |                   | true     |                                                               | [next.job](next.job.md)             |         |
| changed_by_user_id  | uuid                     |                   | true     |                                                               | [next.app_user](next.app_user.md)   |         |
| changed_for_user_id | uuid                     |                   | true     |                                                               | [next.app_user](next.app_user.md)   |         |
| created_at          | timestamp with time zone | now()             | false    |                                                               |                                     |         |
| ended_on            | date                     |                   | true     |                                                               |                                     |         |
| id                  | uuid                     | gen_random_uuid() | false    | [next.party_territory_review](next.party_territory_review.md) |                                     |         |
| party_id            | uuid                     |                   | false    |                                                               | [next.party](next.party.md)         |         |
| started_on          | date                     |                   | true     |                                                               |                                     |         |
| territory_id        | uuid                     |                   | false    |                                                               | [next.territory](next.territory.md) |         |

## Viewpoints

| Name                                                        | Definition                                             |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| [Vendors and territories](viewpoint-vendors-territories.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                                 | Type        | Definition                                                                                                                           |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| party_territory_changed_at_not_null                  | n           | NOT NULL changed_at                                                                                                                  |
| party_territory_changed_by_a_user_or_a_job           | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| party_territory_changed_by_job_fkey                  | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| party_territory_changed_by_user_id_fkey              | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| party_territory_changed_for_user_id_fkey             | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| party_territory_check                                | CHECK       | CHECK ((ended_on >= started_on))                                                                                                     |
| party_territory_created_at_not_null                  | n           | NOT NULL created_at                                                                                                                  |
| party_territory_id_not_null                          | n           | NOT NULL id                                                                                                                          |
| party_territory_party_id_fkey                        | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                          |
| party_territory_party_id_not_null                    | n           | NOT NULL party_id                                                                                                                    |
| party_territory_party_id_territory_id_started_on_key | UNIQUE      | UNIQUE NULLS NOT DISTINCT (party_id, territory_id, started_on)                                                                       |
| party_territory_pkey                                 | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| party_territory_territory_id_fkey                    | FOREIGN KEY | FOREIGN KEY (territory_id) REFERENCES territory(id)                                                                                  |
| party_territory_territory_id_not_null                | n           | NOT NULL territory_id                                                                                                                |

## Indexes

| Name                                                 | Definition                                                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| party_territory_party_id_territory_id_started_on_key | CREATE UNIQUE INDEX party_territory_party_id_territory_id_started_on_key ON next.party_territory USING btree (party_id, territory_id, started_on) NULLS NOT DISTINCT |
| party_territory_pkey                                 | CREATE UNIQUE INDEX party_territory_pkey ON next.party_territory USING btree (id)                                                                                    |

## Triggers

| Name          | Definition                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.party_territory FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.party_territory FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
