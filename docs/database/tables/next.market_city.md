# next.market_city

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| city                | text                     |         | false    |          |                                   |         |
| created_at          | timestamp with time zone | now()   | false    |          |                                   |         |
| market_id           | uuid                     |         | false    |          | [next.market](next.market.md)     |         |

## Viewpoints

| Name                                                        | Definition                                             |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| [Vendors and territories](viewpoint-vendors-territories.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                   | Type        | Definition                                                                                                                           |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| market_city_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| market_city_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| market_city_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| market_city_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| market_city_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| market_city_city_check                 | CHECK       | CHECK (((city ~ '\S'::text) AND (city = btrim(city))))                                                                               |
| market_city_city_not_null              | n           | NOT NULL city                                                                                                                        |
| market_city_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| market_city_market_id_fkey             | FOREIGN KEY | FOREIGN KEY (market_id) REFERENCES market(id)                                                                                        |
| market_city_market_id_not_null         | n           | NOT NULL market_id                                                                                                                   |
| market_city_pkey                       | PRIMARY KEY | PRIMARY KEY (market_id, city)                                                                                                        |

## Indexes

| Name             | Definition                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------- |
| market_city_once | CREATE UNIQUE INDEX market_city_once ON next.market_city USING btree (market_id, lower(city)) |
| market_city_pkey | CREATE UNIQUE INDEX market_city_pkey ON next.market_city USING btree (market_id, city)        |

## Triggers

| Name          | Definition                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.market_city FOR EACH ROW EXECUTE FUNCTION record_change('market_id', 'city') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.market_city FOR EACH ROW EXECUTE FUNCTION stamp_change()                               |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
