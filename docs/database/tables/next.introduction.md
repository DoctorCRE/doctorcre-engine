# next.introduction

## Columns

| Name                  | Type                     | Default           | Nullable | Children | Parents                               | Comment |
| --------------------- | ------------------------ | ----------------- | -------- | -------- | ------------------------------------- | ------- |
| changed_at            | timestamp with time zone |                   | false    |          |                                       |         |
| changed_by_job        | text                     |                   | true     |          | [next.job](next.job.md)               |         |
| changed_by_user_id    | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)     |         |
| changed_for_user_id   | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)     |         |
| created_at            | timestamp with time zone | now()             | false    |          |                                       |         |
| deal_id               | uuid                     |                   | true     |          | [next.deal](next.deal.md)             |         |
| id                    | uuid                     | gen_random_uuid() | false    |          |                                       |         |
| introduced_by_user_id | uuid                     |                   | true     |          | [next.app_user](next.app_user.md)     |         |
| introduced_on         | date                     |                   | true     |          |                                       |         |
| introduced_party_id   | uuid                     |                   | false    |          | [next.party](next.party.md)           |         |
| made_by               | text                     |                   | false    |          |                                       |         |
| note                  | text                     |                   | true     |          |                                       |         |
| vendor_id             | uuid                     |                   | false    |          | [next.party_role](next.party_role.md) |         |
| vendor_role           | text                     | 'vendor'::text    | false    |          | [next.party_role](next.party_role.md) |         |

## Viewpoints

| Name                                        | Definition                                             |
| ------------------------------------------- | ------------------------------------------------------ |
| [Relationships](viewpoint-relationships.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                      | Type        | Definition                                                                                                                           |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| introduction_changed_at_not_null          | n           | NOT NULL changed_at                                                                                                                  |
| introduction_changed_by_a_user_or_a_job   | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| introduction_changed_by_job_fkey          | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| introduction_changed_by_user_id_fkey      | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| introduction_changed_for_user_id_fkey     | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| introduction_created_at_not_null          | n           | NOT NULL created_at                                                                                                                  |
| introduction_deal_id_fkey                 | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                            |
| introduction_id_not_null                  | n           | NOT NULL id                                                                                                                          |
| introduction_introduced_by_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (introduced_by_user_id) REFERENCES app_user(id)                                                                          |
| introduction_introduced_party_id_fkey     | FOREIGN KEY | FOREIGN KEY (introduced_party_id) REFERENCES party(id)                                                                               |
| introduction_introduced_party_id_not_null | n           | NOT NULL introduced_party_id                                                                                                         |
| introduction_made_by_check                | CHECK       | CHECK ((made_by = ANY (ARRAY['vendor'::text, 'team'::text])))                                                                        |
| introduction_made_by_not_null             | n           | NOT NULL made_by                                                                                                                     |
| introduction_note_check                   | CHECK       | CHECK ((note ~ '\S'::text))                                                                                                          |
| introduction_of_someone_else              | CHECK       | CHECK ((introduced_party_id <> vendor_id))                                                                                           |
| introduction_pkey                         | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| introduction_team_names_its_user          | CHECK       | CHECK (((made_by = 'team'::text) = (introduced_by_user_id IS NOT NULL)))                                                             |
| introduction_vendor_id_not_null           | n           | NOT NULL vendor_id                                                                                                                   |
| introduction_vendor_id_vendor_role_fkey   | FOREIGN KEY | FOREIGN KEY (vendor_id, vendor_role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE                                         |
| introduction_vendor_role_check            | CHECK       | CHECK ((vendor_role = 'vendor'::text))                                                                                               |
| introduction_vendor_role_not_null         | n           | NOT NULL vendor_role                                                                                                                 |

## Indexes

| Name              | Definition                                                                  |
| ----------------- | --------------------------------------------------------------------------- |
| introduction_pkey | CREATE UNIQUE INDEX introduction_pkey ON next.introduction USING btree (id) |

## Triggers

| Name          | Definition                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.introduction FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.introduction FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
