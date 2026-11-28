# next.post_review

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                                                       | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | ------------------------------------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                                               |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)                                       |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md)                             |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md)                             |         |
| outcome             | text                     |         | false    |          |                                                               |         |
| post_id             | uuid                     |         | false    |          | [next.post](next.post.md) [next.post_text](next.post_text.md) |         |
| text_version        | smallint                 |         | true     |          | [next.post_text](next.post_text.md)                           |         |

## Viewpoints

| Name                                              | Definition                                             |
| ------------------------------------------------- | ------------------------------------------------------ |
| [Marketing review](viewpoint-marketing-review.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                   | Type        | Definition                                                                                                                           |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| post_review_by_a_user                  | CHECK       | CHECK (((outcome = 'no_response'::text) = (COALESCE(changed_by_user_id, changed_for_user_id) IS NULL)))                              |
| post_review_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| post_review_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| post_review_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| post_review_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| post_review_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| post_review_edit_names_its_text        | CHECK       | CHECK (((outcome = 'edited'::text) = (text_version IS NOT NULL)))                                                                    |
| post_review_outcome_check              | CHECK       | CHECK ((outcome = ANY (ARRAY['edited'::text, 'cancelled'::text, 'no_response'::text])))                                              |
| post_review_outcome_not_null           | n           | NOT NULL outcome                                                                                                                     |
| post_review_post_id_fkey               | FOREIGN KEY | FOREIGN KEY (post_id) REFERENCES post(id)                                                                                            |
| post_review_post_id_not_null           | n           | NOT NULL post_id                                                                                                                     |
| post_review_post_id_text_version_fkey  | FOREIGN KEY | FOREIGN KEY (post_id, text_version) REFERENCES post_text(post_id, version)                                                           |
| post_review_post_id_text_version_key   | UNIQUE      | UNIQUE (post_id, text_version)                                                                                                       |
| post_review_text_version_check         | CHECK       | CHECK ((text_version > 1))                                                                                                           |

## Indexes

| Name                                 | Definition                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| post_review_once                     | CREATE UNIQUE INDEX post_review_once ON next.post_review USING btree (post_id, outcome) WHERE (outcome <> 'edited'::text) |
| post_review_post_id_text_version_key | CREATE UNIQUE INDEX post_review_post_id_text_version_key ON next.post_review USING btree (post_id, text_version)          |

## Triggers

| Name                  | Definition                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| post_review_in_window | CREATE TRIGGER post_review_in_window BEFORE INSERT ON next.post_review FOR EACH ROW EXECUTE FUNCTION post_review_in_window()    |
| record_change         | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.post_review FOR EACH ROW EXECUTE FUNCTION record_change() |
| stamp_change          | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.post_review FOR EACH ROW EXECUTE FUNCTION stamp_change()            |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
