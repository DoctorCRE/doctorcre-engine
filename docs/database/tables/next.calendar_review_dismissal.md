# next.calendar_review_dismissal

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| dismissed_at        | timestamp with time zone | now()   | false    |          |                                   |         |
| key                 | text                     |         | false    |          |                                   |         |
| user_id             | uuid                     |         | false    |          | [next.app_user](next.app_user.md) |         |

## Viewpoints

| Name                                            | Definition                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| [Home and calendar](viewpoint-home-calendar.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                                 | Type        | Definition                                                                                                                           |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| calendar_review_dismissal_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| calendar_review_dismissal_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| calendar_review_dismissal_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| calendar_review_dismissal_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| calendar_review_dismissal_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| calendar_review_dismissal_dismissed_at_not_null      | n           | NOT NULL dismissed_at                                                                                                                |
| calendar_review_dismissal_key_check                  | CHECK       | CHECK ((key ~ '^[a-f0-9]{16}$'::text))                                                                                               |
| calendar_review_dismissal_key_not_null               | n           | NOT NULL key                                                                                                                         |
| calendar_review_dismissal_pkey                       | PRIMARY KEY | PRIMARY KEY (user_id, key)                                                                                                           |
| calendar_review_dismissal_user_id_fkey               | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES app_user(id)                                                                                        |
| calendar_review_dismissal_user_id_not_null           | n           | NOT NULL user_id                                                                                                                     |

## Indexes

| Name                           | Definition                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| calendar_review_dismissal_pkey | CREATE UNIQUE INDEX calendar_review_dismissal_pkey ON next.calendar_review_dismissal USING btree (user_id, key) |

## Triggers

| Name          | Definition                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.calendar_review_dismissal FOR EACH ROW EXECUTE FUNCTION record_change('user_id', 'key') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.calendar_review_dismissal FOR EACH ROW EXECUTE FUNCTION stamp_change()                            |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
