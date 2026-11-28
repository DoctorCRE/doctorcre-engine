# next.role

## Columns

| Name                | Type                     | Default | Nullable | Children                                                                                                                                                        | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| category_of         | text                     |         | true     |                                                                                                                                                                 |                                   |         |
| changed_at          | timestamp with time zone |         | false    |                                                                                                                                                                 |                                   |         |
| changed_by_job      | text                     |         | true     |                                                                                                                                                                 | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |                                                                                                                                                                 | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |                                                                                                                                                                 | [next.app_user](next.app_user.md) |         |
| label               | text                     |         | false    |                                                                                                                                                                 |                                   |         |
| slug                | text                     |         | false    | [next.deal_party](next.deal_party.md) [next.imported_deal_party](next.imported_deal_party.md) [next.party_role](next.party_role.md) [next.stage](next.stage.md) |                                   |         |

## Viewpoints

| Name                                        | Definition                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| [Relationships](viewpoint-relationships.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                            | Type        | Definition                                                                                                                           |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| role_category_of_check          | CHECK       | CHECK ((category_of = 'vendor'::text))                                                                                               |
| role_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| role_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| role_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| role_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| role_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| role_label_not_null             | n           | NOT NULL label                                                                                                                       |
| role_pkey                       | PRIMARY KEY | PRIMARY KEY (slug)                                                                                                                   |
| role_slug_not_null              | n           | NOT NULL slug                                                                                                                        |

## Indexes

| Name      | Definition                                                    |
| --------- | ------------------------------------------------------------- |
| role_pkey | CREATE UNIQUE INDEX role_pkey ON next.role USING btree (slug) |

## Triggers

| Name          | Definition                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.role FOR EACH ROW EXECUTE FUNCTION record_change('slug') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.role FOR EACH ROW EXECUTE FUNCTION stamp_change()                  |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
