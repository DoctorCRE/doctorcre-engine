# next.party_email

## Columns

| Name                | Type                     | Default           | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | -------- | --------------------------------- | ------- |
| address             | email_address            |                   | false    |          |                                   |         |
| changed_at          | timestamp with time zone |                   | false    |          |                                   |         |
| changed_by_job      | text                     |                   | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |                   | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |                   | true     |          | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()             | false    |          |                                   |         |
| id                  | uuid                     | gen_random_uuid() | false    |          |                                   |         |
| is_primary          | boolean                  | false             | false    |          |                                   |         |
| label               | text                     |                   | false    |          |                                   |         |
| party_id            | uuid                     |                   | false    |          | [next.party](next.party.md)       |         |

## Viewpoints

| Name                          | Definition                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| [People](viewpoint-people.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                   | Type        | Definition                                                                                                                           |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| party_email_address_not_null           | n           | NOT NULL address                                                                                                                     |
| party_email_address_party_id_key       | UNIQUE      | UNIQUE (address, party_id)                                                                                                           |
| party_email_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| party_email_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| party_email_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| party_email_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| party_email_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| party_email_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| party_email_id_not_null                | n           | NOT NULL id                                                                                                                          |
| party_email_is_primary_not_null        | n           | NOT NULL is_primary                                                                                                                  |
| party_email_label_check                | CHECK       | CHECK ((label = ANY (ARRAY['work'::text, 'personal'::text])))                                                                        |
| party_email_label_not_null             | n           | NOT NULL label                                                                                                                       |
| party_email_party_id_fkey              | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                          |
| party_email_party_id_not_null          | n           | NOT NULL party_id                                                                                                                    |
| party_email_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |

## Indexes

| Name                             | Definition                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| party_email_address_party_id_key | CREATE UNIQUE INDEX party_email_address_party_id_key ON next.party_email USING btree (address, party_id) |
| party_email_one_primary          | CREATE UNIQUE INDEX party_email_one_primary ON next.party_email USING btree (party_id) WHERE is_primary  |
| party_email_pkey                 | CREATE UNIQUE INDEX party_email_pkey ON next.party_email USING btree (id)                                |

## Triggers

| Name          | Definition                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.party_email FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.party_email FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
