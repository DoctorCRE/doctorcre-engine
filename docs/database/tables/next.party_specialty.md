# next.party_specialty

## Columns

| Name                | Type                     | Default | Nullable | Extra Definition                          | Children | Parents                             | Comment |
| ------------------- | ------------------------ | ------- | -------- | ----------------------------------------- | -------- | ----------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |                                           |          |                                     |         |
| changed_by_job      | text                     |         | true     |                                           |          | [next.job](next.job.md)             |         |
| changed_by_user_id  | uuid                     |         | true     |                                           |          | [next.app_user](next.app_user.md)   |         |
| changed_for_user_id | uuid                     |         | true     |                                           |          | [next.app_user](next.app_user.md)   |         |
| created_at          | timestamp with time zone | now()   | false    |                                           |          |                                     |         |
| person_id           | uuid                     |         | false    |                                           |          | [next.party](next.party.md)         |         |
| person_kind         | text                     |         | false    | GENERATED ALWAYS AS 'person'::text STORED |          | [next.party](next.party.md)         |         |
| specialty           | text                     |         | false    |                                           |          | [next.specialty](next.specialty.md) |         |

## Viewpoints

| Name                                        | Definition                                             |
| ------------------------------------------- | ------------------------------------------------------ |
| [Relationships](viewpoint-relationships.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                       | Type        | Definition                                                                                                                           |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| party_specialty_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| party_specialty_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| party_specialty_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| party_specialty_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| party_specialty_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| party_specialty_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| party_specialty_person_id_not_null         | n           | NOT NULL person_id                                                                                                                   |
| party_specialty_person_id_person_kind_fkey | FOREIGN KEY | FOREIGN KEY (person_id, person_kind) REFERENCES party(id, kind)                                                                      |
| party_specialty_person_kind_not_null       | n           | NOT NULL person_kind                                                                                                                 |
| party_specialty_pkey                       | PRIMARY KEY | PRIMARY KEY (person_id, specialty)                                                                                                   |
| party_specialty_specialty_fkey             | FOREIGN KEY | FOREIGN KEY (specialty) REFERENCES specialty(slug)                                                                                   |
| party_specialty_specialty_not_null         | n           | NOT NULL specialty                                                                                                                   |

## Indexes

| Name                 | Definition                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| party_specialty_pkey | CREATE UNIQUE INDEX party_specialty_pkey ON next.party_specialty USING btree (person_id, specialty) |

## Triggers

| Name          | Definition                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.party_specialty FOR EACH ROW EXECUTE FUNCTION record_change('person_id', 'specialty') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.party_specialty FOR EACH ROW EXECUTE FUNCTION stamp_change()                                    |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
