# next.email_document

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()   | false    |          |                                   |         |
| document_id         | uuid                     |         | false    |          | [next.document](next.document.md) |         |
| email_activity_id   | uuid                     |         | false    |          | [next.email](next.email.md)       |         |

## Viewpoints

| Name                        | Definition                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| [Email](viewpoint-email.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                      | Type        | Definition                                                                                                                           |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| email_document_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| email_document_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| email_document_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| email_document_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| email_document_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| email_document_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| email_document_document_id_fkey           | FOREIGN KEY | FOREIGN KEY (document_id) REFERENCES document(id)                                                                                    |
| email_document_document_id_not_null       | n           | NOT NULL document_id                                                                                                                 |
| email_document_email_activity_id_fkey     | FOREIGN KEY | FOREIGN KEY (email_activity_id) REFERENCES email(activity_id)                                                                        |
| email_document_email_activity_id_not_null | n           | NOT NULL email_activity_id                                                                                                           |
| email_document_pkey                       | PRIMARY KEY | PRIMARY KEY (email_activity_id, document_id)                                                                                         |

## Indexes

| Name                | Definition                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| email_document_pkey | CREATE UNIQUE INDEX email_document_pkey ON next.email_document USING btree (email_activity_id, document_id) |

## Triggers

| Name          | Definition                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.email_document FOR EACH ROW EXECUTE FUNCTION record_change('email_activity_id', 'document_id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.email_document FOR EACH ROW EXECUTE FUNCTION stamp_change()                                              |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
