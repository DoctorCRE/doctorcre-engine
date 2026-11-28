# next.email

## Columns

| Name                | Type                     | Default | Nullable | Extra Definition                         | Children                                                                                                                                                                                                                                                            | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| activity_id         | uuid                     |         | false    |                                          | [next.email_document](next.email_document.md) [next.email_mailbox](next.email_mailbox.md) [next.email_recipient](next.email_recipient.md) [next.email_summary](next.email_summary.md) [next.outside_id](next.outside_id.md) [next.reply_draft](next.reply_draft.md) | [next.activity](next.activity.md) |         |
| activity_kind       | text                     |         | false    | GENERATED ALWAYS AS 'email'::text STORED |                                                                                                                                                                                                                                                                     | [next.activity](next.activity.md) |         |
| authored            | text                     |         | true     |                                          |                                                                                                                                                                                                                                                                     |                                   |         |
| body                | text                     |         | false    |                                          |                                                                                                                                                                                                                                                                     |                                   |         |
| changed_at          | timestamp with time zone |         | false    |                                          |                                                                                                                                                                                                                                                                     |                                   |         |
| changed_by_job      | text                     |         | true     |                                          |                                                                                                                                                                                                                                                                     | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |                                          |                                                                                                                                                                                                                                                                     | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |                                          |                                                                                                                                                                                                                                                                     | [next.app_user](next.app_user.md) |         |
| conversation_id     | text                     |         | true     |                                          |                                                                                                                                                                                                                                                                     |                                   |         |
| history             | text                     |         | true     |                                          |                                                                                                                                                                                                                                                                     |                                   |         |
| imported            | boolean                  | false   | false    |                                          |                                                                                                                                                                                                                                                                     |                                   |         |
| message_id          | text                     |         | true     |                                          |                                                                                                                                                                                                                                                                     |                                   |         |
| sender              | email_address            |         | false    |                                          |                                                                                                                                                                                                                                                                     |                                   |         |
| sender_name         | text                     |         | true     |                                          |                                                                                                                                                                                                                                                                     |                                   |         |
| subject             | text                     |         | false    |                                          |                                                                                                                                                                                                                                                                     |                                   |         |

## Viewpoints

| Name                        | Definition                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| [Email](viewpoint-email.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                 | Type        | Definition                                                                                                                                                   |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| email_about_a_record                 | TRIGGER     | CREATE CONSTRAINT TRIGGER email_about_a_record AFTER INSERT ON next.email DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION email_about_a_record() |
| email_activity_id_activity_kind_fkey | FOREIGN KEY | FOREIGN KEY (activity_id, activity_kind) REFERENCES activity(id, kind)                                                                                       |
| email_activity_id_not_null           | n           | NOT NULL activity_id                                                                                                                                         |
| email_activity_kind_not_null         | n           | NOT NULL activity_kind                                                                                                                                       |
| email_authored_history_pair          | CHECK       | CHECK (((authored IS NULL) = (history IS NULL)))                                                                                                             |
| email_body_not_null                  | n           | NOT NULL body                                                                                                                                                |
| email_changed_at_not_null            | n           | NOT NULL changed_at                                                                                                                                          |
| email_changed_by_a_user_or_a_job     | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                         |
| email_changed_by_job_fkey            | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                            |
| email_changed_by_user_id_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                     |
| email_changed_for_user_id_fkey       | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                    |
| email_conversation_id_not_blank      | CHECK       | CHECK ((conversation_id ~ '\S'::text))                                                                                                                       |
| email_imported_not_null              | n           | NOT NULL imported                                                                                                                                            |
| email_message_id_check               | CHECK       | CHECK ((message_id = btrim(message_id)))                                                                                                                     |
| email_message_id_key                 | UNIQUE      | UNIQUE (message_id)                                                                                                                                          |
| email_message_id_not_blank           | CHECK       | CHECK ((message_id ~ '\S'::text))                                                                                                                            |
| email_message_id_unless_imported     | CHECK       | CHECK (((message_id IS NOT NULL) OR imported))                                                                                                               |
| email_pkey                           | PRIMARY KEY | PRIMARY KEY (activity_id)                                                                                                                                    |
| email_sender_not_null                | n           | NOT NULL sender                                                                                                                                              |
| email_subject_not_null               | n           | NOT NULL subject                                                                                                                                             |

## Indexes

| Name                 | Definition                                                                      |
| -------------------- | ------------------------------------------------------------------------------- |
| email_message_id_key | CREATE UNIQUE INDEX email_message_id_key ON next.email USING btree (message_id) |
| email_pkey           | CREATE UNIQUE INDEX email_pkey ON next.email USING btree (activity_id)          |

## Triggers

| Name                          | Definition                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| email_about_a_record          | CREATE CONSTRAINT TRIGGER email_about_a_record AFTER INSERT ON next.email DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION email_about_a_record()          |
| email_without_message_id_once | CREATE TRIGGER email_without_message_id_once AFTER INSERT ON next.email FOR EACH ROW WHEN ((new.message_id IS NULL)) EXECUTE FUNCTION email_without_message_id_once() |
| record_change                 | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.email FOR EACH ROW EXECUTE FUNCTION record_change('activity_id')                                |
| stamp_change                  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.email FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                        |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
