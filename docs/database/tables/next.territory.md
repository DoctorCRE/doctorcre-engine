# next.territory

## Columns

| Name                | Type                     | Default           | Nullable | Children                                                                                        | Parents                           | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | ----------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |                   | false    |                                                                                                 |                                   |         |
| changed_by_job      | text                     |                   | true     |                                                                                                 | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |                   | true     |                                                                                                 | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |                   | true     |                                                                                                 | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()             | false    |                                                                                                 |                                   |         |
| id                  | uuid                     | gen_random_uuid() | false    | [next.party_territory](next.party_territory.md) [next.territory_piece](next.territory_piece.md) |                                   |         |
| name                | text                     |                   | false    |                                                                                                 |                                   |         |

## Viewpoints

| Name                                                        | Definition                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Vendors and territories](viewpoint-vendors-territories.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                 | Type        | Definition                                                                                                                           |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| territory_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| territory_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| territory_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| territory_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| territory_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| territory_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| territory_id_not_null                | n           | NOT NULL id                                                                                                                          |
| territory_name_check                 | CHECK       | CHECK ((name ~ '\S'::text))                                                                                                          |
| territory_name_not_null              | n           | NOT NULL name                                                                                                                        |
| territory_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |

## Indexes

| Name           | Definition                                                            |
| -------------- | --------------------------------------------------------------------- |
| territory_pkey | CREATE UNIQUE INDEX territory_pkey ON next.territory USING btree (id) |

## Triggers

| Name          | Definition                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.territory FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.territory FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
