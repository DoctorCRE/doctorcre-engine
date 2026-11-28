# next.change

## Columns

| Name                | Type                     | Default | Nullable | Children                                    | Parents                                   | Comment |
| ------------------- | ------------------------ | ------- | -------- | ------------------------------------------- | ----------------------------------------- | ------- |
| action              | text                     |         | false    |                                             |                                           |         |
| changed_at          | timestamp with time zone |         | false    |                                             |                                           |         |
| changed_by_job      | text                     |         | true     |                                             | [next.job](next.job.md)                   |         |
| changed_by_user_id  | uuid                     |         | true     |                                             | [next.app_user](next.app_user.md)         |         |
| changed_for_user_id | uuid                     |         | true     |                                             | [next.app_user](next.app_user.md)         |         |
| id                  | bigint                   |         | false    | [next.invoice_email](next.invoice_email.md) |                                           |         |
| merge_of            | uuid                     |         | true     |                                             | [next.merged_party](next.merged_party.md) |         |
| new_value           | jsonb                    |         | true     |                                             |                                           |         |
| old_value           | jsonb                    |         | true     |                                             |                                           |         |
| record              | jsonb                    |         | false    |                                             |                                           |         |
| table_name          | text                     |         | false    |                                             |                                           |         |

## Viewpoints

| Name                                                        | Definition                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Changes and preferences](viewpoint-changes-preferences.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                              | Type        | Definition                                                                                                                           |
| --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| change_action_check               | CHECK       | CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text, 'erase'::text])))                                        |
| change_action_not_null            | n           | NOT NULL action                                                                                                                      |
| change_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| change_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| change_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| change_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id) DEFERRABLE INITIALLY DEFERRED                                               |
| change_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| change_id_not_null                | n           | NOT NULL id                                                                                                                          |
| change_merge_of_fkey              | FOREIGN KEY | FOREIGN KEY (merge_of) REFERENCES merged_party(id)                                                                                   |
| change_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| change_record_not_null            | n           | NOT NULL record                                                                                                                      |
| change_table_name_not_null        | n           | NOT NULL table_name                                                                                                                  |

## Indexes

| Name                        | Definition                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| change_deal_party           | CREATE INDEX change_deal_party ON next.change USING btree ((((record ->> 'deal_id'::text))::uuid)) WHERE (table_name = 'deal_party'::text)                                    |
| change_payment_invoice_date | CREATE INDEX change_payment_invoice_date ON next.change USING btree (record, id DESC) WHERE ((table_name = 'commission_payment'::text) AND (new_value ? 'invoiced_on'::text)) |
| change_pkey                 | CREATE UNIQUE INDEX change_pkey ON next.change USING btree (id)                                                                                                               |
| change_record               | CREATE INDEX change_record ON next.change USING btree (table_name, record)                                                                                                    |

## Triggers

| Name         | Definition                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| stamp_change | CREATE TRIGGER stamp_change BEFORE INSERT ON next.change FOR EACH ROW EXECUTE FUNCTION stamp_change() |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
