# next.deal_plan_date

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| deal_id             | uuid                     |         | false    |          | [next.deal](next.deal.md)         |         |
| target_on           | date                     |         | true     |          |                                   |         |
| todo                | text                     |         | false    |          |                                   |         |

## Viewpoints

| Name                        | Definition                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| [Deals](viewpoint-deals.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                      | Type        | Definition                                                                                                                                                                                   |
| ----------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deal_plan_date_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                                                                          |
| deal_plan_date_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                                         |
| deal_plan_date_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                                            |
| deal_plan_date_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                                                     |
| deal_plan_date_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                                                    |
| deal_plan_date_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                                                                                    |
| deal_plan_date_deal_id_not_null           | n           | NOT NULL deal_id                                                                                                                                                                             |
| deal_plan_date_pkey                       | PRIMARY KEY | PRIMARY KEY (deal_id, todo)                                                                                                                                                                  |
| deal_plan_date_target_on_check            | CHECK       | CHECK (((target_on >= '0001-01-01'::date) AND (target_on <= '9998-12-31'::date)))                                                                                                            |
| deal_plan_date_todo_not_null              | n           | NOT NULL todo                                                                                                                                                                                |
| deal_plan_date_workflow_todo              | TRIGGER     | CREATE CONSTRAINT TRIGGER deal_plan_date_workflow_todo AFTER INSERT OR UPDATE ON next.deal_plan_date NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION check_deal_plan_todo() |

## Indexes

| Name                | Definition                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------ |
| deal_plan_date_pkey | CREATE UNIQUE INDEX deal_plan_date_pkey ON next.deal_plan_date USING btree (deal_id, todo) |

## Triggers

| Name                         | Definition                                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deal_plan_date_workflow_todo | CREATE CONSTRAINT TRIGGER deal_plan_date_workflow_todo AFTER INSERT OR UPDATE ON next.deal_plan_date NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION check_deal_plan_todo() |
| record_change                | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.deal_plan_date FOR EACH ROW EXECUTE FUNCTION record_change('deal_id', 'todo')                                          |
| stamp_change                 | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.deal_plan_date FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                                      |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
