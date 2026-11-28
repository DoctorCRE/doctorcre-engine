# next.do_not_contact

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()   | false    |          |                                   |         |
| party_id            | uuid                     |         | false    |          | [next.party](next.party.md)       |         |
| reason              | text                     |         | false    |          |                                   |         |
| until_date          | date                     |         | true     |          |                                   |         |

## Viewpoints

| Name                          | Definition                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| [People](viewpoint-people.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                      | Type        | Definition                                                                                                                           |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| do_not_contact_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| do_not_contact_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| do_not_contact_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| do_not_contact_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| do_not_contact_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| do_not_contact_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| do_not_contact_party_id_fkey              | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                          |
| do_not_contact_party_id_not_null          | n           | NOT NULL party_id                                                                                                                    |
| do_not_contact_pkey                       | PRIMARY KEY | PRIMARY KEY (party_id)                                                                                                               |
| do_not_contact_reason_check               | CHECK       | CHECK ((reason ~ '\S'::text))                                                                                                        |
| do_not_contact_reason_not_null            | n           | NOT NULL reason                                                                                                                      |

## Indexes

| Name                | Definition                                                                            |
| ------------------- | ------------------------------------------------------------------------------------- |
| do_not_contact_pkey | CREATE UNIQUE INDEX do_not_contact_pkey ON next.do_not_contact USING btree (party_id) |

## Triggers

| Name          | Definition                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.do_not_contact FOR EACH ROW EXECUTE FUNCTION record_change('party_id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.do_not_contact FOR EACH ROW EXECUTE FUNCTION stamp_change()                      |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
