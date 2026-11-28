# next.commission

## Columns

| Name                | Type                     | Default | Nullable | Children                                                                                                | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |                                                                                                         |                                   |         |
| changed_by_job      | text                     |         | true     |                                                                                                         | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |                                                                                                         | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |                                                                                                         | [next.app_user](next.app_user.md) |         |
| closing_share       | numeric(6,5)             |         | true     |                                                                                                         |                                   |         |
| created_at          | timestamp with time zone | now()   | false    |                                                                                                         |                                   |         |
| deal_id             | uuid                     |         | false    | [next.commission_payment](next.commission_payment.md) [next.commission_share](next.commission_share.md) | [next.deal](next.deal.md)         |         |
| expected            | numeric(14,2)            |         | true     |                                                                                                         |                                   |         |
| gross               | numeric(14,2)            |         | true     |                                                                                                         |                                   |         |

## Viewpoints

| Name                                    | Definition                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------- |
| [Commissions](viewpoint-commissions.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                  | Type        | Definition                                                                                                                                                                                 |
| ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| commission_adds_up                    | TRIGGER     | CREATE CONSTRAINT TRIGGER commission_adds_up AFTER UPDATE OF gross ON next.commission DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commission_adds_up()                     |
| commission_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                                                                        |
| commission_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                                       |
| commission_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                                          |
| commission_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                                                   |
| commission_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                                                  |
| commission_closing_share_check        | CHECK       | CHECK (((closing_share >= (0)::numeric) AND (closing_share <= (1)::numeric)))                                                                                                              |
| commission_created_at_not_null        | n           | NOT NULL created_at                                                                                                                                                                        |
| commission_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                                                                                  |
| commission_deal_id_not_null           | n           | NOT NULL deal_id                                                                                                                                                                           |
| commission_expected_check             | CHECK       | CHECK ((expected > (0)::numeric))                                                                                                                                                          |
| commission_gross_check                | CHECK       | CHECK ((gross > (0)::numeric))                                                                                                                                                             |
| commission_ladder_holds               | TRIGGER     | CREATE CONSTRAINT TRIGGER commission_ladder_holds AFTER INSERT OR UPDATE OF gross ON next.commission DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commission_ladder_holds() |
| commission_pkey                       | PRIMARY KEY | PRIMARY KEY (deal_id)                                                                                                                                                                      |

## Indexes

| Name            | Definition                                                                   |
| --------------- | ---------------------------------------------------------------------------- |
| commission_pkey | CREATE UNIQUE INDEX commission_pkey ON next.commission USING btree (deal_id) |

## Triggers

| Name                    | Definition                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| commission_adds_up      | CREATE CONSTRAINT TRIGGER commission_adds_up AFTER UPDATE OF gross ON next.commission DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commission_adds_up()                     |
| commission_ladder_holds | CREATE CONSTRAINT TRIGGER commission_ladder_holds AFTER INSERT OR UPDATE OF gross ON next.commission DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commission_ladder_holds() |
| record_change           | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.commission FOR EACH ROW EXECUTE FUNCTION record_change('deal_id')                                                    |
| stamp_change            | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.commission FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                                        |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
