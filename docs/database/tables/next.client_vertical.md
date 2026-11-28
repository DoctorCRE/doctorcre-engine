# next.client_vertical

## Columns

| Name                | Type                     | Default        | Nullable | Children | Parents                               | Comment |
| ------------------- | ------------------------ | -------------- | -------- | -------- | ------------------------------------- | ------- |
| changed_at          | timestamp with time zone |                | false    |          |                                       |         |
| changed_by_job      | text                     |                | true     |          | [next.job](next.job.md)               |         |
| changed_by_user_id  | uuid                     |                | true     |          | [next.app_user](next.app_user.md)     |         |
| changed_for_user_id | uuid                     |                | true     |          | [next.app_user](next.app_user.md)     |         |
| created_at          | timestamp with time zone | now()          | false    |          |                                       |         |
| party_id            | uuid                     |                | false    |          | [next.party_role](next.party_role.md) |         |
| role                | text                     | 'client'::text | false    |          | [next.party_role](next.party_role.md) |         |
| subtype             | text                     |                | true     |          |                                       |         |
| vertical            | text                     |                | false    |          |                                       |         |

## Viewpoints

| Name                            | Definition                                             |
| ------------------------------- | ------------------------------------------------------ |
| [Clients](viewpoint-clients.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                       | Type        | Definition                                                                                                                           |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| client_vertical_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| client_vertical_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| client_vertical_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| client_vertical_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| client_vertical_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| client_vertical_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| client_vertical_party_id_not_null          | n           | NOT NULL party_id                                                                                                                    |
| client_vertical_party_id_role_fkey         | FOREIGN KEY | FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE                                                 |
| client_vertical_pkey                       | PRIMARY KEY | PRIMARY KEY (party_id)                                                                                                               |
| client_vertical_role_check                 | CHECK       | CHECK ((role = 'client'::text))                                                                                                      |
| client_vertical_role_not_null              | n           | NOT NULL role                                                                                                                        |
| client_vertical_subtype_check              | CHECK       | CHECK (((subtype = regexp_replace(subtype, '^\s+                                                                                     | \s+$'::text, ''::text, 'g'::text)) AND (subtype ~ '\S'::text)))  |
| client_vertical_vertical_check             | CHECK       | CHECK (((vertical = regexp_replace(vertical, '^\s+                                                                                   | \s+$'::text, ''::text, 'g'::text)) AND (vertical ~ '\S'::text))) |
| client_vertical_vertical_not_null          | n           | NOT NULL vertical                                                                                                                    |

## Indexes

| Name                 | Definition                                                                              |
| -------------------- | --------------------------------------------------------------------------------------- |
| client_vertical_pkey | CREATE UNIQUE INDEX client_vertical_pkey ON next.client_vertical USING btree (party_id) |

## Triggers

| Name          | Definition                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.client_vertical FOR EACH ROW EXECUTE FUNCTION record_change('party_id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.client_vertical FOR EACH ROW EXECUTE FUNCTION stamp_change()                      |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
