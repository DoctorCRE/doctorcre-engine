# next.post_text

## Columns

| Name                | Type                     | Default | Nullable | Extra Definition                                    | Children                                                                    | Parents                                                       | Comment |
| ------------------- | ------------------------ | ------- | -------- | --------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- | ------- |
| body                | text                     |         | false    |                                                     |                                                                             |                                                               |         |
| changed_at          | timestamp with time zone |         | false    |                                                     |                                                                             |                                                               |         |
| changed_by_job      | text                     |         | true     |                                                     |                                                                             | [next.job](next.job.md)                                       |         |
| changed_by_user_id  | uuid                     |         | true     |                                                     |                                                                             | [next.app_user](next.app_user.md)                             |         |
| changed_for_user_id | uuid                     |         | true     |                                                     |                                                                             | [next.app_user](next.app_user.md)                             |         |
| post_id             | uuid                     |         | false    |                                                     | [next.post_review](next.post_review.md) [next.post_text](next.post_text.md) | [next.post](next.post.md) [next.post_text](next.post_text.md) |         |
| previous_version    | smallint                 |         | true     | GENERATED ALWAYS AS NULLIF((version - 1), 0) STORED |                                                                             | [next.post_text](next.post_text.md)                           |         |
| version             | smallint                 |         | false    |                                                     | [next.post_review](next.post_review.md) [next.post_text](next.post_text.md) |                                                               |         |

## Viewpoints

| Name                                              | Definition                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| [Marketing review](viewpoint-marketing-review.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                    | Type        | Definition                                                                                                                           |
| --------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| post_text_body_check                    | CHECK       | CHECK ((body ~ '\S'::text))                                                                                                          |
| post_text_body_not_null                 | n           | NOT NULL body                                                                                                                        |
| post_text_changed_at_not_null           | n           | NOT NULL changed_at                                                                                                                  |
| post_text_changed_by_a_user_or_a_job    | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| post_text_changed_by_job_fkey           | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| post_text_changed_by_user_id_fkey       | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| post_text_changed_for_user_id_fkey      | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| post_text_edit_by_a_user                | CHECK       | CHECK (((version = 1) OR (COALESCE(changed_by_user_id, changed_for_user_id) IS NOT NULL)))                                           |
| post_text_pkey                          | PRIMARY KEY | PRIMARY KEY (post_id, version)                                                                                                       |
| post_text_post_id_fkey                  | FOREIGN KEY | FOREIGN KEY (post_id) REFERENCES post(id)                                                                                            |
| post_text_post_id_not_null              | n           | NOT NULL post_id                                                                                                                     |
| post_text_post_id_previous_version_fkey | FOREIGN KEY | FOREIGN KEY (post_id, previous_version) REFERENCES post_text(post_id, version)                                                       |
| post_text_version_check                 | CHECK       | CHECK ((version >= 1))                                                                                                               |
| post_text_version_not_null              | n           | NOT NULL version                                                                                                                     |

## Indexes

| Name           | Definition                                                                          |
| -------------- | ----------------------------------------------------------------------------------- |
| post_text_pkey | CREATE UNIQUE INDEX post_text_pkey ON next.post_text USING btree (post_id, version) |

## Triggers

| Name                           | Definition                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| post_text_before_review_closes | CREATE TRIGGER post_text_before_review_closes BEFORE INSERT ON next.post_text FOR EACH ROW WHEN ((new.version > 1)) EXECUTE FUNCTION post_text_before_review_closes() |
| record_change                  | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.post_text FOR EACH ROW EXECUTE FUNCTION record_change('post_id', 'version')                     |
| stamp_change                   | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.post_text FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                    |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
