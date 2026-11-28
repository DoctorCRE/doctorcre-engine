# next.offer_document

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()   | false    |          |                                   |         |
| document_id         | uuid                     |         | false    |          | [next.document](next.document.md) |         |
| offer_id            | uuid                     |         | false    |          | [next.offer](next.offer.md)       |         |

## Viewpoints

| Name                          | Definition                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| [Offers](viewpoint-offers.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                      | Type        | Definition                                                                                                                           |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| offer_document_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| offer_document_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| offer_document_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| offer_document_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| offer_document_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| offer_document_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| offer_document_document_id_fkey           | FOREIGN KEY | FOREIGN KEY (document_id) REFERENCES document(id)                                                                                    |
| offer_document_document_id_not_null       | n           | NOT NULL document_id                                                                                                                 |
| offer_document_offer_id_fkey              | FOREIGN KEY | FOREIGN KEY (offer_id) REFERENCES offer(id)                                                                                          |
| offer_document_offer_id_not_null          | n           | NOT NULL offer_id                                                                                                                    |
| offer_document_pkey                       | PRIMARY KEY | PRIMARY KEY (offer_id, document_id)                                                                                                  |

## Indexes

| Name                | Definition                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| offer_document_pkey | CREATE UNIQUE INDEX offer_document_pkey ON next.offer_document USING btree (offer_id, document_id) |

## Triggers

| Name          | Definition                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.offer_document FOR EACH ROW EXECUTE FUNCTION record_change('offer_id', 'document_id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.offer_document FOR EACH ROW EXECUTE FUNCTION stamp_change()                                     |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
