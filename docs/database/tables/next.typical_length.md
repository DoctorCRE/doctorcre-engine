# next.typical_length

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                             | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | ----------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                     |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)             |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md)   |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md)   |         |
| days                | integer                  |         | false    |          |                                     |         |
| deal_kind           | text                     |         | false    |          | [next.deal_kind](next.deal_kind.md) |         |
| todo                | text                     |         | false    |          |                                     |         |

## Viewpoints

| Name                        | Definition                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| [Deals](viewpoint-deals.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                      | Type        | Definition                                                                                                                           |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| typical_length_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| typical_length_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| typical_length_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| typical_length_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| typical_length_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| typical_length_days_check                 | CHECK       | CHECK ((days > 0))                                                                                                                   |
| typical_length_days_not_null              | n           | NOT NULL days                                                                                                                        |
| typical_length_deal_kind_fkey             | FOREIGN KEY | FOREIGN KEY (deal_kind) REFERENCES deal_kind(slug)                                                                                   |
| typical_length_deal_kind_not_null         | n           | NOT NULL deal_kind                                                                                                                   |
| typical_length_pkey                       | PRIMARY KEY | PRIMARY KEY (deal_kind, todo)                                                                                                        |
| typical_length_todo_check                 | CHECK       | CHECK ((todo ~ '^[a-z][a-z0-9_]*$'::text))                                                                                           |
| typical_length_todo_not_null              | n           | NOT NULL todo                                                                                                                        |

## Indexes

| Name                | Definition                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------- |
| typical_length_pkey | CREATE UNIQUE INDEX typical_length_pkey ON next.typical_length USING btree (deal_kind, todo) |

## Triggers

| Name          | Definition                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.typical_length FOR EACH ROW EXECUTE FUNCTION record_change('deal_kind', 'todo') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.typical_length FOR EACH ROW EXECUTE FUNCTION stamp_change()                               |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
