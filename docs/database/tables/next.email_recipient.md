# next.email_recipient

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| activity_id         | uuid                     |         | false    |          | [next.email](next.email.md)       |         |
| address             | email_address            |         | false    |          |                                   |         |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| kind                | text                     |         | false    |          |                                   |         |
| position            | integer                  |         | false    |          |                                   |         |

## Viewpoints

| Name                        | Definition                                             |
| --------------------------- | ------------------------------------------------------ |
| [Email](viewpoint-email.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                       | Type        | Definition                                                                                                                           |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| email_recipient_activity_id_fkey           | FOREIGN KEY | FOREIGN KEY (activity_id) REFERENCES email(activity_id)                                                                              |
| email_recipient_activity_id_not_null       | n           | NOT NULL activity_id                                                                                                                 |
| email_recipient_address_not_null           | n           | NOT NULL address                                                                                                                     |
| email_recipient_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| email_recipient_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| email_recipient_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| email_recipient_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| email_recipient_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| email_recipient_kind_check                 | CHECK       | CHECK ((kind = ANY (ARRAY['to'::text, 'cc'::text])))                                                                                 |
| email_recipient_kind_not_null              | n           | NOT NULL kind                                                                                                                        |
| email_recipient_pkey                       | PRIMARY KEY | PRIMARY KEY (activity_id, "position")                                                                                                |
| email_recipient_position_check             | CHECK       | CHECK (("position" >= 0))                                                                                                            |
| email_recipient_position_not_null          | n           | NOT NULL "position"                                                                                                                  |

## Indexes

| Name                 | Definition                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| email_recipient_pkey | CREATE UNIQUE INDEX email_recipient_pkey ON next.email_recipient USING btree (activity_id, "position") |

## Triggers

| Name          | Definition                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.email_recipient FOR EACH ROW EXECUTE FUNCTION record_change('activity_id', 'position') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.email_recipient FOR EACH ROW EXECUTE FUNCTION stamp_change()                                     |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
