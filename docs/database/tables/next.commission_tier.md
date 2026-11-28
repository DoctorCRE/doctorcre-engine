# next.commission_tier

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| closing_share       | numeric(6,5)             |         | false    |          |                                   |         |
| from_deal           | integer                  |         | false    |          |                                   |         |
| partner_user_id     | uuid                     |         | false    |          | [next.app_user](next.app_user.md) |         |
| user_id             | uuid                     |         | false    |          | [next.app_user](next.app_user.md) |         |

## Viewpoints

| Name                                    | Definition                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------- |
| [Commissions](viewpoint-commissions.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                       | Type        | Definition                                                                                                                                                                                       |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| commission_ladder_holds                    | TRIGGER     | CREATE CONSTRAINT TRIGGER commission_ladder_holds AFTER INSERT OR DELETE OR UPDATE ON next.commission_tier DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commission_ladder_holds() |
| commission_tier_another_user               | CHECK       | CHECK ((partner_user_id <> user_id))                                                                                                                                                             |
| commission_tier_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                                                                              |
| commission_tier_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                                             |
| commission_tier_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                                                |
| commission_tier_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                                                         |
| commission_tier_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                                                        |
| commission_tier_closing_share_check        | CHECK       | CHECK (((closing_share >= 0.5) AND (closing_share <= (1)::numeric)))                                                                                                                             |
| commission_tier_closing_share_not_null     | n           | NOT NULL closing_share                                                                                                                                                                           |
| commission_tier_from_deal_check            | CHECK       | CHECK ((from_deal >= 1))                                                                                                                                                                         |
| commission_tier_from_deal_not_null         | n           | NOT NULL from_deal                                                                                                                                                                               |
| commission_tier_one_partner                | x           | EXCLUDE USING gist (user_id WITH =, partner_user_id WITH <>)                                                                                                                                     |
| commission_tier_partner_user_id_fkey       | FOREIGN KEY | FOREIGN KEY (partner_user_id) REFERENCES app_user(id)                                                                                                                                            |
| commission_tier_partner_user_id_not_null   | n           | NOT NULL partner_user_id                                                                                                                                                                         |
| commission_tier_pkey                       | PRIMARY KEY | PRIMARY KEY (user_id, from_deal)                                                                                                                                                                 |
| commission_tier_user_id_fkey               | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES app_user(id)                                                                                                                                                    |
| commission_tier_user_id_not_null           | n           | NOT NULL user_id                                                                                                                                                                                 |

## Indexes

| Name                        | Definition                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| commission_tier_one_partner | CREATE INDEX commission_tier_one_partner ON next.commission_tier USING gist (user_id, partner_user_id) |
| commission_tier_pkey        | CREATE UNIQUE INDEX commission_tier_pkey ON next.commission_tier USING btree (user_id, from_deal)      |

## Triggers

| Name                    | Definition                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| commission_ladder_holds | CREATE CONSTRAINT TRIGGER commission_ladder_holds AFTER INSERT OR DELETE OR UPDATE ON next.commission_tier DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commission_ladder_holds() |
| record_change           | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.commission_tier FOR EACH ROW EXECUTE FUNCTION record_change('user_id', 'from_deal')                                        |
| stamp_change            | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.commission_tier FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                                         |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
