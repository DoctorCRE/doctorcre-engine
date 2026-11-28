# next.weekly_review

## Columns

| Name                | Type                     | Default           | Nullable | Extra Definition                                                                                                               | Children | Parents                               | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------- | ------- |
| changed_at          | timestamp with time zone |                   | false    |                                                                                                                                |          |                                       |         |
| changed_by_job      | text                     |                   | true     |                                                                                                                                |          | [next.job](next.job.md)               |         |
| changed_by_user_id  | uuid                     |                   | true     |                                                                                                                                |          | [next.app_user](next.app_user.md)     |         |
| changed_for_user_id | uuid                     |                   | true     |                                                                                                                                |          | [next.app_user](next.app_user.md)     |         |
| deal_id             | uuid                     |                   | true     |                                                                                                                                |          | [next.deal](next.deal.md)             |         |
| id                  | uuid                     | gen_random_uuid() | false    |                                                                                                                                |          |                                       |         |
| lead_role           | text                     |                   | true     | GENERATED ALWAYS AS <br />CASE<br />    WHEN (party_id IS NOT NULL) THEN 'lead'::text<br />    ELSE NULL::text<br />END STORED |          | [next.party_role](next.party_role.md) |         |
| party_id            | uuid                     |                   | true     |                                                                                                                                |          | [next.party_role](next.party_role.md) |         |
| reviewer_is_partner | boolean                  |                   | true     | GENERATED ALWAYS AS true STORED                                                                                                |          | [next.app_user](next.app_user.md)     |         |
| week_of             | date                     |                   | false    |                                                                                                                                |          |                                       |         |

## Viewpoints

| Name                                            | Definition                                             |
| ----------------------------------------------- | ------------------------------------------------------ |
| [Home and calendar](viewpoint-home-calendar.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                                      | Type        | Definition                                                                                                                           |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| weekly_review_by_a_user                                   | CHECK       | CHECK ((changed_by_user_id IS NOT NULL))                                                                                             |
| weekly_review_changed_at_not_null                         | n           | NOT NULL changed_at                                                                                                                  |
| weekly_review_changed_by_a_user_or_a_job                  | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| weekly_review_changed_by_job_fkey                         | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| weekly_review_changed_by_user_id_fkey                     | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| weekly_review_changed_by_user_id_reviewer_is_partner_fkey | FOREIGN KEY | FOREIGN KEY (changed_by_user_id, reviewer_is_partner) REFERENCES app_user(id, is_account_partner)                                    |
| weekly_review_changed_for_user_id_fkey                    | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| weekly_review_deal_id_fkey                                | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                            |
| weekly_review_id_not_null                                 | n           | NOT NULL id                                                                                                                          |
| weekly_review_one_item                                    | CHECK       | CHECK ((num_nonnulls(deal_id, party_id) = 1))                                                                                        |
| weekly_review_party_id_lead_role_fkey                     | FOREIGN KEY | FOREIGN KEY (party_id, lead_role) REFERENCES party_role(party_id, role)                                                              |
| weekly_review_pkey                                        | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| weekly_review_week_of_check                               | CHECK       | CHECK ((isfinite(week_of) AND (EXTRACT(isodow FROM week_of) = (1)::numeric)))                                                        |
| weekly_review_week_of_deal_id_party_id_key                | UNIQUE      | UNIQUE NULLS NOT DISTINCT (week_of, deal_id, party_id)                                                                               |
| weekly_review_week_of_not_null                            | n           | NOT NULL week_of                                                                                                                     |

## Indexes

| Name                                       | Definition                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| weekly_review_pkey                         | CREATE UNIQUE INDEX weekly_review_pkey ON next.weekly_review USING btree (id)                                                                    |
| weekly_review_week_of_deal_id_party_id_key | CREATE UNIQUE INDEX weekly_review_week_of_deal_id_party_id_key ON next.weekly_review USING btree (week_of, deal_id, party_id) NULLS NOT DISTINCT |

## Triggers

| Name                          | Definition                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change                 | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.weekly_review FOR EACH ROW EXECUTE FUNCTION record_change('id')          |
| stamp_change                  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.weekly_review FOR EACH ROW EXECUTE FUNCTION stamp_change()                         |
| weekly_review_undo_by_partner | CREATE TRIGGER weekly_review_undo_by_partner BEFORE DELETE ON next.weekly_review FOR EACH ROW EXECUTE FUNCTION weekly_review_undo_by_partner() |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
