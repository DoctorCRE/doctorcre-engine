# next.suite

## Columns

| Name                | Type                     | Default           | Nullable | Children                                | Parents                           | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | --------------------------------------- | --------------------------------- | ------- |
| area_basis          | text                     |                   | true     |                                         |                                   |         |
| area_sf             | numeric(10,1)            |                   | true     |                                         |                                   |         |
| changed_at          | timestamp with time zone |                   | false    |                                         |                                   |         |
| changed_by_job      | text                     |                   | true     |                                         | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |                   | true     |                                         | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |                   | true     |                                         | [next.app_user](next.app_user.md) |         |
| condition           | text                     |                   | true     |                                         |                                   |         |
| created_at          | timestamp with time zone | now()             | false    |                                         |                                   |         |
| floor               | integer                  |                   | true     |                                         |                                   |         |
| id                  | uuid                     | gen_random_uuid() | false    | [next.lease_suite](next.lease_suite.md) |                                   |         |
| label               | text                     |                   | true     |                                         |                                   |         |
| property_id         | uuid                     |                   | false    | [next.lease_suite](next.lease_suite.md) | [next.property](next.property.md) |         |

## Viewpoints

| Name                              | Definition                                             |
| --------------------------------- | ------------------------------------------------------ |
| [Property](viewpoint-property.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                             | Type        | Definition                                                                                                                           |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| suite_area_basis_check           | CHECK       | CHECK ((area_basis = ANY (ARRAY['rentable'::text, 'usable'::text, 'county_heated'::text, 'listed_unverified'::text])))               |
| suite_area_sf_check              | CHECK       | CHECK (((area_sf > (0)::numeric) AND (area_sf <> 'NaN'::numeric)))                                                                   |
| suite_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| suite_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| suite_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| suite_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| suite_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| suite_condition_check            | CHECK       | CHECK ((condition ~ '\S'::text))                                                                                                     |
| suite_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| suite_id_not_null                | n           | NOT NULL id                                                                                                                          |
| suite_id_property_id_key         | UNIQUE      | UNIQUE (id, property_id)                                                                                                             |
| suite_label_check                | CHECK       | CHECK (((label = btrim(label)) AND (label ~ '\S'::text)))                                                                            |
| suite_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| suite_property_id_fkey           | FOREIGN KEY | FOREIGN KEY (property_id) REFERENCES property(id)                                                                                    |
| suite_property_id_label_key      | UNIQUE      | UNIQUE (property_id, label)                                                                                                          |
| suite_property_id_not_null       | n           | NOT NULL property_id                                                                                                                 |

## Indexes

| Name                        | Definition                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| suite_id_property_id_key    | CREATE UNIQUE INDEX suite_id_property_id_key ON next.suite USING btree (id, property_id)       |
| suite_pkey                  | CREATE UNIQUE INDEX suite_pkey ON next.suite USING btree (id)                                  |
| suite_property_id_label_key | CREATE UNIQUE INDEX suite_property_id_label_key ON next.suite USING btree (property_id, label) |

## Triggers

| Name          | Definition                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.suite FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.suite FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
