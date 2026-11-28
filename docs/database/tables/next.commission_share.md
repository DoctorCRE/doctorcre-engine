# next.commission_share

## Columns

| Name                | Type                     | Default           | Nullable | Children | Parents                               | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | -------- | ------------------------------------- | ------- |
| changed_at          | timestamp with time zone |                   | false    |          |                                       |         |
| changed_by_job      | text                     |                   | true     |          | [next.job](next.job.md)               |         |
| changed_by_user_id  | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)     |         |
| changed_for_user_id | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)     |         |
| created_at          | timestamp with time zone | now()             | false    |          |                                       |         |
| deal_id             | uuid                     |                   | false    |          | [next.commission](next.commission.md) |         |
| id                  | uuid                     | gen_random_uuid() | false    |          |                                       |         |
| kind                | text                     |                   | false    |          |                                       |         |
| party_id            | uuid                     |                   | false    |          | [next.party](next.party.md)           |         |
| share               | numeric(6,5)             |                   | false    |          |                                       |         |

## Viewpoints

| Name                                    | Definition                                             |
| --------------------------------------- | ------------------------------------------------------ |
| [Commissions](viewpoint-commissions.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                        | Type        | Definition                                                                                                                                                                    |
| ------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| commission_adds_up                          | TRIGGER     | CREATE CONSTRAINT TRIGGER commission_adds_up AFTER INSERT OR UPDATE ON next.commission_share DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commission_adds_up() |
| commission_share_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                                                           |
| commission_share_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                          |
| commission_share_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                             |
| commission_share_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                                      |
| commission_share_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                                     |
| commission_share_created_at_not_null        | n           | NOT NULL created_at                                                                                                                                                           |
| commission_share_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES commission(deal_id)                                                                                                                          |
| commission_share_deal_id_not_null           | n           | NOT NULL deal_id                                                                                                                                                              |
| commission_share_id_not_null                | n           | NOT NULL id                                                                                                                                                                   |
| commission_share_kind_check                 | CHECK       | CHECK ((kind = ANY (ARRAY['referral'::text, 'brokerage'::text, 'other'::text])))                                                                                              |
| commission_share_kind_not_null              | n           | NOT NULL kind                                                                                                                                                                 |
| commission_share_party_id_fkey              | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                                                                   |
| commission_share_party_id_not_null          | n           | NOT NULL party_id                                                                                                                                                             |
| commission_share_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                                                              |
| commission_share_share_check                | CHECK       | CHECK (((share > (0)::numeric) AND (share <= (1)::numeric)))                                                                                                                  |
| commission_share_share_not_null             | n           | NOT NULL share                                                                                                                                                                |

## Indexes

| Name                  | Definition                                                                          |
| --------------------- | ----------------------------------------------------------------------------------- |
| commission_share_pkey | CREATE UNIQUE INDEX commission_share_pkey ON next.commission_share USING btree (id) |

## Triggers

| Name               | Definition                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| commission_adds_up | CREATE CONSTRAINT TRIGGER commission_adds_up AFTER INSERT OR UPDATE ON next.commission_share DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commission_adds_up() |
| record_change      | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.commission_share FOR EACH ROW EXECUTE FUNCTION record_change('id')                                      |
| stamp_change       | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.commission_share FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                     |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
