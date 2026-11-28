# next.design_template

## Columns

| Name                | Type                     | Default           | Nullable | Children                  | Parents                           | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | ------------------------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |                   | false    |                           |                                   |         |
| changed_by_job      | text                     |                   | true     |                           | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |                   | true     |                           | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |                   | true     |                           | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()             | false    |                           |                                   |         |
| id                  | uuid                     | gen_random_uuid() | false    | [next.post](next.post.md) |                                   |         |
| name                | text                     |                   | false    |                           |                                   |         |

## Viewpoints

| Name                                                      | Definition                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Marketing categories](viewpoint-marketing-categories.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                       | Type        | Definition                                                                                                                           |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| design_template_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| design_template_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| design_template_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| design_template_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| design_template_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| design_template_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| design_template_id_not_null                | n           | NOT NULL id                                                                                                                          |
| design_template_name_key                   | UNIQUE      | UNIQUE (name)                                                                                                                        |
| design_template_name_not_null              | n           | NOT NULL name                                                                                                                        |
| design_template_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |

## Indexes

| Name                     | Definition                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------- |
| design_template_name_key | CREATE UNIQUE INDEX design_template_name_key ON next.design_template USING btree (name) |
| design_template_pkey     | CREATE UNIQUE INDEX design_template_pkey ON next.design_template USING btree (id)       |

## Triggers

| Name          | Definition                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.design_template FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.design_template FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
