# next.lease_suite

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                                                                 | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | ----------------------------------------------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                                                         |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)                                                 |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md)                                       |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md)                                       |         |
| created_at          | timestamp with time zone | now()   | false    |          |                                                                         |         |
| lease_id            | uuid                     |         | false    |          | [next.lease](next.lease.md) [next.lease_version](next.lease_version.md) |         |
| lease_version_id    | uuid                     |         | false    |          | [next.lease_version](next.lease_version.md)                             |         |
| property_id         | uuid                     |         | false    |          | [next.lease](next.lease.md) [next.suite](next.suite.md)                 |         |
| suite_id            | uuid                     |         | false    |          | [next.suite](next.suite.md)                                             |         |

## Viewpoints

| Name                          | Definition                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| [Leases](viewpoint-leases.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                       | Type        | Definition                                                                                                                           |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| lease_suite_changed_at_not_null            | n           | NOT NULL changed_at                                                                                                                  |
| lease_suite_changed_by_a_user_or_a_job     | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| lease_suite_changed_by_job_fkey            | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| lease_suite_changed_by_user_id_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| lease_suite_changed_for_user_id_fkey       | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| lease_suite_created_at_not_null            | n           | NOT NULL created_at                                                                                                                  |
| lease_suite_lease_id_not_null              | n           | NOT NULL lease_id                                                                                                                    |
| lease_suite_lease_id_property_id_fkey      | FOREIGN KEY | FOREIGN KEY (lease_id, property_id) REFERENCES lease(id, property_id)                                                                |
| lease_suite_lease_version_id_lease_id_fkey | FOREIGN KEY | FOREIGN KEY (lease_version_id, lease_id) REFERENCES lease_version(id, lease_id)                                                      |
| lease_suite_lease_version_id_not_null      | n           | NOT NULL lease_version_id                                                                                                            |
| lease_suite_pkey                           | PRIMARY KEY | PRIMARY KEY (lease_version_id, suite_id)                                                                                             |
| lease_suite_property_id_not_null           | n           | NOT NULL property_id                                                                                                                 |
| lease_suite_suite_id_not_null              | n           | NOT NULL suite_id                                                                                                                    |
| lease_suite_suite_id_property_id_fkey      | FOREIGN KEY | FOREIGN KEY (suite_id, property_id) REFERENCES suite(id, property_id)                                                                |

## Indexes

| Name             | Definition                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| lease_suite_pkey | CREATE UNIQUE INDEX lease_suite_pkey ON next.lease_suite USING btree (lease_version_id, suite_id) |

## Triggers

| Name          | Definition                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.lease_suite FOR EACH ROW EXECUTE FUNCTION record_change('lease_version_id', 'suite_id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.lease_suite FOR EACH ROW EXECUTE FUNCTION stamp_change()                                          |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
