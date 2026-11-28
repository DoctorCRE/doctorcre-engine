# next.post

## Columns

| Name                | Type                     | Default           | Nullable | Children                                                                                                                                                  | Parents                                                                                       | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------- |
| changed_at          | timestamp with time zone |                   | false    |                                                                                                                                                           |                                                                                               |         |
| changed_by_job      | text                     |                   | true     |                                                                                                                                                           | [next.job](next.job.md)                                                                       |         |
| changed_by_user_id  | uuid                     |                   | true     |                                                                                                                                                           | [next.app_user](next.app_user.md)                                                             |         |
| changed_for_user_id | uuid                     |                   | true     |                                                                                                                                                           | [next.app_user](next.app_user.md)                                                             |         |
| design_template_id  | uuid                     |                   | true     |                                                                                                                                                           | [next.design_template](next.design_template.md)                                               |         |
| format              | text                     |                   | false    | [next.post_media](next.post_media.md)                                                                                                                     | [next.platform_format](next.platform_format.md)                                               |         |
| id                  | uuid                     | gen_random_uuid() | false    | [next.measurement](next.measurement.md) [next.post_media](next.post_media.md) [next.post_review](next.post_review.md) [next.post_text](next.post_text.md) |                                                                                               |         |
| idea_id             | uuid                     |                   | true     |                                                                                                                                                           | [next.idea](next.idea.md)                                                                     |         |
| platform            | text                     |                   | false    | [next.measurement](next.measurement.md)                                                                                                                   | [next.platform_format](next.platform_format.md) [next.social_account](next.social_account.md) |         |
| platform_post_id    | text                     |                   | true     |                                                                                                                                                           |                                                                                               |         |
| published_at        | timestamp with time zone |                   | true     |                                                                                                                                                           |                                                                                               |         |
| reason              | text                     |                   | true     |                                                                                                                                                           |                                                                                               |         |
| scheduled_at        | timestamp with time zone |                   | false    |                                                                                                                                                           |                                                                                               |         |
| social_account_id   | uuid                     |                   | false    |                                                                                                                                                           | [next.social_account](next.social_account.md)                                                 |         |
| status              | text                     | 'scheduled'::text | false    |                                                                                                                                                           |                                                                                               |         |

## Viewpoints

| Name                                            | Definition                                             |
| ----------------------------------------------- | ------------------------------------------------------ |
| [Marketing posts](viewpoint-marketing-posts.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                        | Type        | Definition                                                                                                                                |
| ------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| post_changed_at_not_null                    | n           | NOT NULL changed_at                                                                                                                       |
| post_changed_by_a_user_or_a_job             | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))      |
| post_changed_by_job_fkey                    | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                         |
| post_changed_by_user_id_fkey                | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                  |
| post_changed_for_user_id_fkey               | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                 |
| post_design_template_id_fkey                | FOREIGN KEY | FOREIGN KEY (design_template_id) REFERENCES design_template(id)                                                                           |
| post_failed_or_cancelled_says_why           | CHECK       | CHECK (((status = ANY (ARRAY['failed'::text, 'cancelled'::text])) = (reason IS NOT NULL)))                                                |
| post_format_not_null                        | n           | NOT NULL format                                                                                                                           |
| post_id_format_key                          | UNIQUE      | UNIQUE (id, format)                                                                                                                       |
| post_id_not_null                            | n           | NOT NULL id                                                                                                                               |
| post_id_platform_key                        | UNIQUE      | UNIQUE (id, platform)                                                                                                                     |
| post_idea_id_fkey                           | FOREIGN KEY | FOREIGN KEY (idea_id) REFERENCES idea(id)                                                                                                 |
| post_pkey                                   | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                          |
| post_platform_format_fkey                   | FOREIGN KEY | FOREIGN KEY (platform, format) REFERENCES platform_format(platform, format)                                                               |
| post_platform_not_null                      | n           | NOT NULL platform                                                                                                                         |
| post_published_has_id_and_time              | CHECK       | CHECK ((num_nonnulls(platform_post_id, published_at) =<br />CASE status<br />    WHEN 'published'::text THEN 2<br />    ELSE 0<br />END)) |
| post_reason_check                           | CHECK       | CHECK ((reason ~ '\S'::text))                                                                                                             |
| post_scheduled_at_not_null                  | n           | NOT NULL scheduled_at                                                                                                                     |
| post_social_account_id_not_null             | n           | NOT NULL social_account_id                                                                                                                |
| post_social_account_id_platform_fkey        | FOREIGN KEY | FOREIGN KEY (social_account_id, platform) REFERENCES social_account(id, platform)                                                         |
| post_social_account_id_platform_post_id_key | UNIQUE      | UNIQUE (social_account_id, platform_post_id)                                                                                              |
| post_status_check                           | CHECK       | CHECK ((status = ANY (ARRAY['scheduled'::text, 'publishing'::text, 'published'::text, 'failed'::text, 'cancelled'::text])))               |
| post_status_not_null                        | n           | NOT NULL status                                                                                                                           |

## Indexes

| Name                                        | Definition                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| post_id_format_key                          | CREATE UNIQUE INDEX post_id_format_key ON next.post USING btree (id, format)                                                   |
| post_id_platform_key                        | CREATE UNIQUE INDEX post_id_platform_key ON next.post USING btree (id, platform)                                               |
| post_pkey                                   | CREATE UNIQUE INDEX post_pkey ON next.post USING btree (id)                                                                    |
| post_social_account_id_platform_post_id_key | CREATE UNIQUE INDEX post_social_account_id_platform_post_id_key ON next.post USING btree (social_account_id, platform_post_id) |

## Triggers

| Name                       | Definition                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| post_engine_publishes_from | CREATE TRIGGER post_engine_publishes_from BEFORE INSERT OR UPDATE OF status ON next.post FOR EACH ROW WHEN ((new.status = ANY (ARRAY['scheduled'::text, 'publishing'::text]))) EXECUTE FUNCTION post_engine_publishes_from() |
| post_final                 | CREATE TRIGGER post_final BEFORE UPDATE ON next.post FOR EACH ROW WHEN (((old.status = ANY (ARRAY['published'::text, 'failed'::text, 'cancelled'::text])) AND (old.* IS DISTINCT FROM new.*))) EXECUTE FUNCTION post_final() |
| post_status_moves          | CREATE TRIGGER post_status_moves BEFORE INSERT OR UPDATE OF status ON next.post FOR EACH ROW EXECUTE FUNCTION post_status_moves()                                                                                            |
| record_change              | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.post FOR EACH ROW EXECUTE FUNCTION record_change('id')                                                                                                 |
| stamp_change               | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.post FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                                                                                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
