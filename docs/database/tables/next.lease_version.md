# next.lease_version

## Columns

| Name                     | Type                     | Default           | Nullable | Extra Definition                                    | Children                                                                                                                      | Parents                                                                 | Comment |
| ------------------------ | ------------------------ | ----------------- | -------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------- |
| changed_at               | timestamp with time zone |                   | false    |                                                     |                                                                                                                               |                                                                         |         |
| changed_by_job           | text                     |                   | true     |                                                     |                                                                                                                               | [next.job](next.job.md)                                                 |         |
| changed_by_user_id       | uuid                     |                   | true     |                                                     |                                                                                                                               | [next.app_user](next.app_user.md)                                       |         |
| changed_for_user_id      | uuid                     |                   | true     |                                                     |                                                                                                                               | [next.app_user](next.app_user.md)                                       |         |
| commencement_on          | date                     |                   | true     |                                                     |                                                                                                                               |                                                                         |         |
| created_at               | timestamp with time zone | now()             | false    |                                                     |                                                                                                                               |                                                                         |         |
| document_id              | uuid                     |                   | false    |                                                     |                                                                                                                               | [next.document](next.document.md)                                       |         |
| escalation_pct           | numeric(5,2)             |                   | true     |                                                     |                                                                                                                               |                                                                         |         |
| executed_on              | date                     |                   | true     |                                                     |                                                                                                                               |                                                                         |         |
| expense_structure        | text                     |                   | true     |                                                     |                                                                                                                               |                                                                         |         |
| expiration_on            | date                     |                   | false    |                                                     |                                                                                                                               |                                                                         |         |
| free_rent_months         | numeric(4,1)             |                   | true     |                                                     |                                                                                                                               |                                                                         |         |
| id                       | uuid                     | gen_random_uuid() | false    |                                                     | [next.critical_date](next.critical_date.md) [next.lease_option](next.lease_option.md) [next.lease_suite](next.lease_suite.md) |                                                                         |         |
| lease_id                 | uuid                     |                   | false    |                                                     | [next.lease_suite](next.lease_suite.md) [next.lease_version](next.lease_version.md)                                           | [next.lease](next.lease.md) [next.lease_version](next.lease_version.md) |         |
| nnn_per_sf_yr            | numeric(10,2)            |                   | true     |                                                     |                                                                                                                               |                                                                         |         |
| offer_id                 | uuid                     |                   | true     |                                                     |                                                                                                                               | [next.offer](next.offer.md)                                             |         |
| other_terms              | text                     |                   | true     |                                                     |                                                                                                                               |                                                                         |         |
| previous_version         | integer                  |                   | true     | GENERATED ALWAYS AS NULLIF((version - 1), 0) STORED |                                                                                                                               | [next.lease_version](next.lease_version.md)                             |         |
| rent_days_after_delivery | integer                  |                   | true     |                                                     |                                                                                                                               |                                                                         |         |
| rent_per_sf_yr           | numeric(10,2)            |                   | true     |                                                     |                                                                                                                               |                                                                         |         |
| rent_starts_on           | date                     |                   | true     |                                                     |                                                                                                                               |                                                                         |         |
| term_months              | integer                  |                   | true     |                                                     |                                                                                                                               |                                                                         |         |
| ti_per_sf                | numeric(10,2)            |                   | true     |                                                     |                                                                                                                               |                                                                         |         |
| version                  | integer                  |                   | false    |                                                     | [next.lease_version](next.lease_version.md)                                                                                   |                                                                         |         |

## Viewpoints

