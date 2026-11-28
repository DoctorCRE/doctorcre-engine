# next.activity

## Columns

| Name                    | Type                     | Default           | Nullable | Children                                                                                                                                                                                                                                                                                | Parents                           | Comment |
| ----------------------- | ------------------------ | ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| calendar_review_key     | text                     |                   | true     |                                                                                                                                                                                                                                                                                         |                                   |         |
| calendar_review_user_id | uuid                     |                   | true     |                                                                                                                                                                                                                                                                                         | [next.app_user](next.app_user.md) |         |
| call_owner_user_id      | uuid                     |                   | true     |                                                                                                                                                                                                                                                                                         | [next.app_user](next.app_user.md) |         |
| changed_at              | timestamp with time zone |                   | false    |                                                                                                                                                                                                                                                                                         |                                   |         |
| changed_by_job          | text                     |                   | true     |                                                                                                                                                                                                                                                                                         | [next.job](next.job.md)           |         |
| changed_by_user_id      | uuid                     |                   | true     |                                                                                                                                                                                                                                                                                         | [next.app_user](next.app_user.md) |         |
| changed_for_user_id     | uuid                     |                   | true     |                                                                                                                                                                                                                                                                                         | [next.app_user](next.app_user.md) |         |
| from_party_id           | uuid                     |                   | true     |                                                                                                                                                                                                                                                                                         | [next.party](next.party.md)       |         |
| happened_at             | timestamp with time zone |                   | false    |                                                                                                                                                                                                                                                                                         |                                   |         |
| id                      | uuid                     | gen_random_uuid() | false    | [next.activity_about](next.activity_about.md) [next.deal_phase_change](next.deal_phase_change.md) [next.email](next.email.md) [next.lead_stage_move](next.lead_stage_move.md) [next.next_step](next.next_step.md) [next.proposal](next.proposal.md) [next.tour_plan](next.tour_plan.md) |                                   |         |
| kind                    | text                     |                   | false    | [next.deal_phase_change](next.deal_phase_change.md) [next.email](next.email.md) [next.next_step](next.next_step.md) [next.proposal](next.proposal.md) [next.tour_plan](next.tour_plan.md)                                                                                               |                                   |         |
| reached                 | boolean                  |                   | true     |                                                                                                                                                                                                                                                                                         |                                   |         |
| summary                 | text                     |                   | true     |                                                                                                                                                                                                                                                                                         |                                   |         |

## Viewpoints

| Name                              | Definition                                             |
| --------------------------------- | ------------------------------------------------------ |
| [Activity](viewpoint-activity.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                                     | Type        | Definition                                                                                                                                    |
| -------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| activity_calendar_review                                 | CHECK       | CHECK ((((calendar_review_key IS NULL) = (calendar_review_user_id IS NULL)) AND ((calendar_review_key IS NULL) OR (kind = 'meeting'::text)))) |
| activity_calendar_review_key_check                       | CHECK       | CHECK ((calendar_review_key ~ '^[a-f0-9]{16}$'::text))                                                                                        |
| activity_calendar_review_user_id_calendar_review_key_key | UNIQUE      | UNIQUE (calendar_review_user_id, calendar_review_key)                                                                                         |
| activity_calendar_review_user_id_fkey                    | FOREIGN KEY | FOREIGN KEY (calendar_review_user_id) REFERENCES app_user(id)                                                                                 |
| activity_call_owner_user_id_fkey                         | FOREIGN KEY | FOREIGN KEY (call_owner_user_id) REFERENCES app_user(id)                                                                                      |
| activity_changed_at_not_null                             | n           | NOT NULL changed_at                                                                                                                           |
| activity_changed_by_a_user_or_a_job                      | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))          |
| activity_changed_by_job_fkey                             | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                             |
| activity_changed_by_user_id_fkey                         | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                      |
| activity_changed_for_user_id_fkey                        | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                     |
| activity_from_party_id_fkey                              | FOREIGN KEY | FOREIGN KEY (from_party_id) REFERENCES party(id)                                                                                              |
| activity_happened_at_not_null                            | n           | NOT NULL happened_at                                                                                                                          |
| activity_id_kind_key                                     | UNIQUE      | UNIQUE (id, kind)                                                                                                                             |
| activity_id_not_null                                     | n           | NOT NULL id                                                                                                                                   |
| activity_kind_check                                      | CHECK       | CHECK ((kind = ANY (ARRAY['email'::text, 'call'::text, 'meeting'::text, 'note'::text])))                                                      |
| activity_kind_not_null                                   | n           | NOT NULL kind                                                                                                                                 |
| activity_pkey                                            | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                              |

## Indexes

| Name                                                     | Definition                                                                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| activity_calendar_review_user_id_calendar_review_key_key | CREATE UNIQUE INDEX activity_calendar_review_user_id_calendar_review_key_key ON next.activity USING btree (calendar_review_user_id, calendar_review_key) |
| activity_id_kind_key                                     | CREATE UNIQUE INDEX activity_id_kind_key ON next.activity USING btree (id, kind)                                                                         |
| activity_pkey                                            | CREATE UNIQUE INDEX activity_pkey ON next.activity USING btree (id)                                                                                      |

## Triggers

| Name                  | Definition                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| record_change         | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.activity FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change          | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.activity FOR EACH ROW EXECUTE FUNCTION stamp_change()                |
| zz_keep_call_recorder | CREATE TRIGGER zz_keep_call_recorder BEFORE INSERT OR UPDATE ON next.activity FOR EACH ROW EXECUTE FUNCTION keep_call_recorder() |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
