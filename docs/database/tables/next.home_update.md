# next.home_update

## Columns

| Name                | Type                     | Default           | Nullable | Children                            | Parents                           | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | ----------------------------------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |                   | false    |                                     |                                   |         |
| changed_by_job      | text                     |                   | true     |                                     | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |                   | true     |                                     | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |                   | true     |                                     | [next.app_user](next.app_user.md) |         |
| checklist_item_ref  | text                     |                   | true     |                                     |                                   |         |
| created_at          | timestamp with time zone | now()             | false    |                                     |                                   |         |
| deal_id             | uuid                     |                   | false    |                                     | [next.deal](next.deal.md)         |         |
| due_on              | date                     |                   | true     |                                     |                                   |         |
| held_until          | timestamp with time zone |                   | true     |                                     |                                   |         |
| id                  | uuid                     | gen_random_uuid() | false    | [next.home_mark](next.home_mark.md) |                                   |         |
| kind                | text                     | 'update'::text    | false    |                                     |                                   |         |
| property_id         | uuid                     |                   | true     |                                     | [next.property](next.property.md) |         |
| read_at             | timestamp with time zone |                   | true     |                                     |                                   |         |
| user_id             | uuid                     |                   | false    | [next.home_mark](next.home_mark.md) | [next.app_user](next.app_user.md) |         |
| what                | text                     |                   | false    |                                     |                                   |         |

## Viewpoints

| Name                                            | Definition                                             |
| ----------------------------------------------- | ------------------------------------------------------ |
| [Home and calendar](viewpoint-home-calendar.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                                      | Type        | Definition                                                                                                                           |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| home_update_changed_at_not_null                           | n           | NOT NULL changed_at                                                                                                                  |
| home_update_changed_by_a_user_or_a_job                    | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| home_update_changed_by_job_fkey                           | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| home_update_changed_by_user_id_fkey                       | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| home_update_changed_for_user_id_fkey                      | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| home_update_check                                         | CHECK       | CHECK ((read_at >= created_at))                                                                                                      |
| home_update_checklist_due_date                            | CHECK       | CHECK ((((checklist_item_ref IS NULL) = (due_on IS NULL)) AND ((kind = 'update'::text) OR (checklist_item_ref IS NULL))))            |
| home_update_checklist_item_ref_check                      | CHECK       | CHECK ((checklist_item_ref ~ '\S'::text))                                                                                            |
| home_update_created_at_not_null                           | n           | NOT NULL created_at                                                                                                                  |
| home_update_deal_id_fkey                                  | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                            |
| home_update_deal_id_not_null                              | n           | NOT NULL deal_id                                                                                                                     |
| home_update_id_not_null                                   | n           | NOT NULL id                                                                                                                          |
| home_update_id_user_id_key                                | UNIQUE      | UNIQUE (id, user_id)                                                                                                                 |
| home_update_kind_check                                    | CHECK       | CHECK ((kind = ANY (ARRAY['update'::text, 'tour_feedback'::text])))                                                                  |
| home_update_kind_not_null                                 | n           | NOT NULL kind                                                                                                                        |
| home_update_pkey                                          | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| home_update_property_id_fkey                              | FOREIGN KEY | FOREIGN KEY (property_id) REFERENCES property(id)                                                                                    |
| home_update_property_kind                                 | CHECK       | CHECK (((property_id IS NULL) OR (kind = 'tour_feedback'::text)))                                                                    |
| home_update_user_id_deal_id_checklist_item_ref_due_on_key | UNIQUE      | UNIQUE (user_id, deal_id, checklist_item_ref, due_on)                                                                                |
| home_update_user_id_fkey                                  | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES app_user(id)                                                                                        |
| home_update_user_id_not_null                              | n           | NOT NULL user_id                                                                                                                     |
| home_update_what_check                                    | CHECK       | CHECK ((what ~ '\S'::text))                                                                                                          |
| home_update_what_not_null                                 | n           | NOT NULL what                                                                                                                        |

## Indexes

| Name                                                      | Definition                                                                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| home_update_id_user_id_key                                | CREATE UNIQUE INDEX home_update_id_user_id_key ON next.home_update USING btree (id, user_id)                                                                 |
| home_update_pkey                                          | CREATE UNIQUE INDEX home_update_pkey ON next.home_update USING btree (id)                                                                                    |
| home_update_user_id_deal_id_checklist_item_ref_due_on_key | CREATE UNIQUE INDEX home_update_user_id_deal_id_checklist_item_ref_due_on_key ON next.home_update USING btree (user_id, deal_id, checklist_item_ref, due_on) |

## Triggers

| Name          | Definition                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.home_update FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.home_update FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
