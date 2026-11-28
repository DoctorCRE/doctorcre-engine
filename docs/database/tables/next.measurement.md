# next.measurement

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                                                                   | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | ------------------------------------------------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                                                           |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)                                                   |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md)                                         |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md)                                         |         |
| metric              | text                     |         | false    |          | [next.platform_metric](next.platform_metric.md)                           |         |
| not_measured_reason | text                     |         | true     |          |                                                                           |         |
| platform            | text                     |         | false    |          | [next.platform_metric](next.platform_metric.md) [next.post](next.post.md) |         |
| post_id             | uuid                     |         | false    |          | [next.post](next.post.md)                                                 |         |
| source              | text                     |         | false    |          |                                                                           |         |
| taken_at            | timestamp with time zone |         | false    |          |                                                                           |         |
| value               | bigint                   |         | true     |          |                                                                           |         |

## Viewpoints

| Name                              | Definition                                             |
| --------------------------------- | ------------------------------------------------------ |
| [Property](viewpoint-property.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                   | Type        | Definition                                                                                                                           |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| measurement_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| measurement_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| measurement_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| measurement_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| measurement_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| measurement_metric_not_null            | n           | NOT NULL metric                                                                                                                      |
| measurement_not_measured_reason_check  | CHECK       | CHECK ((not_measured_reason ~ '\S'::text))                                                                                           |
| measurement_pkey                       | PRIMARY KEY | PRIMARY KEY (post_id, metric, taken_at, source)                                                                                      |
| measurement_platform_metric_fkey       | FOREIGN KEY | FOREIGN KEY (platform, metric) REFERENCES platform_metric(platform, metric)                                                          |
| measurement_platform_not_null          | n           | NOT NULL platform                                                                                                                    |
| measurement_post_id_not_null           | n           | NOT NULL post_id                                                                                                                     |
| measurement_post_id_platform_fkey      | FOREIGN KEY | FOREIGN KEY (post_id, platform) REFERENCES post(id, platform)                                                                        |
| measurement_source_check               | CHECK       | CHECK ((source ~ '\S'::text))                                                                                                        |
| measurement_source_not_null            | n           | NOT NULL source                                                                                                                      |
| measurement_taken_at_not_null          | n           | NOT NULL taken_at                                                                                                                    |
| measurement_value_check                | CHECK       | CHECK ((value >= 0))                                                                                                                 |
| measurement_value_or_reason            | CHECK       | CHECK ((num_nonnulls(value, not_measured_reason) = 1))                                                                               |

## Indexes

| Name             | Definition                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| measurement_pkey | CREATE UNIQUE INDEX measurement_pkey ON next.measurement USING btree (post_id, metric, taken_at, source) |

## Triggers

| Name                         | Definition                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| measurement_after_publishing | CREATE TRIGGER measurement_after_publishing BEFORE INSERT ON next.measurement FOR EACH ROW EXECUTE FUNCTION measurement_after_publishing()                               |
| record_change                | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.measurement FOR EACH ROW EXECUTE FUNCTION record_change('post_id', 'metric', 'taken_at', 'source') |
| stamp_change                 | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.measurement FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                     |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
