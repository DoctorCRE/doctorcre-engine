# next.client

## Columns

| Name                | Type                     | Default        | Nullable | Children                                                                        | Parents                                 | Comment |
| ------------------- | ------------------------ | -------------- | -------- | ------------------------------------------------------------------------------- | --------------------------------------- | ------- |
| changed_at          | timestamp with time zone |                | false    |                                                                                 |                                         |         |
| changed_by_job      | text                     |                | true     |                                                                                 | [next.job](next.job.md)                 |         |
| changed_by_user_id  | uuid                     |                | true     |                                                                                 | [next.app_user](next.app_user.md)       |         |
| changed_for_user_id | uuid                     |                | true     |                                                                                 | [next.app_user](next.app_user.md)       |         |
| client_type         | text                     |                | true     |                                                                                 | [next.client_type](next.client_type.md) |         |
| created_at          | timestamp with time zone | now()          | false    |                                                                                 |                                         |         |
| owner_user_id       | uuid                     |                | true     |                                                                                 | [next.app_user](next.app_user.md)       |         |
| party_id            | uuid                     |                | false    | [next.client_brand](next.client_brand.md) [next.party_role](next.party_role.md) | [next.party_role](next.party_role.md)   |         |
| role                | text                     | 'client'::text | false    |                                                                                 | [next.party_role](next.party_role.md)   |         |
| status              | text                     | 'roster'::text | false    |                                                                                 |                                         |         |

## Viewpoints

| Name                            | Definition                                             |
| ------------------------------- | ------------------------------------------------------ |
| [Clients](viewpoint-clients.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                              | Type        | Definition                                                                                                                           |
| --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| client_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| client_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| client_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| client_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| client_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| client_client_type_fkey           | FOREIGN KEY | FOREIGN KEY (client_type) REFERENCES client_type(slug)                                                                               |
| client_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| client_owner_user_id_fkey         | FOREIGN KEY | FOREIGN KEY (owner_user_id) REFERENCES app_user(id)                                                                                  |
| client_party_id_not_null          | n           | NOT NULL party_id                                                                                                                    |
| client_party_id_role_fkey         | FOREIGN KEY | FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE                                                 |
| client_pkey                       | PRIMARY KEY | PRIMARY KEY (party_id)                                                                                                               |
| client_role_check                 | CHECK       | CHECK ((role = 'client'::text))                                                                                                      |
| client_role_not_null              | n           | NOT NULL role                                                                                                                        |
| client_status_check               | CHECK       | CHECK ((status = ANY (ARRAY['roster'::text, 'cold'::text, 'engaged'::text, 'paused'::text])))                                        |
| client_status_not_null            | n           | NOT NULL status                                                                                                                      |

## Indexes

| Name        | Definition                                                            |
| ----------- | --------------------------------------------------------------------- |
| client_pkey | CREATE UNIQUE INDEX client_pkey ON next.client USING btree (party_id) |

## Triggers

| Name          | Definition                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.client FOR EACH ROW EXECUTE FUNCTION record_change('party_id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.client FOR EACH ROW EXECUTE FUNCTION stamp_change()                      |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
