# next.commission_payment

## Columns

| Name                | Type                     | Default           | Nullable | Children                                    | Parents                               | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | ------------------------------------------- | ------------------------------------- | ------- |
| amount              | numeric(14,2)            |                   | false    |                                             |                                       |         |
| changed_at          | timestamp with time zone |                   | false    |                                             |                                       |         |
| changed_by_job      | text                     |                   | true     |                                             | [next.job](next.job.md)               |         |
| changed_by_user_id  | uuid                     |                   | true     |                                             | [next.app_user](next.app_user.md)     |         |
| changed_for_user_id | uuid                     |                   | true     |                                             | [next.app_user](next.app_user.md)     |         |
| created_at          | timestamp with time zone | now()             | false    |                                             |                                       |         |
| deal_id             | uuid                     |                   | false    | [next.invoice_email](next.invoice_email.md) | [next.commission](next.commission.md) |         |
| due_on              | date                     |                   | true     |                                             |                                       |         |
| id                  | uuid                     | gen_random_uuid() | false    | [next.invoice_email](next.invoice_email.md) |                                       |         |
| invoiced_on         | date                     |                   | true     |                                             |                                       |         |
| received_on         | date                     |                   | true     |                                             |                                       |         |

## Viewpoints

| Name                                    | Definition                                             |
| --------------------------------------- | ------------------------------------------------------ |
| [Commissions](viewpoint-commissions.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                          | Type        | Definition                                                                                                                                                                      |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| commission_adds_up                            | TRIGGER     | CREATE CONSTRAINT TRIGGER commission_adds_up AFTER INSERT OR UPDATE ON next.commission_payment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commission_adds_up() |
| commission_payment_amount_check               | CHECK       | CHECK ((amount > (0)::numeric))                                                                                                                                                 |
| commission_payment_amount_not_null            | n           | NOT NULL amount                                                                                                                                                                 |
| commission_payment_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                                                             |
| commission_payment_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                            |
| commission_payment_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                               |
| commission_payment_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                                        |
| commission_payment_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                                       |
| commission_payment_created_at_not_null        | n           | NOT NULL created_at                                                                                                                                                             |
| commission_payment_dates_in_order             | CHECK       | CHECK (((due_on >= invoiced_on) AND (received_on >= invoiced_on)))                                                                                                              |
| commission_payment_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES commission(deal_id)                                                                                                                            |
| commission_payment_deal_id_not_null           | n           | NOT NULL deal_id                                                                                                                                                                |
| commission_payment_id_deal_id_key             | UNIQUE      | UNIQUE (id, deal_id)                                                                                                                                                            |
| commission_payment_id_not_null                | n           | NOT NULL id                                                                                                                                                                     |
| commission_payment_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                                                                |
| commission_payment_received_after_invoice     | CHECK       | CHECK (((received_on IS NULL) OR (invoiced_on IS NOT NULL)))                                                                                                                    |

## Indexes

| Name                              | Definition                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| commission_payment_id_deal_id_key | CREATE UNIQUE INDEX commission_payment_id_deal_id_key ON next.commission_payment USING btree (id, deal_id) |
| commission_payment_pkey           | CREATE UNIQUE INDEX commission_payment_pkey ON next.commission_payment USING btree (id)                    |

## Triggers

| Name                                   | Definition                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| commission_adds_up                     | CREATE CONSTRAINT TRIGGER commission_adds_up AFTER INSERT OR UPDATE ON next.commission_payment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commission_adds_up()                                                    |
| record_change                          | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.commission_payment FOR EACH ROW EXECUTE FUNCTION record_change('id')                                                                                         |
| stamp_change                           | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.commission_payment FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                                                                        |
| sync_deal_open_name_on_invoice         | CREATE TRIGGER sync_deal_open_name_on_invoice AFTER INSERT ON next.commission_payment FOR EACH ROW WHEN ((new.invoiced_on IS NOT NULL)) EXECUTE FUNCTION sync_deal_open_name('deal_id')                                            |
| sync_deal_open_name_on_invoice_change  | CREATE TRIGGER sync_deal_open_name_on_invoice_change AFTER UPDATE OF invoiced_on ON next.commission_payment FOR EACH ROW WHEN ((old.invoiced_on IS DISTINCT FROM new.invoiced_on)) EXECUTE FUNCTION sync_deal_open_name('deal_id') |
| sync_deal_open_name_on_invoice_removal | CREATE TRIGGER sync_deal_open_name_on_invoice_removal AFTER DELETE ON next.commission_payment FOR EACH ROW WHEN ((old.invoiced_on IS NOT NULL)) EXECUTE FUNCTION sync_deal_open_name('deal_id')                                    |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
