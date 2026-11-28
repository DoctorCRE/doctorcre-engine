# next.tour_stop

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                             | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | ----------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                     |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)             |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md)   |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md)   |         |
| created_at          | timestamp with time zone | now()   | false    |          |                                     |         |
| position            | integer                  |         | false    |          |                                     |         |
| property_id         | uuid                     |         | false    |          | [next.property](next.property.md)   |         |
| tour_plan_id        | uuid                     |         | false    |          | [next.tour_plan](next.tour_plan.md) |         |

## Viewpoints

| Name                        | Definition                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| [Tours](viewpoint-tours.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                 | Type        | Definition                                                                                                                                                                                       |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tour_plan_requires_stop              | TRIGGER     | CREATE CONSTRAINT TRIGGER tour_plan_requires_stop AFTER DELETE OR UPDATE OF tour_plan_id ON next.tour_stop DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tour_plan_requires_stop() |
| tour_stop_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                                                                              |
| tour_stop_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                                             |
| tour_stop_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                                                |
| tour_stop_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                                                         |
| tour_stop_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                                                        |
| tour_stop_created_at_not_null        | n           | NOT NULL created_at                                                                                                                                                                              |
| tour_stop_pkey                       | PRIMARY KEY | PRIMARY KEY (tour_plan_id, "position")                                                                                                                                                           |
| tour_stop_position_check             | CHECK       | CHECK (("position" > 0))                                                                                                                                                                         |
| tour_stop_position_not_null          | n           | NOT NULL "position"                                                                                                                                                                              |
| tour_stop_property_id_fkey           | FOREIGN KEY | FOREIGN KEY (property_id) REFERENCES property(id)                                                                                                                                                |
| tour_stop_property_id_not_null       | n           | NOT NULL property_id                                                                                                                                                                             |
| tour_stop_tour_plan_id_fkey          | FOREIGN KEY | FOREIGN KEY (tour_plan_id) REFERENCES tour_plan(id)                                                                                                                                              |
| tour_stop_tour_plan_id_not_null      | n           | NOT NULL tour_plan_id                                                                                                                                                                            |

## Indexes

| Name           | Definition                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------- |
| tour_stop_pkey | CREATE UNIQUE INDEX tour_stop_pkey ON next.tour_stop USING btree (tour_plan_id, "position") |

## Triggers

| Name                    | Definition                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| record_change           | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.tour_stop FOR EACH ROW EXECUTE FUNCTION record_change('tour_plan_id', 'position')                                          |
| stamp_change            | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.tour_stop FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                                               |
| tour_plan_requires_stop | CREATE CONSTRAINT TRIGGER tour_plan_requires_stop AFTER DELETE OR UPDATE OF tour_plan_id ON next.tour_stop DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tour_plan_requires_stop() |
| tour_stop_on_open_plan  | CREATE TRIGGER tour_stop_on_open_plan BEFORE INSERT OR DELETE OR UPDATE ON next.tour_stop FOR EACH ROW EXECUTE FUNCTION tour_stop_on_open_plan()                                                 |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
