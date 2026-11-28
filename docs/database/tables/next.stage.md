# next.stage

## Columns

| Name                | Type                     | Default | Nullable | Children                                                                                                                | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |                                                                                                                         |                                   |         |
| changed_by_job      | text                     |         | true     |                                                                                                                         | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |                                                                                                                         | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |                                                                                                                         | [next.app_user](next.app_user.md) |         |
| label               | text                     |         | false    |                                                                                                                         |                                   |         |
| role                | text                     |         | false    | [next.lead_stage_move](next.lead_stage_move.md) [next.party_role](next.party_role.md) [next.proposal](next.proposal.md) | [next.role](next.role.md)         |         |
| slug                | text                     |         | false    | [next.lead_stage_move](next.lead_stage_move.md) [next.party_role](next.party_role.md) [next.proposal](next.proposal.md) |                                   |         |

## Viewpoints

| Name                        | Definition                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| [Deals](viewpoint-deals.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                             | Type        | Definition                                                                                                                           |
| -------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| stage_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| stage_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| stage_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| stage_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| stage_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| stage_label_not_null             | n           | NOT NULL label                                                                                                                       |
| stage_pkey                       | PRIMARY KEY | PRIMARY KEY (role, slug)                                                                                                             |
| stage_role_fkey                  | FOREIGN KEY | FOREIGN KEY (role) REFERENCES role(slug)                                                                                             |
| stage_role_not_null              | n           | NOT NULL role                                                                                                                        |
| stage_slug_not_null              | n           | NOT NULL slug                                                                                                                        |

## Indexes

| Name       | Definition                                                            |
| ---------- | --------------------------------------------------------------------- |
| stage_pkey | CREATE UNIQUE INDEX stage_pkey ON next.stage USING btree (role, slug) |

## Triggers

| Name          | Definition                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.stage FOR EACH ROW EXECUTE FUNCTION record_change('role', 'slug') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.stage FOR EACH ROW EXECUTE FUNCTION stamp_change()                          |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
