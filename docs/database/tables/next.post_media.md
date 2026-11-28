# next.post_media

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| content_type        | text                     |         | false    |          | [next.document](next.document.md) |         |
| created_at          | timestamp with time zone | now()   | false    |          |                                   |         |
| document_id         | uuid                     |         | false    |          | [next.document](next.document.md) |         |
| format              | text                     |         | false    |          | [next.post](next.post.md)         |         |
| position            | smallint                 |         | false    |          |                                   |         |
| post_id             | uuid                     |         | false    |          | [next.post](next.post.md)         |         |

## Viewpoints

| Name                                            | Definition                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| [Marketing posts](viewpoint-marketing-posts.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                     | Type        | Definition                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| post_media_changed_at_not_null           | n           | NOT NULL changed_at                                                                                                                                                                                                                                                   |
| post_media_changed_by_a_user_or_a_job    | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                                                                                                                  |
| post_media_changed_by_job_fkey           | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                                                                                                                     |
| post_media_changed_by_user_id_fkey       | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                                                                                                                              |
| post_media_changed_for_user_id_fkey      | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                                                                                                                             |
| post_media_content_type_not_null         | n           | NOT NULL content_type                                                                                                                                                                                                                                                 |
| post_media_created_at_not_null           | n           | NOT NULL created_at                                                                                                                                                                                                                                                   |
| post_media_document_id_content_type_fkey | FOREIGN KEY | FOREIGN KEY (document_id, content_type) REFERENCES document(id, content_type)                                                                                                                                                                                         |
| post_media_document_id_not_null          | n           | NOT NULL document_id                                                                                                                                                                                                                                                  |
| post_media_fits_format                   | CHECK       | CHECK (((format <> 'text'::text) AND (("position" = 1) OR (format = 'photo_set'::text))))                                                                                                                                                                             |
| post_media_format_not_null               | n           | NOT NULL format                                                                                                                                                                                                                                                       |
| post_media_pkey                          | PRIMARY KEY | PRIMARY KEY (post_id, "position")                                                                                                                                                                                                                                     |
| post_media_position_check                | CHECK       | CHECK ((("position" >= 1) AND ("position" <= 20)))                                                                                                                                                                                                                    |
| post_media_position_not_null             | n           | NOT NULL "position"                                                                                                                                                                                                                                                   |
| post_media_post_id_format_fkey           | FOREIGN KEY | FOREIGN KEY (post_id, format) REFERENCES post(id, format)                                                                                                                                                                                                             |
| post_media_post_id_not_null              | n           | NOT NULL post_id                                                                                                                                                                                                                                                      |
| post_media_type_fits_format              | CHECK       | CHECK (<br />CASE format<br />    WHEN 'video'::text THEN (content_type = 'video/mp4'::text)<br />    WHEN 'document'::text THEN (content_type = 'application/pdf'::text)<br />    ELSE (content_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text]))<br />END) |

## Indexes

| Name            | Definition                                                                               |
| --------------- | ---------------------------------------------------------------------------------------- |
| post_media_pkey | CREATE UNIQUE INDEX post_media_pkey ON next.post_media USING btree (post_id, "position") |

## Triggers

| Name          | Definition                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.post_media FOR EACH ROW EXECUTE FUNCTION record_change('post_id', 'position') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.post_media FOR EACH ROW EXECUTE FUNCTION stamp_change()                                 |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
