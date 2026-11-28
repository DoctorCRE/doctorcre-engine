# next.imported_deal_owner

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| deal_id             | uuid                     |         | false    |          | [next.deal](next.deal.md)         |         |
| ended_at            | timestamp with time zone |         | false    |          |                                   |         |
| id                  | uuid                     |         | false    |          |                                   |         |
| started_at          | timestamp with time zone |         | true     |          |                                   |         |
| user_id             | uuid                     |         | false    |          | [next.app_user](next.app_user.md) |         |

## Viewpoints

| Name                                          | Definition                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| [Imported deals](viewpoint-imported-deals.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                           | Type        | Definition                                                                                                                           |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| imported_deal_owner_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| imported_deal_owner_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| imported_deal_owner_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| imported_deal_owner_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| imported_deal_owner_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| imported_deal_owner_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                            |
| imported_deal_owner_deal_id_not_null           | n           | NOT NULL deal_id                                                                                                                     |
| imported_deal_owner_ended_at_not_null          | n           | NOT NULL ended_at                                                                                                                    |
| imported_deal_owner_ends_after_it_starts       | CHECK       | CHECK ((ended_at > started_at))                                                                                                      |
| imported_deal_owner_id_not_null                | n           | NOT NULL id                                                                                                                          |
| imported_deal_owner_one_at_a_time              | x           | EXCLUDE USING gist (deal_id WITH =, tstzrange(started_at, ended_at) WITH &&)                                                         |
| imported_deal_owner_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| imported_deal_owner_user_id_fkey               | FOREIGN KEY | FOREIGN KEY (user_id) REFERENCES app_user(id)                                                                                        |
| imported_deal_owner_user_id_not_null           | n           | NOT NULL user_id                                                                                                                     |

## Indexes

| Name                              | Definition                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| imported_deal_owner_one_at_a_time | CREATE INDEX imported_deal_owner_one_at_a_time ON next.imported_deal_owner USING gist (deal_id, tstzrange(started_at, ended_at)) |
| imported_deal_owner_pkey          | CREATE UNIQUE INDEX imported_deal_owner_pkey ON next.imported_deal_owner USING btree (id)                                        |

## Triggers

| Name          | Definition                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.imported_deal_owner FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.imported_deal_owner FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
