# next.lead_contact_draft

## Columns

| Name                | Type                     | Default           | Nullable | Extra Definition                        | Children | Parents                                                           | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | --------------------------------------- | -------- | ----------------------------------------------------------------- | ------- |
| approved            | boolean                  | false             | false    |                                         |          |                                                                   |         |
| body                | text                     |                   | false    |                                         |          |                                                                   |         |
| changed_at          | timestamp with time zone |                   | false    |                                         |          |                                                                   |         |
| changed_by_job      | text                     |                   | true     |                                         |          | [next.job](next.job.md)                                           |         |
| changed_by_user_id  | uuid                     |                   | true     |                                         |          | [next.app_user](next.app_user.md)                                 |         |
| changed_for_user_id | uuid                     |                   | true     |                                         |          | [next.app_user](next.app_user.md)                                 |         |
| created_at          | timestamp with time zone | now()             | false    |                                         |          |                                                                   |         |
| dispatchable        | boolean                  | false             | false    |                                         |          |                                                                   |         |
| id                  | uuid                     | gen_random_uuid() | false    |                                         |          |                                                                   |         |
| owner_user_id       | uuid                     |                   | true     |                                         |          | [next.app_user](next.app_user.md)                                 |         |
| party_id            | uuid                     |                   | false    |                                         |          | [next.party](next.party.md) [next.party_role](next.party_role.md) |         |
| requires_human_send | boolean                  | true              | false    |                                         |          |                                                                   |         |
| revision            | integer                  | 1                 | false    |                                         |          |                                                                   |         |
| role                | text                     |                   | false    | GENERATED ALWAYS AS 'lead'::text STORED |          | [next.party_role](next.party_role.md)                             |         |
| scheduled_for       | timestamp with time zone |                   | false    |                                         |          |                                                                   |         |
| subject             | text                     |                   | false    |                                         |          |                                                                   |         |
| time_zone           | text                     |                   | false    |                                         |          |                                                                   |         |

## Viewpoints

| Name                        | Definition                                             |
| --------------------------- | ------------------------------------------------------ |
| [Leads](viewpoint-leads.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                            | Type        | Definition                                                                                                                           |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| lead_contact_draft_approved_not_null            | n           | NOT NULL approved                                                                                                                    |
| lead_contact_draft_body_check                   | CHECK       | CHECK ((body ~ '\S'::text))                                                                                                          |
| lead_contact_draft_body_not_null                | n           | NOT NULL body                                                                                                                        |
| lead_contact_draft_changed_at_not_null          | n           | NOT NULL changed_at                                                                                                                  |
| lead_contact_draft_changed_by_a_user_or_a_job   | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| lead_contact_draft_changed_by_job_fkey          | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| lead_contact_draft_changed_by_user_id_fkey      | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| lead_contact_draft_changed_for_user_id_fkey     | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| lead_contact_draft_created_at_not_null          | n           | NOT NULL created_at                                                                                                                  |
| lead_contact_draft_dispatchable_check           | CHECK       | CHECK ((NOT dispatchable))                                                                                                           |
| lead_contact_draft_dispatchable_not_null        | n           | NOT NULL dispatchable                                                                                                                |
| lead_contact_draft_id_not_null                  | n           | NOT NULL id                                                                                                                          |
| lead_contact_draft_owner_user_id_fkey           | FOREIGN KEY | FOREIGN KEY (owner_user_id) REFERENCES app_user(id)                                                                                  |
| lead_contact_draft_party_id_fkey                | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                          |
| lead_contact_draft_party_id_key                 | UNIQUE      | UNIQUE (party_id)                                                                                                                    |
| lead_contact_draft_party_id_not_null            | n           | NOT NULL party_id                                                                                                                    |
| lead_contact_draft_party_id_role_fkey           | FOREIGN KEY | FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) DEFERRABLE INITIALLY DEFERRED                                     |
| lead_contact_draft_pkey                         | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| lead_contact_draft_requires_human_send_check    | CHECK       | CHECK (requires_human_send)                                                                                                          |
| lead_contact_draft_requires_human_send_not_null | n           | NOT NULL requires_human_send                                                                                                         |
| lead_contact_draft_revision_check               | CHECK       | CHECK ((revision >= 1))                                                                                                              |
| lead_contact_draft_revision_not_null            | n           | NOT NULL revision                                                                                                                    |
| lead_contact_draft_role_not_null                | n           | NOT NULL role                                                                                                                        |
| lead_contact_draft_scheduled_for_not_null       | n           | NOT NULL scheduled_for                                                                                                               |
| lead_contact_draft_subject_check                | CHECK       | CHECK ((subject ~ '\S'::text))                                                                                                       |
| lead_contact_draft_subject_not_null             | n           | NOT NULL subject                                                                                                                     |
| lead_contact_draft_time_zone_check              | CHECK       | CHECK ((time_zone ~ '\S'::text))                                                                                                     |
| lead_contact_draft_time_zone_not_null           | n           | NOT NULL time_zone                                                                                                                   |

## Indexes

| Name                            | Definition                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| lead_contact_draft_party_id_key | CREATE UNIQUE INDEX lead_contact_draft_party_id_key ON next.lead_contact_draft USING btree (party_id) |
| lead_contact_draft_pkey         | CREATE UNIQUE INDEX lead_contact_draft_pkey ON next.lead_contact_draft USING btree (id)               |

## Triggers

| Name                      | Definition                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| lead_contact_draft_review | CREATE TRIGGER lead_contact_draft_review BEFORE UPDATE ON next.lead_contact_draft FOR EACH ROW EXECUTE FUNCTION lead_contact_draft_review() |
| record_change             | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.lead_contact_draft FOR EACH ROW EXECUTE FUNCTION record_change('id')  |
| stamp_change              | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.lead_contact_draft FOR EACH ROW EXECUTE FUNCTION stamp_change()                 |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
