# next.territory_piece

## Columns

| Name                | Type                     | Default           | Nullable | Children | Parents                             | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | -------- | ----------------------------------- | ------- |
| base_latitude       | latitude                 |                   | true     |          |                                     |         |
| base_longitude      | longitude                |                   | true     |          |                                     |         |
| changed_at          | timestamp with time zone |                   | false    |          |                                     |         |
| changed_by_job      | text                     |                   | true     |          | [next.job](next.job.md)             |         |
| changed_by_user_id  | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)   |         |
| changed_for_user_id | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)   |         |
| created_at          | timestamp with time zone | now()             | false    |          |                                     |         |
| id                  | uuid                     | gen_random_uuid() | false    |          |                                     |         |
| market_id           | uuid                     |                   | true     |          | [next.market](next.market.md)       |         |
| miles               | numeric(6,1)             |                   | true     |          |                                     |         |
| state_fips          | state_fips               |                   | true     |          |                                     |         |
| territory_id        | uuid                     |                   | false    |          | [next.territory](next.territory.md) |         |

## Viewpoints

| Name                                                        | Definition                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Vendors and territories](viewpoint-vendors-territories.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                       | Type        | Definition                                                                                                                           |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| territory_piece_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| territory_piece_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| territory_piece_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| territory_piece_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| territory_piece_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| territory_piece_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| territory_piece_distance_from_a_base       | CHECK       | CHECK ((num_nonnulls(base_latitude, base_longitude, miles) = ANY (ARRAY[0, 3])))                                                     |
| territory_piece_id_not_null                | n           | NOT NULL id                                                                                                                          |
| territory_piece_market_id_fkey             | FOREIGN KEY | FOREIGN KEY (market_id) REFERENCES market(id)                                                                                        |
| territory_piece_miles_check                | CHECK       | CHECK ((miles > (0)::numeric))                                                                                                       |
| territory_piece_once                       | UNIQUE      | UNIQUE NULLS NOT DISTINCT (territory_id, state_fips, market_id, base_latitude, base_longitude, miles)                                |
| territory_piece_one_kind                   | CHECK       | CHECK ((num_nonnulls(state_fips, market_id, miles) = 1))                                                                             |
| territory_piece_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| territory_piece_territory_id_fkey          | FOREIGN KEY | FOREIGN KEY (territory_id) REFERENCES territory(id)                                                                                  |
| territory_piece_territory_id_not_null      | n           | NOT NULL territory_id                                                                                                                |

## Indexes

| Name                 | Definition                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| territory_piece_once | CREATE UNIQUE INDEX territory_piece_once ON next.territory_piece USING btree (territory_id, state_fips, market_id, base_latitude, base_longitude, miles) NULLS NOT DISTINCT |
| territory_piece_pkey | CREATE UNIQUE INDEX territory_piece_pkey ON next.territory_piece USING btree (id)                                                                                           |

## Triggers

| Name          | Definition                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.territory_piece FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.territory_piece FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
