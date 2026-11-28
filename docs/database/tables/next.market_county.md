# next.market_county

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| county_fips         | county_fips              |         | false    |          |                                   |         |
| created_at          | timestamp with time zone | now()   | false    |          |                                   |         |
| market_id           | uuid                     |         | false    |          | [next.market](next.market.md)     |         |

## Viewpoints

| Name                                                        | Definition                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Vendors and territories](viewpoint-vendors-territories.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                     | Type        | Definition                                                                                                                           |
| ---------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| market_county_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| market_county_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| market_county_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| market_county_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| market_county_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| market_county_county_fips_not_null       | n           | NOT NULL county_fips                                                                                                                 |
| market_county_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| market_county_market_id_fkey             | FOREIGN KEY | FOREIGN KEY (market_id) REFERENCES market(id)                                                                                        |
| market_county_market_id_not_null         | n           | NOT NULL market_id                                                                                                                   |
| market_county_pkey                       | PRIMARY KEY | PRIMARY KEY (market_id, county_fips)                                                                                                 |

## Indexes

| Name               | Definition                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| market_county_pkey | CREATE UNIQUE INDEX market_county_pkey ON next.market_county USING btree (market_id, county_fips) |

## Triggers

| Name          | Definition                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.market_county FOR EACH ROW EXECUTE FUNCTION record_change('market_id', 'county_fips') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.market_county FOR EACH ROW EXECUTE FUNCTION stamp_change()                                      |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
