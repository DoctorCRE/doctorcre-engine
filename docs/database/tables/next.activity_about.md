# next.activity_about

## Columns

| Name                | Type                     | Default | Nullable | Children                                                                                                                                                                                                                                                          | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| activity_id         | uuid                     |         | false    | [next.deal_phase_change](next.deal_phase_change.md) [next.lead_email_source](next.lead_email_source.md) [next.lead_stage_move](next.lead_stage_move.md) [next.next_step](next.next_step.md) [next.proposal](next.proposal.md) [next.tour_plan](next.tour_plan.md) | [next.activity](next.activity.md) |         |
| changed_at          | timestamp with time zone |         | false    |                                                                                                                                                                                                                                                                   |                                   |         |
| changed_by_job      | text                     |         | true     |                                                                                                                                                                                                                                                                   | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |                                                                                                                                                                                                                                                                   | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |                                                                                                                                                                                                                                                                   | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()   | false    |                                                                                                                                                                                                                                                                   |                                   |         |
| deal_id             | uuid                     |         | true     | [next.deal_phase_change](next.deal_phase_change.md) [next.next_step](next.next_step.md) [next.proposal](next.proposal.md) [next.tour_plan](next.tour_plan.md)                                                                                                     | [next.deal](next.deal.md)         |         |
| party_id            | uuid                     |         | true     | [next.lead_email_source](next.lead_email_source.md) [next.lead_stage_move](next.lead_stage_move.md) [next.proposal](next.proposal.md)                                                                                                                             | [next.party](next.party.md)       |         |
| property_id         | uuid                     |         | true     |                                                                                                                                                                                                                                                                   | [next.property](next.property.md) |         |

## Viewpoints

| Name                              | Definition                                             |
| --------------------------------- | ------------------------------------------------------ |
| [Activity](viewpoint-activity.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                                        | Type        | Definition                                                                                                                                                            |
| ----------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| activity_about_activity_deal_key                            | UNIQUE      | UNIQUE (activity_id, deal_id)                                                                                                                                         |
| activity_about_activity_id_deal_id_party_id_property_id_key | UNIQUE      | UNIQUE NULLS NOT DISTINCT (activity_id, deal_id, party_id, property_id)                                                                                               |
| activity_about_activity_id_fkey                             | FOREIGN KEY | FOREIGN KEY (activity_id) REFERENCES activity(id)                                                                                                                     |
| activity_about_activity_id_not_null                         | n           | NOT NULL activity_id                                                                                                                                                  |
| activity_about_activity_party_key                           | UNIQUE      | UNIQUE (activity_id, party_id)                                                                                                                                        |
| activity_about_changed_at_not_null                          | n           | NOT NULL changed_at                                                                                                                                                   |
| activity_about_changed_by_a_user_or_a_job                   | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                  |
| activity_about_changed_by_job_fkey                          | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                     |
| activity_about_changed_by_user_id_fkey                      | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                              |
| activity_about_changed_for_user_id_fkey                     | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                             |
| activity_about_created_at_not_null                          | n           | NOT NULL created_at                                                                                                                                                   |
| activity_about_deal_id_fkey                                 | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                                                             |
| activity_about_one_record                                   | CHECK       | CHECK ((num_nonnulls(deal_id, party_id, property_id) = 1))                                                                                                            |
| activity_about_party_id_fkey                                | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                                                           |
| activity_about_property_id_fkey                             | FOREIGN KEY | FOREIGN KEY (property_id) REFERENCES property(id)                                                                                                                     |
| email_about_a_record                                        | TRIGGER     | CREATE CONSTRAINT TRIGGER email_about_a_record AFTER DELETE ON next.activity_about DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION email_about_a_record() |

## Indexes

| Name                                                        | Definition                                                                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| activity_about_activity_deal_key                            | CREATE UNIQUE INDEX activity_about_activity_deal_key ON next.activity_about USING btree (activity_id, deal_id)                                                                      |
| activity_about_activity_id_deal_id_party_id_property_id_key | CREATE UNIQUE INDEX activity_about_activity_id_deal_id_party_id_property_id_key ON next.activity_about USING btree (activity_id, deal_id, party_id, property_id) NULLS NOT DISTINCT |
| activity_about_activity_party_key                           | CREATE UNIQUE INDEX activity_about_activity_party_key ON next.activity_about USING btree (activity_id, party_id)                                                                    |
| activity_about_by_party                                     | CREATE INDEX activity_about_by_party ON next.activity_about USING btree (party_id, activity_id) WHERE (party_id IS NOT NULL)                                                        |

## Triggers

| Name                 | Definition                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| email_about_a_record | CREATE CONSTRAINT TRIGGER email_about_a_record AFTER DELETE ON next.activity_about DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION email_about_a_record() |
| record_change        | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.activity_about FOR EACH ROW EXECUTE FUNCTION record_change()                                    |
| stamp_change         | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.activity_about FOR EACH ROW EXECUTE FUNCTION stamp_change()                                               |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
