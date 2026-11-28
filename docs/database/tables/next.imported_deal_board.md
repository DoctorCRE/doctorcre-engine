# next.imported_deal_board

## Columns

| Name                     | Type                     | Default | Nullable | Children | Parents                                                                       | Comment |
| ------------------------ | ------------------------ | ------- | -------- | -------- | ----------------------------------------------------------------------------- | ------- |
| changed_at               | timestamp with time zone |         | false    |          |                                                                               |         |
| changed_by_job           | text                     |         | true     |          | [next.job](next.job.md)                                                       |         |
| changed_by_user_id       | uuid                     |         | true     |          | [next.app_user](next.app_user.md)                                             |         |
| changed_for_user_id      | uuid                     |         | true     |          | [next.app_user](next.app_user.md)                                             |         |
| city                     | text                     |         | true     |          |                                                                               |         |
| closed_on                | date                     |         | true     |          |                                                                               |         |
| deal_id                  | uuid                     |         | false    |          | [next.deal](next.deal.md) [next.deal_phase_change](next.deal_phase_change.md) |         |
| outcome                  | text                     |         | true     |          |                                                                               |         |
| phase                    | text                     |         | true     |          | [next.phase](next.phase.md)                                                   |         |
| phase_at                 | timestamp with time zone |         | true     |          | [next.deal_phase_change](next.deal_phase_change.md)                           |         |
| renewal_lease_unrecorded | boolean                  | false   | false    |          |                                                                               |         |

## Viewpoints

| Name                                          | Definition                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| [Imported deals](viewpoint-imported-deals.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                                  | Type        | Definition                                                                                                                           |
| ----------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| imported_deal_board_changed_at_not_null               | n           | NOT NULL changed_at                                                                                                                  |
| imported_deal_board_changed_by_a_user_or_a_job        | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| imported_deal_board_changed_by_job_fkey               | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| imported_deal_board_changed_by_user_id_fkey           | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| imported_deal_board_changed_for_user_id_fkey          | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| imported_deal_board_deal_id_fkey                      | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                            |
| imported_deal_board_deal_id_not_null                  | n           | NOT NULL deal_id                                                                                                                     |
| imported_deal_board_deal_id_phase_at_fkey             | FOREIGN KEY | FOREIGN KEY (deal_id, phase_at) REFERENCES deal_phase_change(deal_id, happened_at)                                                   |
| imported_deal_board_outcome_check                     | CHECK       | CHECK ((outcome = ANY (ARRAY['won'::text, 'lost'::text])))                                                                           |
| imported_deal_board_phase_fkey                        | FOREIGN KEY | FOREIGN KEY (phase) REFERENCES phase(slug)                                                                                           |
| imported_deal_board_pkey                              | PRIMARY KEY | PRIMARY KEY (deal_id)                                                                                                                |
| imported_deal_board_renewal_lease_unrecorded_not_null | n           | NOT NULL renewal_lease_unrecorded                                                                                                    |

## Indexes

| Name                     | Definition                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| imported_deal_board_pkey | CREATE UNIQUE INDEX imported_deal_board_pkey ON next.imported_deal_board USING btree (deal_id) |

## Triggers

| Name                | Definition                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| record_change       | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.imported_deal_board FOR EACH ROW EXECUTE FUNCTION record_change('deal_id') |
| stamp_change        | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.imported_deal_board FOR EACH ROW EXECUTE FUNCTION stamp_change()                     |
| sync_deal_open_name | CREATE TRIGGER sync_deal_open_name AFTER INSERT ON next.imported_deal_board FOR EACH ROW EXECUTE FUNCTION sync_deal_open_name('deal_id')         |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
