# next.lease

## Columns

| Name                | Type                     | Default           | Nullable | Children                                                                                                      | Parents                                                                                                     | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------- |
| changed_at          | timestamp with time zone |                   | false    |                                                                                                               |                                                                                                             |         |
| changed_by_job      | text                     |                   | true     |                                                                                                               | [next.job](next.job.md)                                                                                     |         |
| changed_by_user_id  | uuid                     |                   | true     |                                                                                                               | [next.app_user](next.app_user.md)                                                                           |         |
| changed_for_user_id | uuid                     |                   | true     |                                                                                                               | [next.app_user](next.app_user.md)                                                                           |         |
| client_role         | text                     | 'client'::text    | false    |                                                                                                               | [next.deal_party](next.deal_party.md)                                                                       |         |
| created_at          | timestamp with time zone | now()             | false    |                                                                                                               |                                                                                                             |         |
| deal_id             | uuid                     |                   | true     |                                                                                                               | [next.deal](next.deal.md) [next.deal_party](next.deal_party.md) [next.deal_property](next.deal_property.md) |         |
| id                  | uuid                     | gen_random_uuid() | false    | [next.deal](next.deal.md) [next.lease_suite](next.lease_suite.md) [next.lease_version](next.lease_version.md) |                                                                                                             |         |
| party_id            | uuid                     |                   | false    |                                                                                                               | [next.deal_party](next.deal_party.md) [next.party](next.party.md)                                           |         |
| property_id         | uuid                     |                   | false    | [next.lease_suite](next.lease_suite.md)                                                                       | [next.deal_property](next.deal_property.md) [next.property](next.property.md)                               |         |

## Viewpoints

| Name                          | Definition                                             |
| ----------------------------- | ------------------------------------------------------ |
| [Leases](viewpoint-leases.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                    | Type        | Definition                                                                                                                           |
| --------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| lease_changed_at_not_null               | n           | NOT NULL changed_at                                                                                                                  |
| lease_changed_by_a_user_or_a_job        | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| lease_changed_by_job_fkey               | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| lease_changed_by_user_id_fkey           | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| lease_changed_for_user_id_fkey          | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| lease_client_role_check                 | CHECK       | CHECK ((client_role = 'client'::text))                                                                                               |
| lease_client_role_not_null              | n           | NOT NULL client_role                                                                                                                 |
| lease_created_at_not_null               | n           | NOT NULL created_at                                                                                                                  |
| lease_deal_id_fkey                      | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                            |
| lease_deal_id_key                       | UNIQUE      | UNIQUE (deal_id)                                                                                                                     |
| lease_deal_id_party_id_client_role_fkey | FOREIGN KEY | FOREIGN KEY (deal_id, party_id, client_role) REFERENCES deal_party(deal_id, party_id, role) ON UPDATE CASCADE                        |
| lease_deal_id_property_id_fkey          | FOREIGN KEY | FOREIGN KEY (deal_id, property_id) REFERENCES deal_property(deal_id, property_id)                                                    |
| lease_id_not_null                       | n           | NOT NULL id                                                                                                                          |
| lease_id_property_id_key                | UNIQUE      | UNIQUE (id, property_id)                                                                                                             |
| lease_party_id_fkey                     | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                          |
| lease_party_id_not_null                 | n           | NOT NULL party_id                                                                                                                    |
| lease_pkey                              | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| lease_property_id_fkey                  | FOREIGN KEY | FOREIGN KEY (property_id) REFERENCES property(id)                                                                                    |
| lease_property_id_not_null              | n           | NOT NULL property_id                                                                                                                 |

## Indexes

| Name                     | Definition                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| lease_deal_id_key        | CREATE UNIQUE INDEX lease_deal_id_key ON next.lease USING btree (deal_id)                |
| lease_id_property_id_key | CREATE UNIQUE INDEX lease_id_property_id_key ON next.lease USING btree (id, property_id) |
| lease_pkey               | CREATE UNIQUE INDEX lease_pkey ON next.lease USING btree (id)                            |

## Triggers

| Name          | Definition                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.lease FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.lease FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
