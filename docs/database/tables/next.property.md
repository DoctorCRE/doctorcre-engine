# next.property

## Columns

| Name                | Type                     | Default           | Nullable | Children                                                                                                                                                                                                                                                                                                                                                  | Parents                           | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| address             | text                     |                   | false    |                                                                                                                                                                                                                                                                                                                                                           |                                   |         |
| building_class      | text                     |                   | true     |                                                                                                                                                                                                                                                                                                                                                           |                                   |         |
| building_type       | text                     |                   | true     |                                                                                                                                                                                                                                                                                                                                                           |                                   |         |
| changed_at          | timestamp with time zone |                   | false    |                                                                                                                                                                                                                                                                                                                                                           |                                   |         |
| changed_by_job      | text                     |                   | true     |                                                                                                                                                                                                                                                                                                                                                           | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |                   | true     |                                                                                                                                                                                                                                                                                                                                                           | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |                   | true     |                                                                                                                                                                                                                                                                                                                                                           | [next.app_user](next.app_user.md) |         |
| county_fips         | county_fips              |                   | true     |                                                                                                                                                                                                                                                                                                                                                           |                                   |         |
| created_at          | timestamp with time zone | now()             | false    |                                                                                                                                                                                                                                                                                                                                                           |                                   |         |
| id                  | uuid                     | gen_random_uuid() | false    | [next.activity_about](next.activity_about.md) [next.building_ownership](next.building_ownership.md) [next.deal_property](next.deal_property.md) [next.home_update](next.home_update.md) [next.lease](next.lease.md) [next.next_step](next.next_step.md) [next.proposal](next.proposal.md) [next.suite](next.suite.md) [next.tour_stop](next.tour_stop.md) |                                   |         |
| latitude            | latitude                 |                   | true     |                                                                                                                                                                                                                                                                                                                                                           |                                   |         |
| longitude           | longitude                |                   | true     |                                                                                                                                                                                                                                                                                                                                                           |                                   |         |
| name                | text                     |                   | true     |                                                                                                                                                                                                                                                                                                                                                           |                                   |         |
| stories             | integer                  |                   | true     |                                                                                                                                                                                                                                                                                                                                                           |                                   |         |
| year_built          | integer                  |                   | true     |                                                                                                                                                                                                                                                                                                                                                           |                                   |         |

## Viewpoints

| Name                              | Definition                                                                  |
| --------------------------------- | --------------------------------------------------------------------------- |
| [Property](viewpoint-property.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                | Type        | Definition                                                                                                                           |
| ----------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| property_address_not_null           | n           | NOT NULL address                                                                                                                     |
| property_building_class_check       | CHECK       | CHECK ((building_class ~ '\S'::text))                                                                                                |
| property_building_type_check        | CHECK       | CHECK ((building_type ~ '\S'::text))                                                                                                 |
| property_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| property_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| property_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| property_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| property_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| property_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| property_id_not_null                | n           | NOT NULL id                                                                                                                          |
| property_name_check                 | CHECK       | CHECK ((name ~ '\S'::text))                                                                                                          |
| property_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| property_point_whole                | CHECK       | CHECK ((num_nonnulls(latitude, longitude) <> 1))                                                                                     |
| property_stories_check              | CHECK       | CHECK (((stories >= 1) AND (stories <= 60)))                                                                                         |
| property_year_built_check           | CHECK       | CHECK (((year_built >= 1800) AND (year_built <= 2100)))                                                                              |

## Indexes

| Name          | Definition                                                          |
| ------------- | ------------------------------------------------------------------- |
| property_pkey | CREATE UNIQUE INDEX property_pkey ON next.property USING btree (id) |

## Triggers

| Name          | Definition                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.property FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.property FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
