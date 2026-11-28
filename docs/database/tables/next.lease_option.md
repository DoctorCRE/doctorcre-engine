# next.lease_option

## Columns

| Name                | Type                     | Default | Nullable | Children                                    | Parents                                     | Comment |
| ------------------- | ------------------------ | ------- | -------- | ------------------------------------------- | ------------------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |                                             |                                             |         |
| changed_by_job      | text                     |         | true     |                                             | [next.job](next.job.md)                     |         |
| changed_by_user_id  | uuid                     |         | true     |                                             | [next.app_user](next.app_user.md)           |         |
| changed_for_user_id | uuid                     |         | true     |                                             | [next.app_user](next.app_user.md)           |         |
| created_at          | timestamp with time zone | now()   | false    |                                             |                                             |         |
| kind                | text                     |         | false    |                                             |                                             |         |
| lease_version_id    | uuid                     |         | false    | [next.critical_date](next.critical_date.md) | [next.lease_version](next.lease_version.md) |         |
| notice_on           | date                     |         | false    |                                             |                                             |         |
| number              | smallint                 |         | false    | [next.critical_date](next.critical_date.md) |                                             |         |
| terms               | text                     |         | false    |                                             |                                             |         |

## Viewpoints

| Name                          | Definition                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| [Leases](viewpoint-leases.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                    | Type        | Definition                                                                                                                           |
| --------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| lease_option_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| lease_option_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| lease_option_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| lease_option_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| lease_option_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| lease_option_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| lease_option_kind_check                 | CHECK       | CHECK ((kind = ANY (ARRAY['renewal'::text, 'expansion'::text, 'early_termination'::text])))                                          |
| lease_option_kind_not_null              | n           | NOT NULL kind                                                                                                                        |
| lease_option_lease_version_id_fkey      | FOREIGN KEY | FOREIGN KEY (lease_version_id) REFERENCES lease_version(id)                                                                          |
| lease_option_lease_version_id_not_null  | n           | NOT NULL lease_version_id                                                                                                            |
| lease_option_notice_on_not_null         | n           | NOT NULL notice_on                                                                                                                   |
| lease_option_number_check               | CHECK       | CHECK ((number > 0))                                                                                                                 |
| lease_option_number_not_null            | n           | NOT NULL number                                                                                                                      |
| lease_option_pkey                       | PRIMARY KEY | PRIMARY KEY (lease_version_id, number)                                                                                               |
| lease_option_terms_check                | CHECK       | CHECK ((terms ~ '\S'::text))                                                                                                         |
| lease_option_terms_not_null             | n           | NOT NULL terms                                                                                                                       |

## Indexes

| Name              | Definition                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| lease_option_pkey | CREATE UNIQUE INDEX lease_option_pkey ON next.lease_option USING btree (lease_version_id, number) |

## Triggers

| Name                           | Definition                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| lease_option_before_expiration | CREATE TRIGGER lease_option_before_expiration BEFORE INSERT ON next.lease_option FOR EACH ROW EXECUTE FUNCTION lease_option_before_expiration()              |
| record_change                  | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.lease_option FOR EACH ROW EXECUTE FUNCTION record_change('lease_version_id', 'number') |
| stamp_change                   | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.lease_option FOR EACH ROW EXECUTE FUNCTION stamp_change()                                        |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
