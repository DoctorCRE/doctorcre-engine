# next.candidate

## Columns

| Name                  | Type                     | Default            | Nullable | Extra Definition                                                                                                                    | Children                          | Parents                                                           | Comment |
| --------------------- | ------------------------ | ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------- | ------- |
| changed_at            | timestamp with time zone |                    | false    |                                                                                                                                     |                                   |                                                                   |         |
| changed_by_job        | text                     |                    | true     |                                                                                                                                     |                                   | [next.job](next.job.md)                                           |         |
| changed_by_user_id    | uuid                     |                    | true     |                                                                                                                                     |                                   | [next.app_user](next.app_user.md)                                 |         |
| changed_for_user_id   | uuid                     |                    | true     |                                                                                                                                     |                                   | [next.app_user](next.app_user.md)                                 |         |
| created_at            | timestamp with time zone | now()              | false    |                                                                                                                                     |                                   |                                                                   |         |
| estimated_lease_on    | date                     |                    | true     |                                                                                                                                     |                                   |                                                                   |         |
| id                    | uuid                     | gen_random_uuid()  | false    |                                                                                                                                     | [next.proposal](next.proposal.md) |                                                                   |         |
| lead_role             | text                     |                    | true     | GENERATED ALWAYS AS <br />CASE<br />    WHEN (status = 'promoted'::text) THEN 'lead'::text<br />    ELSE NULL::text<br />END STORED |                                   | [next.party_role](next.party_role.md)                             |         |
| lease_estimate_source | text                     |                    | true     |                                                                                                                                     |                                   |                                                                   |         |
| name                  | text                     |                    | false    |                                                                                                                                     |                                   |                                                                   |         |
| promoted_party_id     | uuid                     |                    | true     |                                                                                                                                     |                                   | [next.party](next.party.md) [next.party_role](next.party_role.md) |         |
| qualification         | text                     |                    | false    |                                                                                                                                     |                                   |                                                                   |         |
| reason                | text                     |                    | true     |                                                                                                                                     |                                   |                                                                   |         |
| source                | text                     |                    | false    |                                                                                                                                     |                                   |                                                                   |         |
| source_key            | text                     |                    | false    |                                                                                                                                     |                                   |                                                                   |         |
| source_row            | jsonb                    |                    | false    |                                                                                                                                     |                                   |                                                                   |         |
| status                | text                     | 'unreviewed'::text | false    |                                                                                                                                     |                                   |                                                                   |         |

## Viewpoints

| Name                        | Definition                                             |
| --------------------------- | ------------------------------------------------------ |
| [Leads](viewpoint-leads.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                       | Type        | Definition                                                                                                                           |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| candidate_changed_at_not_null              | n           | NOT NULL changed_at                                                                                                                  |
| candidate_changed_by_a_user_or_a_job       | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| candidate_changed_by_job_fkey              | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| candidate_changed_by_user_id_fkey          | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| candidate_changed_for_user_id_fkey         | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| candidate_created_at_not_null              | n           | NOT NULL created_at                                                                                                                  |
| candidate_estimate_has_source              | CHECK       | CHECK (((estimated_lease_on IS NULL) = (lease_estimate_source IS NULL)))                                                             |
| candidate_id_not_null                      | n           | NOT NULL id                                                                                                                          |
| candidate_lease_estimate_source_check      | CHECK       | CHECK ((lease_estimate_source ~ '\S'::text))                                                                                         |
| candidate_name_check                       | CHECK       | CHECK ((name ~ '\S'::text))                                                                                                          |
| candidate_name_not_null                    | n           | NOT NULL name                                                                                                                        |
| candidate_pkey                             | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| candidate_promoted_has_lead                | CHECK       | CHECK (((status = 'promoted'::text) = (promoted_party_id IS NOT NULL)))                                                              |
| candidate_promoted_party_id_fkey           | FOREIGN KEY | FOREIGN KEY (promoted_party_id) REFERENCES party(id)                                                                                 |
| candidate_promoted_party_id_lead_role_fkey | FOREIGN KEY | FOREIGN KEY (promoted_party_id, lead_role) REFERENCES party_role(party_id, role) DEFERRABLE INITIALLY DEFERRED                       |
| candidate_qualification_check              | CHECK       | CHECK ((qualification ~ '\S'::text))                                                                                                 |
| candidate_qualification_not_null           | n           | NOT NULL qualification                                                                                                               |
| candidate_reason_check                     | CHECK       | CHECK ((reason ~ '\S'::text))                                                                                                        |
| candidate_rejection_has_reason             | CHECK       | CHECK (((status = ANY (ARRAY['declined'::text, 'suppressed'::text])) = (reason IS NOT NULL)))                                        |
| candidate_source_check                     | CHECK       | CHECK (((source = btrim(source)) AND (source ~ '\S'::text)))                                                                         |
| candidate_source_key_check                 | CHECK       | CHECK (((source_key = btrim(source_key)) AND (source_key ~ '\S'::text)))                                                             |
| candidate_source_key_not_null              | n           | NOT NULL source_key                                                                                                                  |
| candidate_source_not_null                  | n           | NOT NULL source                                                                                                                      |
| candidate_source_row_check                 | CHECK       | CHECK ((jsonb_typeof(source_row) = 'object'::text))                                                                                  |
| candidate_source_row_not_null              | n           | NOT NULL source_row                                                                                                                  |
| candidate_source_source_key_key            | UNIQUE      | UNIQUE (source, source_key)                                                                                                          |
| candidate_status_check                     | CHECK       | CHECK ((status = ANY (ARRAY['unreviewed'::text, 'promoted'::text, 'declined'::text, 'suppressed'::text])))                           |
| candidate_status_not_null                  | n           | NOT NULL status                                                                                                                      |

## Indexes

| Name                            | Definition                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| candidate_pkey                  | CREATE UNIQUE INDEX candidate_pkey ON next.candidate USING btree (id)                                  |
| candidate_source_source_key_key | CREATE UNIQUE INDEX candidate_source_source_key_key ON next.candidate USING btree (source, source_key) |

## Triggers

| Name             | Definition                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| candidate_review | CREATE TRIGGER candidate_review AFTER INSERT OR UPDATE ON next.candidate FOR EACH ROW EXECUTE FUNCTION candidate_review()         |
| record_change    | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.candidate FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change     | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.candidate FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
