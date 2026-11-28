# next.deal_star

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()   | false    |          |                                   |         |
| deal_id             | uuid                     |         | false    |          | [next.deal](next.deal.md)         |         |
| user_id             | uuid                     |         | false    |          | [next.app_user](next.app_user.md) |         |

## Viewpoints

| Name                        | Definition                                             |
| --------------------------- | ------------------------------------------------------ |
| [Deals](viewpoint-deals.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                 | Type        | Definition                                                                                                                           |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| deal_star_by_its_user                | CHECK       | CHECK ((NOT (changed_by_user_id IS DISTINCT FROM user_id)))                                                                          |
| deal_star_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| deal_star_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| deal_star_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| deal_star_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| deal_star_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| deal_star_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| deal_star_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id) ON DELETE CASCADE                                                                          |
| deal_star_deal_id_not_null           | n           | NOT NULL deal_id                                                                                                                     |
| deal_star_pkey                       | PRIMARY KEY | PRIMARY KEY (user_id, deal_id)                                                                                                       |
| deal_star_user_id_fkey               | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES app_user(id)                                                                                        |
| deal_star_user_id_not_null           | n           | NOT NULL user_id                                                                                                                     |

## Indexes

| Name           | Definition                                                                          |
| -------------- | ----------------------------------------------------------------------------------- |
| deal_star_pkey | CREATE UNIQUE INDEX deal_star_pkey ON next.deal_star USING btree (user_id, deal_id) |

## Triggers

| Name          | Definition                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.deal_star FOR EACH ROW EXECUTE FUNCTION record_change('user_id', 'deal_id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.deal_star FOR EACH ROW EXECUTE FUNCTION stamp_change()                                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
