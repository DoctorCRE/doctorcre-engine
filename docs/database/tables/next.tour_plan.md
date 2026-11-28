# next.tour_plan

## Columns

| Name                    | Type                     | Default           | Nullable | Extra Definition                           | Children                            | Parents                                                                         | Comment |
| ----------------------- | ------------------------ | ----------------- | -------- | ------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------- | ------- |
| cancelled_at            | timestamp with time zone |                   | true     |                                            |                                     |                                                                                 |         |
| changed_at              | timestamp with time zone |                   | false    |                                            |                                     |                                                                                 |         |
| changed_by_job          | text                     |                   | true     |                                            |                                     | [next.job](next.job.md)                                                         |         |
| changed_by_user_id      | uuid                     |                   | true     |                                            |                                     | [next.app_user](next.app_user.md)                                               |         |
| changed_for_user_id     | uuid                     |                   | true     |                                            |                                     | [next.app_user](next.app_user.md)                                               |         |
| completed_activity_id   | uuid                     |                   | true     |                                            |                                     | [next.activity](next.activity.md) [next.activity_about](next.activity_about.md) |         |
| completed_activity_kind | text                     |                   | true     | GENERATED ALWAYS AS 'meeting'::text STORED |                                     | [next.activity](next.activity.md)                                               |         |
| created_at              | timestamp with time zone | now()             | false    |                                            |                                     |                                                                                 |         |
| deal_id                 | uuid                     |                   | false    |                                            |                                     | [next.activity_about](next.activity_about.md) [next.deal](next.deal.md)         |         |
| id                      | uuid                     | gen_random_uuid() | false    |                                            | [next.tour_stop](next.tour_stop.md) |                                                                                 |         |
| notes                   | text                     |                   | true     |                                            |                                     |                                                                                 |         |
| planned_on              | date                     |                   | false    |                                            |                                     |                                                                                 |         |
| revision                | integer                  | 1                 | false    |                                            |                                     |                                                                                 |         |

## Viewpoints

| Name                        | Definition                                             |
| --------------------------- | ------------------------------------------------------ |
| [Tours](viewpoint-tours.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                                         | Type        | Definition                                                                                                                                                                             |
| ------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tour_plan_changed_at_not_null                                | n           | NOT NULL changed_at                                                                                                                                                                    |
| tour_plan_changed_by_a_user_or_a_job                         | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                                   |
| tour_plan_changed_by_job_fkey                                | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                                      |
| tour_plan_changed_by_user_id_fkey                            | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                                               |
| tour_plan_changed_for_user_id_fkey                           | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                                              |
| tour_plan_completed_activity_id_completed_activity_kind_fkey | FOREIGN KEY | FOREIGN KEY (completed_activity_id, completed_activity_kind) REFERENCES activity(id, kind)                                                                                             |
| tour_plan_completed_activity_id_key                          | UNIQUE      | UNIQUE (completed_activity_id)                                                                                                                                                         |
| tour_plan_completed_on_deal                                  | FOREIGN KEY | FOREIGN KEY (completed_activity_id, deal_id) REFERENCES activity_about(activity_id, deal_id) DEFERRABLE INITIALLY DEFERRED                                                             |
| tour_plan_created_at_not_null                                | n           | NOT NULL created_at                                                                                                                                                                    |
| tour_plan_deal_id_fkey                                       | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                                                                              |
| tour_plan_deal_id_not_null                                   | n           | NOT NULL deal_id                                                                                                                                                                       |
| tour_plan_id_not_null                                        | n           | NOT NULL id                                                                                                                                                                            |
| tour_plan_one_outcome                                        | CHECK       | CHECK ((num_nonnulls(completed_activity_id, cancelled_at) <= 1))                                                                                                                       |
| tour_plan_pkey                                               | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                                                                       |
| tour_plan_planned_on_not_null                                | n           | NOT NULL planned_on                                                                                                                                                                    |
| tour_plan_requires_stop                                      | TRIGGER     | CREATE CONSTRAINT TRIGGER tour_plan_requires_stop AFTER INSERT OR UPDATE OF id ON next.tour_plan DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tour_plan_requires_stop() |
| tour_plan_revision_check                                     | CHECK       | CHECK ((revision >= 1))                                                                                                                                                                |
| tour_plan_revision_not_null                                  | n           | NOT NULL revision                                                                                                                                                                      |

## Indexes

| Name                                | Definition                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| tour_plan_completed_activity_id_key | CREATE UNIQUE INDEX tour_plan_completed_activity_id_key ON next.tour_plan USING btree (completed_activity_id) |
| tour_plan_deal                      | CREATE INDEX tour_plan_deal ON next.tour_plan USING btree (deal_id)                                           |
| tour_plan_pkey                      | CREATE UNIQUE INDEX tour_plan_pkey ON next.tour_plan USING btree (id)                                         |

## Triggers

| Name                    | Definition                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change           | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.tour_plan FOR EACH ROW EXECUTE FUNCTION record_change('id')                                                      |
| revise_tour_plan        | CREATE TRIGGER revise_tour_plan BEFORE INSERT OR UPDATE ON next.tour_plan FOR EACH ROW EXECUTE FUNCTION revise_tour_plan()                                                             |
| stamp_change            | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.tour_plan FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                                     |
| tour_plan_requires_stop | CREATE CONSTRAINT TRIGGER tour_plan_requires_stop AFTER INSERT OR UPDATE OF id ON next.tour_plan DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tour_plan_requires_stop() |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
