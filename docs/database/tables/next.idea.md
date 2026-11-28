# next.idea

## Columns

| Name                | Type                     | Default           | Nullable | Children                  | Parents                           | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | ------------------------- | --------------------------------- | ------- |
| angle               | text                     |                   | false    |                           |                                   |         |
| changed_at          | timestamp with time zone |                   | false    |                           |                                   |         |
| changed_by_job      | text                     |                   | true     |                           | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |                   | true     |                           | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |                   | true     |                           | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()             | false    |                           |                                   |         |
| hook                | text                     |                   | false    |                           |                                   |         |
| id                  | uuid                     | gen_random_uuid() | false    | [next.post](next.post.md) |                                   |         |
| pillar              | text                     |                   | false    |                           |                                   |         |

## Viewpoints

| Name                                                      | Definition                                             |
| --------------------------------------------------------- | ------------------------------------------------------ |
| [Marketing categories](viewpoint-marketing-categories.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                            | Type        | Definition                                                                                                                           |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| idea_angle_not_null             | n           | NOT NULL angle                                                                                                                       |
| idea_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| idea_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| idea_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| idea_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| idea_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| idea_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| idea_hook_not_null              | n           | NOT NULL hook                                                                                                                        |
| idea_id_not_null                | n           | NOT NULL id                                                                                                                          |
| idea_pillar_not_null            | n           | NOT NULL pillar                                                                                                                      |
| idea_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |

## Indexes

| Name      | Definition                                                  |
| --------- | ----------------------------------------------------------- |
| idea_pkey | CREATE UNIQUE INDEX idea_pkey ON next.idea USING btree (id) |

## Triggers

| Name          | Definition                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.idea FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.idea FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
