# next.party_territory_review

## Columns

| Name                 | Type                     | Default | Nullable | Children | Parents                                         | Comment |
| -------------------- | ------------------------ | ------- | -------- | -------- | ----------------------------------------------- | ------- |
| changed_at           | timestamp with time zone |         | false    |          |                                                 |         |
| changed_by_job       | text                     |         | true     |          | [next.job](next.job.md)                         |         |
| changed_by_user_id   | uuid                     |         | true     |          | [next.app_user](next.app_user.md)               |         |
| changed_for_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md)               |         |
| coverage             | text                     |         | true     |          |                                                 |         |
| created_at           | timestamp with time zone | now()   | false    |          |                                                 |         |
| has_office           | boolean                  |         | false    |          |                                                 |         |
| party_territory_id   | uuid                     |         | false    |          | [next.party_territory](next.party_territory.md) |         |
| reviewed_at          | timestamp with time zone |         | false    |          |                                                 |         |
| reviewed_by_job      | text                     |         | true     |          | [next.job](next.job.md)                         |         |
| reviewed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md)               |         |
| reviewed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md)               |         |
| source               | text                     |         | false    |          |                                                 |         |

## Viewpoints

| Name                                                        | Definition                                             |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| [Vendors and territories](viewpoint-vendors-territories.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                               | Type        | Definition                                                                                                                               |
| -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| party_territory_review_by_a_user_or_a_job          | CHECK       | CHECK (((num_nonnulls(reviewed_by_user_id, reviewed_by_job) = 1) AND ((reviewed_by_job IS NOT NULL) OR (reviewed_for_user_id IS NULL)))) |
| party_territory_review_changed_at_not_null         | n           | NOT NULL changed_at                                                                                                                      |
| party_territory_review_changed_by_a_user_or_a_job  | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))     |
| party_territory_review_changed_by_job_fkey         | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                        |
| party_territory_review_changed_by_user_id_fkey     | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                 |
| party_territory_review_changed_for_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                |
| party_territory_review_coverage_check              | CHECK       | CHECK ((coverage ~ '\S'::text))                                                                                                          |
| party_territory_review_created_at_not_null         | n           | NOT NULL created_at                                                                                                                      |
| party_territory_review_has_office_not_null         | n           | NOT NULL has_office                                                                                                                      |
| party_territory_review_party_territory_id_fkey     | FOREIGN KEY | FOREIGN KEY (party_territory_id) REFERENCES party_territory(id)                                                                          |
| party_territory_review_party_territory_id_not_null | n           | NOT NULL party_territory_id                                                                                                              |
| party_territory_review_pkey                        | PRIMARY KEY | PRIMARY KEY (party_territory_id)                                                                                                         |
| party_territory_review_reviewed_at_not_null        | n           | NOT NULL reviewed_at                                                                                                                     |
| party_territory_review_reviewed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (reviewed_by_job) REFERENCES job(slug)                                                                                       |
| party_territory_review_reviewed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (reviewed_by_user_id) REFERENCES app_user(id)                                                                                |
| party_territory_review_reviewed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (reviewed_for_user_id) REFERENCES app_user(id)                                                                               |
| party_territory_review_says_something              | CHECK       | CHECK ((has_office OR (coverage IS NOT NULL)))                                                                                           |
| party_territory_review_source_check                | CHECK       | CHECK ((source ~ '\S'::text))                                                                                                            |
| party_territory_review_source_not_null             | n           | NOT NULL source                                                                                                                          |

## Indexes

| Name                        | Definition                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| party_territory_review_pkey | CREATE UNIQUE INDEX party_territory_review_pkey ON next.party_territory_review USING btree (party_territory_id) |

## Triggers

| Name          | Definition                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.party_territory_review FOR EACH ROW EXECUTE FUNCTION record_change('party_territory_id') |
| review_stamp  | CREATE TRIGGER review_stamp BEFORE INSERT OR UPDATE ON next.party_territory_review FOR EACH ROW EXECUTE FUNCTION stamp_review()                                |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.party_territory_review FOR EACH ROW EXECUTE FUNCTION stamp_change()                                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
