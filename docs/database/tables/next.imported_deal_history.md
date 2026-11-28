# next.imported_deal_history

## Columns

| Name                   | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ---------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| agent_rationale        | text                     |         | true     |          |                                   |         |
| authorization_class    | text                     |         | true     |          |                                   |         |
| cause                  | text                     |         | false    |          |                                   |         |
| changed_by_job         | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id     | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| client_id              | text                     |         | true     |          |                                   |         |
| correlation_id         | uuid                     |         | true     |          |                                   |         |
| deal_id                | uuid                     |         | false    |          | [next.deal](next.deal.md)         |         |
| field                  | text                     |         | true     |          |                                   |         |
| human_quote            | text                     |         | true     |          |                                   |         |
| id                     | uuid                     |         | false    |          |                                   |         |
| idempotency_key        | text                     |         | true     |          |                                   |         |
| mutation_order         | bigint                   |         | false    |          |                                   |         |
| new_keys               | text[]                   |         | true     |          |                                   |         |
| new_value              | imported_deal_values     |         | true     |          |                                   |         |
| occurred_at            | timestamp with time zone |         | false    |          |                                   |         |
| old_keys               | text[]                   |         | true     |          |                                   |         |
| old_value              | imported_deal_values     |         | true     |          |                                   |         |
| organization_tenant_id | text                     |         | true     |          |                                   |         |
| personal_scope         | text                     |         | true     |          |                                   |         |
| recorded_at            | timestamp with time zone |         | false    |          |                                   |         |
| source_actor_id        | uuid                     |         | false    |          |                                   |         |
| source_deal_id         | uuid                     |         | false    |          |                                   |         |
| sponsoring_human_slug  | text                     |         | true     |          |                                   |         |
| verb                   | text                     |         | false    |          |                                   |         |
| via                    | text                     |         | true     |          |                                   |         |

## Viewpoints

| Name                                          | Definition                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| [Imported deals](viewpoint-imported-deals.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                           | Type        | Definition                                                           |
| ---------------------------------------------- | ----------- | -------------------------------------------------------------------- |
| imported_deal_history_cause_not_null           | n           | NOT NULL cause                                                       |
| imported_deal_history_changed_by_job_fkey      | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                    |
| imported_deal_history_changed_by_user_id_fkey  | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)             |
| imported_deal_history_check                    | CHECK       | CHECK ((num_nonnulls(changed_by_user_id, changed_by_job) = 1))       |
| imported_deal_history_check1                   | CHECK       | CHECK (((old_keys IS NOT NULL) = (old_value IS DISTINCT FROM NULL))) |
| imported_deal_history_check2                   | CHECK       | CHECK (((new_keys IS NOT NULL) = (new_value IS DISTINCT FROM NULL))) |
| imported_deal_history_deal_id_fkey             | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                            |
| imported_deal_history_deal_id_not_null         | n           | NOT NULL deal_id                                                     |
| imported_deal_history_id_not_null              | n           | NOT NULL id                                                          |
| imported_deal_history_mutation_order_not_null  | n           | NOT NULL mutation_order                                              |
| imported_deal_history_occurred_at_not_null     | n           | NOT NULL occurred_at                                                 |
| imported_deal_history_pkey                     | PRIMARY KEY | PRIMARY KEY (id)                                                     |
| imported_deal_history_recorded_at_not_null     | n           | NOT NULL recorded_at                                                 |
| imported_deal_history_source_actor_id_not_null | n           | NOT NULL source_actor_id                                             |
| imported_deal_history_source_deal_id_not_null  | n           | NOT NULL source_deal_id                                              |
| imported_deal_history_verb_check               | CHECK       | CHECK ((verb ~ '\S'::text))                                          |
| imported_deal_history_verb_not_null            | n           | NOT NULL verb                                                        |

## Indexes

| Name                        | Definition                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| imported_deal_history_order | CREATE INDEX imported_deal_history_order ON next.imported_deal_history USING btree (deal_id, recorded_at, id) |
| imported_deal_history_pkey  | CREATE UNIQUE INDEX imported_deal_history_pkey ON next.imported_deal_history USING btree (id)                 |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
