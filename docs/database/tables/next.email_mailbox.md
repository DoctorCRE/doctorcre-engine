# next.email_mailbox

## Columns

| Name                | Type                     | Default | Nullable | Children                                                                                              | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | ----------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| activity_id         | uuid                     |         | false    | [next.doc_judgment_job](next.doc_judgment_job.md) [next.lead_email_source](next.lead_email_source.md) | [next.email](next.email.md)       |         |
| changed_at          | timestamp with time zone |         | false    |                                                                                                       |                                   |         |
| changed_by_job      | text                     |         | true     |                                                                                                       | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |                                                                                                       | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |                                                                                                       | [next.app_user](next.app_user.md) |         |
| user_id             | uuid                     |         | false    | [next.doc_judgment_job](next.doc_judgment_job.md) [next.lead_email_source](next.lead_email_source.md) | [next.app_user](next.app_user.md) |         |

## Viewpoints

| Name                        | Definition                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| [Email](viewpoint-email.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                     | Type        | Definition                                                                                                                           |
| ---------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| email_mailbox_activity_id_fkey           | FOREIGN KEY | FOREIGN KEY (activity_id) REFERENCES email(activity_id)                                                                              |
| email_mailbox_activity_id_not_null       | n           | NOT NULL activity_id                                                                                                                 |
| email_mailbox_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| email_mailbox_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| email_mailbox_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| email_mailbox_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| email_mailbox_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| email_mailbox_pkey                       | PRIMARY KEY | PRIMARY KEY (activity_id, user_id)                                                                                                   |
| email_mailbox_user_id_fkey               | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES app_user(id)                                                                                        |
| email_mailbox_user_id_not_null           | n           | NOT NULL user_id                                                                                                                     |

## Indexes

| Name               | Definition                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| email_mailbox_pkey | CREATE UNIQUE INDEX email_mailbox_pkey ON next.email_mailbox USING btree (activity_id, user_id) |

## Triggers

| Name          | Definition                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.email_mailbox FOR EACH ROW EXECUTE FUNCTION record_change('activity_id', 'user_id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.email_mailbox FOR EACH ROW EXECUTE FUNCTION stamp_change()                                    |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
