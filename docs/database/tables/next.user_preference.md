# next.user_preference

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()   | false    |          |                                   |         |
| push_to_device      | boolean                  | false   | false    |          |                                   |         |
| quiet_from          | time without time zone   |         | true     |          |                                   |         |
| quiet_until         | time without time zone   |         | true     |          |                                   |         |
| time_zone           | time_zone                |         | false    |          |                                   |         |
| user_id             | uuid                     |         | false    |          | [next.app_user](next.app_user.md) |         |

## Viewpoints

| Name                                                        | Definition                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Changes and preferences](viewpoint-changes-preferences.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                       | Type        | Definition                                                                                                                           |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| user_preference_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| user_preference_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| user_preference_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| user_preference_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| user_preference_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| user_preference_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| user_preference_pkey                       | PRIMARY KEY | PRIMARY KEY (user_id)                                                                                                                |
| user_preference_push_to_device_not_null    | n           | NOT NULL push_to_device                                                                                                              |
| user_preference_quiet_hours                | CHECK       | CHECK ((((quiet_from IS NULL) = (quiet_until IS NULL)) AND (quiet_from <> quiet_until)))                                             |
| user_preference_time_zone_not_null         | n           | NOT NULL time_zone                                                                                                                   |
| user_preference_user_id_fkey               | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES app_user(id)                                                                                        |
| user_preference_user_id_not_null           | n           | NOT NULL user_id                                                                                                                     |

## Indexes

| Name                 | Definition                                                                             |
| -------------------- | -------------------------------------------------------------------------------------- |
| user_preference_pkey | CREATE UNIQUE INDEX user_preference_pkey ON next.user_preference USING btree (user_id) |

## Triggers

| Name          | Definition                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.user_preference FOR EACH ROW EXECUTE FUNCTION record_change('user_id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.user_preference FOR EACH ROW EXECUTE FUNCTION stamp_change()                     |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
