# next.client_brand

## Columns

| Name                | Type                     | Default           | Nullable | Extra Definition                           | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | ------------------------------------------ | -------- | --------------------------------- | ------- |
| brand_id            | uuid                     |                   | false    |                                            |          | [next.party](next.party.md)       |         |
| brand_kind          | text                     |                   | true     | GENERATED ALWAYS AS 'company'::text STORED |          | [next.party](next.party.md)       |         |
| changed_at          | timestamp with time zone |                   | false    |                                            |          |                                   |         |
| changed_by_job      | text                     |                   | true     |                                            |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |                   | true     |                                            |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |                   | true     |                                            |          | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()             | false    |                                            |          |                                   |         |
| ended_on            | date                     |                   | true     |                                            |          |                                   |         |
| id                  | uuid                     | gen_random_uuid() | false    |                                            |          |                                   |         |
| location_id         | uuid                     |                   | false    |                                            |          | [next.client](next.client.md)     |         |
| started_on          | date                     |                   | false    |                                            |          |                                   |         |

## Viewpoints

| Name                            | Definition                                             |
| ------------------------------- | ------------------------------------------------------ |
| [Clients](viewpoint-clients.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                    | Type        | Definition                                                                                                                           |
| --------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| client_brand_brand_id_brand_kind_fkey   | FOREIGN KEY | FOREIGN KEY (brand_id, brand_kind) REFERENCES party(id, kind)                                                                        |
| client_brand_brand_id_not_null          | n           | NOT NULL brand_id                                                                                                                    |
| client_brand_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| client_brand_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| client_brand_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| client_brand_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| client_brand_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| client_brand_check                      | CHECK       | CHECK ((ended_on > started_on))                                                                                                      |
| client_brand_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| client_brand_different_parties          | CHECK       | CHECK ((location_id <> brand_id))                                                                                                    |
| client_brand_id_not_null                | n           | NOT NULL id                                                                                                                          |
| client_brand_location_id_daterange_excl | x           | EXCLUDE USING gist (location_id WITH =, daterange(started_on, ended_on) WITH &&)                                                     |
| client_brand_location_id_fkey           | FOREIGN KEY | FOREIGN KEY (location_id) REFERENCES client(party_id) ON UPDATE CASCADE                                                              |
| client_brand_location_id_not_null       | n           | NOT NULL location_id                                                                                                                 |
| client_brand_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| client_brand_started_on_not_null        | n           | NOT NULL started_on                                                                                                                  |

## Indexes

| Name                                    | Definition                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| client_brand_location_id_daterange_excl | CREATE INDEX client_brand_location_id_daterange_excl ON next.client_brand USING gist (location_id, daterange(started_on, ended_on)) |
| client_brand_pkey                       | CREATE UNIQUE INDEX client_brand_pkey ON next.client_brand USING btree (id)                                                         |

## Triggers

| Name          | Definition                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.client_brand FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.client_brand FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
