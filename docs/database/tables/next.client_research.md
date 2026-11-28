# next.client_research

## Columns

| Name                | Type                     | Default           | Nullable | Children                                                  | Parents                               | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | --------------------------------------------------------- | ------------------------------------- | ------- |
| changed_at          | timestamp with time zone |                   | false    |                                                           |                                       |         |
| changed_by_job      | text                     |                   | true     |                                                           | [next.job](next.job.md)               |         |
| changed_by_user_id  | uuid                     |                   | true     |                                                           | [next.app_user](next.app_user.md)     |         |
| changed_for_user_id | uuid                     |                   | true     |                                                           | [next.app_user](next.app_user.md)     |         |
| expires_on          | date                     |                   | true     |                                                           |                                       |         |
| found               | boolean                  |                   | false    |                                                           |                                       |         |
| id                  | uuid                     | gen_random_uuid() | false    | [next.client_research_fact](next.client_research_fact.md) |                                       |         |
| kind                | text                     |                   | false    |                                                           |                                       |         |
| observed_at         | timestamp with time zone |                   | false    |                                                           |                                       |         |
| party_id            | uuid                     |                   | false    |                                                           | [next.party_role](next.party_role.md) |         |
| role                | text                     | 'client'::text    | false    |                                                           | [next.party_role](next.party_role.md) |         |
| source              | text                     |                   | false    |                                                           |                                       |         |

## Viewpoints

| Name                            | Definition                                             |
| ------------------------------- | ------------------------------------------------------ |
| [Clients](viewpoint-clients.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                       | Type        | Definition                                                                                                                           |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| client_research_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| client_research_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| client_research_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| client_research_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| client_research_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| client_research_expires_on_check           | CHECK       | CHECK (isfinite(expires_on))                                                                                                         |
| client_research_found_not_null             | n           | NOT NULL found                                                                                                                       |
| client_research_id_not_null                | n           | NOT NULL id                                                                                                                          |
| client_research_kind_check                 | CHECK       | CHECK ((kind ~ '\S'::text))                                                                                                          |
| client_research_kind_not_null              | n           | NOT NULL kind                                                                                                                        |
| client_research_observed_at_check          | CHECK       | CHECK (isfinite(observed_at))                                                                                                        |
| client_research_observed_at_not_null       | n           | NOT NULL observed_at                                                                                                                 |
| client_research_party_id_not_null          | n           | NOT NULL party_id                                                                                                                    |
| client_research_party_id_role_fkey         | FOREIGN KEY | FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE                                                 |
| client_research_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| client_research_role_check                 | CHECK       | CHECK ((role = 'client'::text))                                                                                                      |
| client_research_role_not_null              | n           | NOT NULL role                                                                                                                        |
| client_research_source_check               | CHECK       | CHECK ((source ~ '\S'::text))                                                                                                        |
| client_research_source_not_null            | n           | NOT NULL source                                                                                                                      |

## Indexes

| Name                  | Definition                                                                        |
| --------------------- | --------------------------------------------------------------------------------- |
| client_research_party | CREATE INDEX client_research_party ON next.client_research USING btree (party_id) |
| client_research_pkey  | CREATE UNIQUE INDEX client_research_pkey ON next.client_research USING btree (id) |

## Triggers

| Name          | Definition                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.client_research FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.client_research FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