| Name                          | Definition                                             |
| ----------------------------- | ------------------------------------------------------ |
| [Leases](viewpoint-leases.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                         | Type        | Definition                                                                                                                           |
| -------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| lease_dates_in_order                         | CHECK       | CHECK (((expiration_on > commencement_on) AND (expiration_on >= executed_on)))                                                       |
| lease_rent_date_or_days                      | CHECK       | CHECK ((num_nonnulls(rent_starts_on, rent_days_after_delivery) <= 1))                                                                |
| lease_version_changed_at_not_null            | n           | NOT NULL changed_at                                                                                                                  |
| lease_version_changed_by_a_user_or_a_job     | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| lease_version_changed_by_job_fkey            | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| lease_version_changed_by_user_id_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| lease_version_changed_for_user_id_fkey       | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| lease_version_created_at_not_null            | n           | NOT NULL created_at                                                                                                                  |
| lease_version_document_id_fkey               | FOREIGN KEY | FOREIGN KEY (document_id) REFERENCES document(id)                                                                                    |
| lease_version_document_id_not_null           | n           | NOT NULL document_id                                                                                                                 |
| lease_version_escalation_pct_check           | CHECK       | CHECK ((escalation_pct >= (0)::numeric))                                                                                             |
| lease_version_expense_structure_check        | CHECK       | CHECK ((expense_structure ~ '\S'::text))                                                                                             |
| lease_version_expiration_on_not_null         | n           | NOT NULL expiration_on                                                                                                               |
| lease_version_free_rent_months_check         | CHECK       | CHECK ((free_rent_months >= (0)::numeric))                                                                                           |
| lease_version_id_lease_id_key                | UNIQUE      | UNIQUE (id, lease_id)                                                                                                                |
| lease_version_id_not_null                    | n           | NOT NULL id                                                                                                                          |
| lease_version_lease_id_fkey                  | FOREIGN KEY | FOREIGN KEY (lease_id) REFERENCES lease(id)                                                                                          |
| lease_version_lease_id_not_null              | n           | NOT NULL lease_id                                                                                                                    |
| lease_version_lease_id_previous_version_fkey | FOREIGN KEY | FOREIGN KEY (lease_id, previous_version) REFERENCES lease_version(lease_id, version)                                                 |
| lease_version_lease_id_version_key           | UNIQUE      | UNIQUE (lease_id, version)                                                                                                           |
| lease_version_nnn_per_sf_yr_check            | CHECK       | CHECK ((nnn_per_sf_yr >= (0)::numeric))                                                                                              |
| lease_version_offer_id_fkey                  | FOREIGN KEY | FOREIGN KEY (offer_id) REFERENCES offer(id)                                                                                          |
| lease_version_pkey                           | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| lease_version_rent_days_after_delivery_check | CHECK       | CHECK ((rent_days_after_delivery >= 0))                                                                                              |
| lease_version_rent_per_sf_yr_check           | CHECK       | CHECK ((rent_per_sf_yr >= (0)::numeric))                                                                                             |
| lease_version_term_months_check              | CHECK       | CHECK ((term_months > 0))                                                                                                            |
| lease_version_ti_per_sf_check                | CHECK       | CHECK ((ti_per_sf >= (0)::numeric))                                                                                                  |
| lease_version_version_check                  | CHECK       | CHECK ((version >= 1))                                                                                                               |
| lease_version_version_not_null               | n           | NOT NULL version                                                                                                                     |

## Indexes

| Name                               | Definition                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| lease_version_id_lease_id_key      | CREATE UNIQUE INDEX lease_version_id_lease_id_key ON next.lease_version USING btree (id, lease_id)           |
| lease_version_lease_id_version_key | CREATE UNIQUE INDEX lease_version_lease_id_version_key ON next.lease_version USING btree (lease_id, version) |
| lease_version_pkey                 | CREATE UNIQUE INDEX lease_version_pkey ON next.lease_version USING btree (id)                                |

## Triggers

| Name                      | Definition                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| lease_from_accepted_offer | CREATE TRIGGER lease_from_accepted_offer BEFORE INSERT ON next.lease_version FOR EACH ROW WHEN ((new.offer_id IS NOT NULL)) EXECUTE FUNCTION lease_from_accepted_offer() |
| record_change             | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.lease_version FOR EACH ROW EXECUTE FUNCTION record_change('id')                                    |
| stamp_change              | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.lease_version FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                   |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
