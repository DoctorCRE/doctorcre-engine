# next.offer_claim

## Columns

| Name                 | Type                     | Default | Nullable | Children | Parents                               | Comment |
| -------------------- | ------------------------ | ------- | -------- | -------- | ------------------------------------- | ------- |
| changed_at           | timestamp with time zone |         | false    |          |                                       |         |
| changed_by_job       | text                     |         | true     |          | [next.job](next.job.md)               |         |
| changed_by_user_id   | uuid                     |         | true     |          | [next.app_user](next.app_user.md)     |         |
| changed_for_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md)     |         |
| claim_type           | text                     |         | false    |          | [next.claim_type](next.claim_type.md) |         |
| created_at           | timestamp with time zone | now()   | false    |          |                                       |         |
| floor_rent_per_sf_yr | numeric(10,2)            |         | true     |          |                                       |         |
| note                 | text                     |         | true     |          |                                       |         |
| offer_id             | uuid                     |         | false    |          | [next.offer](next.offer.md)           |         |
| quote                | text                     |         | true     |          |                                       |         |

## Viewpoints

| Name                          | Definition                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| [Offers](viewpoint-offers.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                   | Type        | Definition                                                                                                                           |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| offer_claim_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| offer_claim_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| offer_claim_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| offer_claim_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| offer_claim_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| offer_claim_claim_type_fkey            | FOREIGN KEY | FOREIGN KEY (claim_type) REFERENCES claim_type(slug)                                                                                 |
| offer_claim_claim_type_not_null        | n           | NOT NULL claim_type                                                                                                                  |
| offer_claim_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| offer_claim_floor_rent_per_sf_yr_check | CHECK       | CHECK ((floor_rent_per_sf_yr > (0)::numeric))                                                                                        |
| offer_claim_note_check                 | CHECK       | CHECK ((note ~ '\S'::text))                                                                                                          |
| offer_claim_offer_id_fkey              | FOREIGN KEY | FOREIGN KEY (offer_id) REFERENCES offer(id)                                                                                          |
| offer_claim_offer_id_not_null          | n           | NOT NULL offer_id                                                                                                                    |
| offer_claim_pkey                       | PRIMARY KEY | PRIMARY KEY (offer_id, claim_type)                                                                                                   |
| offer_claim_quote_check                | CHECK       | CHECK ((quote ~ '\S'::text))                                                                                                         |

## Indexes

| Name             | Definition                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------- |
| offer_claim_pkey | CREATE UNIQUE INDEX offer_claim_pkey ON next.offer_claim USING btree (offer_id, claim_type) |

## Triggers

| Name          | Definition                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.offer_claim FOR EACH ROW EXECUTE FUNCTION record_change('offer_id', 'claim_type') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.offer_claim FOR EACH ROW EXECUTE FUNCTION stamp_change()                                    |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
