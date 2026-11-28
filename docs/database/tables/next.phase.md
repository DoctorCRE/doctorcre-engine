# next.phase

## Columns

| Name                | Type                     | Default | Nullable | Children                                                                                                                                                                                                                  | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |                                                                                                                                                                                                                           |                                   |         |
| changed_by_job      | text                     |         | true     |                                                                                                                                                                                                                           | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |                                                                                                                                                                                                                           | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |                                                                                                                                                                                                                           | [next.app_user](next.app_user.md) |         |
| label               | text                     |         | false    |                                                                                                                                                                                                                           |                                   |         |
| slug                | text                     |         | false    | [next.deal_phase_change](next.deal_phase_change.md) [next.imported_automatic_phase_move](next.imported_automatic_phase_move.md) [next.imported_deal_board](next.imported_deal_board.md) [next.proposal](next.proposal.md) |                                   |         |

## Viewpoints

| Name                        | Definition                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| [Deals](viewpoint-deals.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                             | Type        | Definition                                                                                                                           |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| phase_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| phase_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| phase_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| phase_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| phase_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| phase_label_not_null             | n           | NOT NULL label                                                                                                                       |
| phase_pkey                       | PRIMARY KEY | PRIMARY KEY (slug)                                                                                                                   |
| phase_slug_not_null              | n           | NOT NULL slug                                                                                                                        |

## Indexes

| Name       | Definition                                                      |
| ---------- | --------------------------------------------------------------- |
| phase_pkey | CREATE UNIQUE INDEX phase_pkey ON next.phase USING btree (slug) |

## Triggers

| Name          | Definition                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.phase FOR EACH ROW EXECUTE FUNCTION record_change('slug') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.phase FOR EACH ROW EXECUTE FUNCTION stamp_change()                  |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
