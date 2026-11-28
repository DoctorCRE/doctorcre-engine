# next.calendar_agenda

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| observed_at         | timestamp with time zone |         | false    |          |                                   |         |
| snapshot            | json                     |         | false    |          |                                   |         |
| user_id             | uuid                     |         | false    |          | [next.app_user](next.app_user.md) |         |

## Viewpoints

| Name                                            | Definition                                             |
| ----------------------------------------------- | ------------------------------------------------------ |
| [Home and calendar](viewpoint-home-calendar.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                       | Type        | Definition                                                                                                                                       |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| calendar_agenda_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                              |
| calendar_agenda_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))             |
| calendar_agenda_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                |
| calendar_agenda_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                         |
| calendar_agenda_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                        |
| calendar_agenda_observed_at_not_null       | n           | NOT NULL observed_at                                                                                                                             |
| calendar_agenda_pkey                       | PRIMARY KEY | PRIMARY KEY (user_id)                                                                                                                            |
| calendar_agenda_size                       | CHECK       | CHECK (((length((snapshot)::text) + length(regexp_replace((snapshot)::text, '[^\U00010000-\U0010FFFF]'::text, ''::text, 'g'::text))) <= 262144)) |
| calendar_agenda_snapshot_not_null          | n           | NOT NULL snapshot                                                                                                                                |
| calendar_agenda_user_id_fkey               | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES app_user(id)                                                                                                    |
| calendar_agenda_user_id_not_null           | n           | NOT NULL user_id                                                                                                                                 |

## Indexes

| Name                 | Definition                                                                             |
| -------------------- | -------------------------------------------------------------------------------------- |
| calendar_agenda_pkey | CREATE UNIQUE INDEX calendar_agenda_pkey ON next.calendar_agenda USING btree (user_id) |

## Triggers

| Name                      | Definition                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| calendar_agenda_monotonic | CREATE TRIGGER calendar_agenda_monotonic BEFORE UPDATE ON next.calendar_agenda FOR EACH ROW EXECUTE FUNCTION calendar_agenda_monotonic()     |
| record_change             | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.calendar_agenda FOR EACH ROW EXECUTE FUNCTION record_change('user_id') |
| stamp_change              | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.calendar_agenda FOR EACH ROW EXECUTE FUNCTION stamp_change()                     |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
