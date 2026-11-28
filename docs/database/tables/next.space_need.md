# next.space_need

## Columns

| Name                | Type                     | Default           | Nullable | Children | Parents                               | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | -------- | ------------------------------------- | ------- |
| applicability       | text                     |                   | true     |          |                                       |         |
| changed_at          | timestamp with time zone |                   | false    |          |                                       |         |
| changed_by_job      | text                     |                   | true     |          | [next.job](next.job.md)               |         |
| changed_by_user_id  | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)     |         |
| changed_for_user_id | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)     |         |
| created_at          | timestamp with time zone | now()             | false    |          |                                       |         |
| deal_id             | uuid                     |                   | false    |          | [next.deal](next.deal.md)             |         |
| id                  | uuid                     | gen_random_uuid() | false    |          |                                       |         |
| market_id           | uuid                     |                   | true     |          | [next.market](next.market.md)         |         |
| max_rate_sf_yr      | numeric(10,2)            |                   | true     |          |                                       |         |
| max_sf              | numeric(10,1)            |                   | true     |          |                                       |         |
| min_sf              | numeric(10,1)            |                   | true     |          |                                       |         |
| must_haves          | text                     |                   | true     |          |                                       |         |
| name                | text                     |                   | false    |          |                                       |         |
| source_ref          | text                     |                   | true     |          |                                       |         |
| source_revision     | text                     |                   | true     |          |                                       |         |
| space_type          | text                     |                   | true     |          |                                       |         |
| vendor_id           | uuid                     |                   | true     |          | [next.party_role](next.party_role.md) |         |
| vendor_role         | text                     | 'vendor'::text    | false    |          | [next.party_role](next.party_role.md) |         |

## Viewpoints

| Name                              | Definition                                                                  |
| --------------------------------- | --------------------------------------------------------------------------- |
| [Property](viewpoint-property.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                  | Type        | Definition                                                                                                                           |
| ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| space_need_applicability_check        | CHECK       | CHECK ((applicability ~ '\S'::text))                                                                                                 |
| space_need_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| space_need_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| space_need_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| space_need_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| space_need_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| space_need_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| space_need_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                            |
| space_need_deal_id_not_null           | n           | NOT NULL deal_id                                                                                                                     |
| space_need_id_not_null                | n           | NOT NULL id                                                                                                                          |
| space_need_market_id_fkey             | FOREIGN KEY | FOREIGN KEY (market_id) REFERENCES market(id)                                                                                        |
| space_need_max_rate_sf_yr_check       | CHECK       | CHECK (((max_rate_sf_yr >= (0)::numeric) AND (max_rate_sf_yr <> 'NaN'::numeric)))                                                    |
| space_need_max_sf_check               | CHECK       | CHECK (((max_sf > (0)::numeric) AND (max_sf <> 'NaN'::numeric)))                                                                     |
| space_need_min_sf_check               | CHECK       | CHECK (((min_sf > (0)::numeric) AND (min_sf <> 'NaN'::numeric)))                                                                     |
| space_need_must_haves_check           | CHECK       | CHECK ((must_haves ~ '\S'::text))                                                                                                    |
| space_need_name_check                 | CHECK       | CHECK ((name ~ '\S'::text))                                                                                                          |
| space_need_name_not_null              | n           | NOT NULL name                                                                                                                        |
| space_need_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| space_need_size_in_order              | CHECK       | CHECK ((max_sf >= min_sf))                                                                                                           |
| space_need_source_ref_check           | CHECK       | CHECK ((source_ref ~ '\S'::text))                                                                                                    |
| space_need_source_revision_check      | CHECK       | CHECK ((source_revision ~ '\S'::text))                                                                                               |
| space_need_space_type_check           | CHECK       | CHECK ((space_type ~ '\S'::text))                                                                                                    |
| space_need_vendor_id_vendor_role_fkey | FOREIGN KEY | FOREIGN KEY (vendor_id, vendor_role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE                                         |
| space_need_vendor_role_check          | CHECK       | CHECK ((vendor_role = 'vendor'::text))                                                                                               |
| space_need_vendor_role_not_null       | n           | NOT NULL vendor_role                                                                                                                 |
| space_need_vendor_source_whole        | CHECK       | CHECK ((num_nonnulls(vendor_id, source_ref, source_revision, applicability) = ANY (ARRAY[0, 4])))                                    |

## Indexes

| Name            | Definition                                                              |
| --------------- | ----------------------------------------------------------------------- |
| space_need_pkey | CREATE UNIQUE INDEX space_need_pkey ON next.space_need USING btree (id) |

## Triggers

| Name          | Definition                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.space_need FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.space_need FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
