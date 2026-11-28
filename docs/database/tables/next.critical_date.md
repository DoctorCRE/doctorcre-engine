# next.critical_date

## Columns

| Name                 | Type                     | Default           | Nullable | Children | Parents                                                                               | Comment |
| -------------------- | ------------------------ | ----------------- | -------- | -------- | ------------------------------------------------------------------------------------- | ------- |
| changed_at           | timestamp with time zone |                   | false    |          |                                                                                       |         |
| changed_by_job       | text                     |                   | true     |          | [next.job](next.job.md)                                                               |         |
| changed_by_user_id   | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)                                                     |         |
| changed_for_user_id  | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)                                                     |         |
| confirmed_at         | timestamp with time zone |                   | true     |          |                                                                                       |         |
| confirmed_by_user_id | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)                                                     |         |
| created_at           | timestamp with time zone | now()             | false    |          |                                                                                       |         |
| deal_id              | uuid                     |                   | false    |          | [next.deal](next.deal.md) [next.offer](next.offer.md)                                 |         |
| document_id          | uuid                     |                   | true     |          | [next.document](next.document.md)                                                     |         |
| due_on               | date                     |                   | false    |          |                                                                                       |         |
| id                   | uuid                     | gen_random_uuid() | false    |          |                                                                                       |         |
| kind                 | text                     |                   | false    |          |                                                                                       |         |
| lease_version_id     | uuid                     |                   | true     |          | [next.lease_option](next.lease_option.md) [next.lease_version](next.lease_version.md) |         |
| note                 | text                     |                   | true     |          |                                                                                       |         |
| offer_id             | uuid                     |                   | true     |          | [next.offer](next.offer.md)                                                           |         |
| option_number        | smallint                 |                   | true     |          | [next.lease_option](next.lease_option.md)                                             |         |
| resolution_reason    | text                     |                   | true     |          |                                                                                       |         |
| resolved_at          | timestamp with time zone |                   | true     |          |                                                                                       |         |
| resolved_by_user_id  | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)                                                     |         |
| source               | text                     |                   | false    |          |                                                                                       |         |
| status               | text                     | 'proposed'::text  | false    |          |                                                                                       |         |

## Viewpoints

| Name                          | Definition                                             |
| ----------------------------- | ------------------------------------------------------ |
| [Leases](viewpoint-leases.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                              | Type        | Definition                                                                                                                                                                                                     |
| ------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| critical_date_changed_at_not_null                 | n           | NOT NULL changed_at                                                                                                                                                                                            |
| critical_date_changed_by_a_user_or_a_job          | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                                                           |
| critical_date_changed_by_job_fkey                 | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                                                              |
| critical_date_changed_by_user_id_fkey             | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                                                                       |
| critical_date_changed_for_user_id_fkey            | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                                                                      |
| critical_date_confirmation_whole                  | CHECK       | CHECK ((num_nonnulls(confirmed_by_user_id, confirmed_at) = ANY (ARRAY[0, 2])))                                                                                                                                 |
| critical_date_confirmed_by_user_id_fkey           | FOREIGN KEY | FOREIGN KEY (confirmed_by_user_id) REFERENCES app_user(id)                                                                                                                                                     |
| critical_date_confirmed_when_real                 | CHECK       | CHECK (((status <> ALL (ARRAY['open'::text, 'done'::text, 'passed'::text])) OR (confirmed_at IS NOT NULL)))                                                                                                    |
| critical_date_created_at_not_null                 | n           | NOT NULL created_at                                                                                                                                                                                            |
| critical_date_deal_id_fkey                        | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                                                                                                      |
| critical_date_deal_id_not_null                    | n           | NOT NULL deal_id                                                                                                                                                                                               |
| critical_date_document_id_fkey                    | FOREIGN KEY | FOREIGN KEY (document_id) REFERENCES document(id)                                                                                                                                                              |
| critical_date_due_on_not_null                     | n           | NOT NULL due_on                                                                                                                                                                                                |
| critical_date_id_not_null                         | n           | NOT NULL id                                                                                                                                                                                                    |
| critical_date_kind_check                          | CHECK       | CHECK ((kind = ANY (ARRAY['loi_expiry'::text, 'option_notice'::text, 'lease_commencement'::text, 'rent_start'::text, 'lease_end'::text, 'due_diligence'::text, 'phase_effective_date'::text, 'other'::text]))) |
| critical_date_kind_not_null                       | n           | NOT NULL kind                                                                                                                                                                                                  |
| critical_date_lease_version_id_fkey               | FOREIGN KEY | FOREIGN KEY (lease_version_id) REFERENCES lease_version(id)                                                                                                                                                    |
| critical_date_lease_version_id_option_number_fkey | FOREIGN KEY | FOREIGN KEY (lease_version_id, option_number) REFERENCES lease_option(lease_version_id, number)                                                                                                                |
| critical_date_offer_id_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (offer_id, deal_id) REFERENCES offer(id, deal_id)                                                                                                                                                  |
| critical_date_one_source                          | CHECK       | CHECK ((num_nonnulls(offer_id, lease_version_id, document_id) <= 1))                                                                                                                                           |
| critical_date_option_on_lease                     | CHECK       | CHECK (((option_number IS NULL) OR (lease_version_id IS NOT NULL)))                                                                                                                                            |
| critical_date_pkey                                | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                                                                                               |
| critical_date_resolution_reason_check             | CHECK       | CHECK ((resolution_reason ~ '\S'::text))                                                                                                                                                                       |
| critical_date_resolution_whole                    | CHECK       | CHECK ((num_nonnulls(resolved_by_user_id, resolved_at, resolution_reason) =<br />CASE<br />    WHEN (status = ANY (ARRAY['done'::text, 'dropped'::text, 'passed'::text])) THEN 3<br />    ELSE 0<br />END))    |
| critical_date_resolved_by_user_id_fkey            | FOREIGN KEY | FOREIGN KEY (resolved_by_user_id) REFERENCES app_user(id)                                                                                                                                                      |
| critical_date_source_check                        | CHECK       | CHECK ((source ~ '\S'::text))                                                                                                                                                                                  |
| critical_date_source_not_null                     | n           | NOT NULL source                                                                                                                                                                                                |
| critical_date_status_check                        | CHECK       | CHECK ((status = ANY (ARRAY['proposed'::text, 'open'::text, 'done'::text, 'dropped'::text, 'passed'::text])))                                                                                                  |
| critical_date_status_not_null                     | n           | NOT NULL status                                                                                                                                                                                                |

## Indexes

| Name                         | Definition                                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| critical_date_generated_once | CREATE UNIQUE INDEX critical_date_generated_once ON next.critical_date USING btree (deal_id, kind, offer_id, lease_version_id, option_number) NULLS NOT DISTINCT WHERE ((offer_id IS NOT NULL) OR (lease_version_id IS NOT NULL)) |
| critical_date_pkey           | CREATE UNIQUE INDEX critical_date_pkey ON next.critical_date USING btree (id)                                                                                                                                                     |

## Triggers

| Name                     | Definition                                                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| critical_date_transition | CREATE TRIGGER critical_date_transition BEFORE INSERT OR UPDATE ON next.critical_date FOR EACH ROW EXECUTE FUNCTION critical_date_transition() |
| record_change            | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.critical_date FOR EACH ROW EXECUTE FUNCTION record_change('id')          |
| stamp_change             | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.critical_date FOR EACH ROW EXECUTE FUNCTION stamp_change()                         |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
