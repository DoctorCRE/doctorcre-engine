# next.reply_draft_document

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                                 | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                         |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)                 |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md)       |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md)       |         |
| created_at          | timestamp with time zone | now()   | false    |          |                                         |         |
| document_id         | uuid                     |         | false    |          | [next.document](next.document.md)       |         |
| reply_draft_id      | uuid                     |         | false    |          | [next.reply_draft](next.reply_draft.md) |         |

## Viewpoints

| Name                        | Definition                                             |
| --------------------------- | ------------------------------------------------------ |
| [Email](viewpoint-email.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                            | Type        | Definition                                                                                                                           |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| reply_draft_document_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| reply_draft_document_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| reply_draft_document_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| reply_draft_document_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| reply_draft_document_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| reply_draft_document_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| reply_draft_document_document_id_fkey           | FOREIGN KEY | FOREIGN KEY (document_id) REFERENCES document(id)                                                                                    |
| reply_draft_document_document_id_not_null       | n           | NOT NULL document_id                                                                                                                 |
| reply_draft_document_pkey                       | PRIMARY KEY | PRIMARY KEY (reply_draft_id, document_id)                                                                                            |
| reply_draft_document_reply_draft_id_fkey        | FOREIGN KEY | FOREIGN KEY (reply_draft_id) REFERENCES reply_draft(id)                                                                              |
| reply_draft_document_reply_draft_id_not_null    | n           | NOT NULL reply_draft_id                                                                                                              |

## Indexes

| Name                      | Definition                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| reply_draft_document_pkey | CREATE UNIQUE INDEX reply_draft_document_pkey ON next.reply_draft_document USING btree (reply_draft_id, document_id) |

## Triggers

| Name                             | Definition                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change                    | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.reply_draft_document FOR EACH ROW EXECUTE FUNCTION record_change('reply_draft_id', 'document_id') |
| reply_draft_document_owner_edits | CREATE TRIGGER reply_draft_document_owner_edits BEFORE INSERT OR DELETE ON next.reply_draft_document FOR EACH ROW EXECUTE FUNCTION reply_draft_document_owner_edits()   |
| stamp_change                     | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.reply_draft_document FOR EACH ROW EXECUTE FUNCTION stamp_change()                                           |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
