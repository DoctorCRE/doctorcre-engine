# next.party_document

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()   | false    |          |                                   |         |
| document_id         | uuid                     |         | false    |          | [next.document](next.document.md) |         |
| party_id            | uuid                     |         | false    |          | [next.party](next.party.md)       |         |

## Viewpoints

| Name                                | Definition                                             |
| ----------------------------------- | ------------------------------------------------------ |
| [Documents](viewpoint-documents.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                      | Type        | Definition                                                                                                                           |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| party_document_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| party_document_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| party_document_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| party_document_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| party_document_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| party_document_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| party_document_document_id_fkey           | FOREIGN KEY | FOREIGN KEY (document_id) REFERENCES document(id)                                                                                    |
| party_document_document_id_not_null       | n           | NOT NULL document_id                                                                                                                 |
| party_document_party_id_fkey              | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                          |
| party_document_party_id_not_null          | n           | NOT NULL party_id                                                                                                                    |
| party_document_pkey                       | PRIMARY KEY | PRIMARY KEY (party_id, document_id)                                                                                                  |

## Indexes

| Name                | Definition                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| party_document_pkey | CREATE UNIQUE INDEX party_document_pkey ON next.party_document USING btree (party_id, document_id) |

## Triggers

| Name                  | Definition                                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| party_document_stored | CREATE TRIGGER party_document_stored BEFORE INSERT ON next.party_document FOR EACH ROW EXECUTE FUNCTION party_document_stored()                             |
| record_change         | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.party_document FOR EACH ROW EXECUTE FUNCTION record_change('party_id', 'document_id') |
| stamp_change          | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.party_document FOR EACH ROW EXECUTE FUNCTION stamp_change()                                     |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
