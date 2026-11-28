# next.client_research_fact

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                                         | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | ----------------------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                                 |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)                         |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md)               |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md)               |         |
| field               | text                     |         | false    |          |                                                 |         |
| research_id         | uuid                     |         | false    |          | [next.client_research](next.client_research.md) |         |
| value               | jsonb                    |         | false    |          |                                                 |         |

## Viewpoints

| Name                            | Definition                                                                  |
| ------------------------------- | --------------------------------------------------------------------------- |
| [Clients](viewpoint-clients.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                            | Type        | Definition                                                                                                                           |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| client_research_fact_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| client_research_fact_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| client_research_fact_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| client_research_fact_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| client_research_fact_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| client_research_fact_field_check                | CHECK       | CHECK (((field ~ '\S'::text) AND (field <> 'found'::text)))                                                                          |
| client_research_fact_field_not_null             | n           | NOT NULL field                                                                                                                       |
| client_research_fact_pkey                       | PRIMARY KEY | PRIMARY KEY (research_id, field)                                                                                                     |
| client_research_fact_research_id_fkey           | FOREIGN KEY | FOREIGN KEY (research_id) REFERENCES client_research(id)                                                                             |
| client_research_fact_research_id_not_null       | n           | NOT NULL research_id                                                                                                                 |
| client_research_fact_value_not_null             | n           | NOT NULL value                                                                                                                       |

## Indexes

| Name                      | Definition                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| client_research_fact_pkey | CREATE UNIQUE INDEX client_research_fact_pkey ON next.client_research_fact USING btree (research_id, field) |

## Triggers

| Name          | Definition                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.client_research_fact FOR EACH ROW EXECUTE FUNCTION record_change('research_id', 'field') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.client_research_fact FOR EACH ROW EXECUTE FUNCTION stamp_change()                                  |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
