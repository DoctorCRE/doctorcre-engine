# next.lead_stage_move

## Columns

| Name                | Type                     | Default           | Nullable | Extra Definition                        | Children | Parents                                                                                                         | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | --------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- | ------- |
| activity_id         | uuid                     |                   | true     |                                         |          | [next.activity](next.activity.md) [next.activity_about](next.activity_about.md)                                 |         |
| changed_at          | timestamp with time zone |                   | false    |                                         |          |                                                                                                                 |         |
| changed_by_job      | text                     |                   | true     |                                         |          | [next.job](next.job.md)                                                                                         |         |
| changed_by_user_id  | uuid                     |                   | true     |                                         |          | [next.app_user](next.app_user.md)                                                                               |         |
| changed_for_user_id | uuid                     |                   | true     |                                         |          | [next.app_user](next.app_user.md)                                                                               |         |
| evidence_ref        | text                     |                   | true     |                                         |          |                                                                                                                 |         |
| from_stage          | text                     |                   | false    |                                         |          | [next.stage](next.stage.md)                                                                                     |         |
| id                  | uuid                     | gen_random_uuid() | false    |                                         |          |                                                                                                                 |         |
| party_id            | uuid                     |                   | false    |                                         |          | [next.activity_about](next.activity_about.md) [next.party](next.party.md) [next.party_role](next.party_role.md) |         |
| reason              | text                     |                   | true     |                                         |          |                                                                                                                 |         |
| role                | text                     |                   | false    | GENERATED ALWAYS AS 'lead'::text STORED |          | [next.party_role](next.party_role.md) [next.stage](next.stage.md)                                               |         |
| strength            | text                     |                   | false    |                                         |          |                                                                                                                 |         |
| to_stage            | text                     |                   | false    |                                         |          | [next.stage](next.stage.md)                                                                                     |         |

## Viewpoints

| Name                        | Definition                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| [Leads](viewpoint-leads.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                                         | Type        | Definition                                                                                                                           |
| ------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| lead_stage_move_activity_id_fkey                             | FOREIGN KEY | FOREIGN KEY (activity_id) REFERENCES activity(id)                                                                                    |
| lead_stage_move_activity_id_party_id_fkey                    | FOREIGN KEY | FOREIGN KEY (activity_id, party_id) REFERENCES activity_about(activity_id, party_id) DEFERRABLE INITIALLY DEFERRED                   |
| lead_stage_move_archive_reason                               | CHECK       | CHECK (((to_stage <> 'archived'::text) OR (reason IS NOT NULL)))                                                                     |
| lead_stage_move_changed_at_not_null                          | n           | NOT NULL changed_at                                                                                                                  |
| lead_stage_move_changed_by_a_user_or_a_job                   | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| lead_stage_move_changed_by_job_fkey                          | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| lead_stage_move_changed_by_user_id_fkey                      | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| lead_stage_move_changed_for_user_id_fkey                     | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| lead_stage_move_changes_stage                                | CHECK       | CHECK ((from_stage <> to_stage))                                                                                                     |
| lead_stage_move_evidence_ref_check                           | CHECK       | CHECK ((evidence_ref ~ '\S'::text))                                                                                                  |
| lead_stage_move_from_stage_not_null                          | n           | NOT NULL from_stage                                                                                                                  |
| lead_stage_move_has_evidence                                 | CHECK       | CHECK (((to_stage = 'archived'::text) OR ((activity_id IS NOT NULL) AND (evidence_ref IS NOT NULL))))                                |
| lead_stage_move_id_not_null                                  | n           | NOT NULL id                                                                                                                          |
| lead_stage_move_party_id_fkey                                | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                          |
| lead_stage_move_party_id_from_stage_to_stage_activity_id_key | UNIQUE      | UNIQUE (party_id, from_stage, to_stage, activity_id)                                                                                 |
| lead_stage_move_party_id_not_null                            | n           | NOT NULL party_id                                                                                                                    |
| lead_stage_move_party_id_role_fkey                           | FOREIGN KEY | FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) DEFERRABLE INITIALLY DEFERRED                                     |
| lead_stage_move_pkey                                         | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| lead_stage_move_reason_check                                 | CHECK       | CHECK ((reason ~ '\S'::text))                                                                                                        |
| lead_stage_move_role_from_stage_fkey                         | FOREIGN KEY | FOREIGN KEY (role, from_stage) REFERENCES stage(role, slug)                                                                          |
| lead_stage_move_role_not_null                                | n           | NOT NULL role                                                                                                                        |
| lead_stage_move_role_to_stage_fkey                           | FOREIGN KEY | FOREIGN KEY (role, to_stage) REFERENCES stage(role, slug)                                                                            |
| lead_stage_move_strength_check                               | CHECK       | CHECK ((strength = ANY (ARRAY['strong'::text, 'weak'::text])))                                                                       |
| lead_stage_move_strength_not_null                            | n           | NOT NULL strength                                                                                                                    |
| lead_stage_move_to_stage_not_null                            | n           | NOT NULL to_stage                                                                                                                    |

## Indexes

| Name                                                         | Definition                                                                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| lead_stage_move_party_id_from_stage_to_stage_activity_id_key | CREATE UNIQUE INDEX lead_stage_move_party_id_from_stage_to_stage_activity_id_key ON next.lead_stage_move USING btree (party_id, from_stage, to_stage, activity_id) |
| lead_stage_move_pkey                                         | CREATE UNIQUE INDEX lead_stage_move_pkey ON next.lead_stage_move USING btree (id)                                                                                  |

## Triggers

| Name                  | Definition                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| apply_lead_stage_move | CREATE TRIGGER apply_lead_stage_move AFTER INSERT ON next.lead_stage_move FOR EACH ROW EXECUTE FUNCTION apply_lead_stage_move()         |
| record_change         | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.lead_stage_move FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change          | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.lead_stage_move FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
