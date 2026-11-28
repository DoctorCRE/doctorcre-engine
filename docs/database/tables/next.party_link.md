# next.party_link

## Columns

| Name                | Type                     | Default           | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ----------------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |                   | false    |          |                                   |         |
| changed_by_job      | text                     |                   | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |                   | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |                   | true     |          | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()             | false    |          |                                   |         |
| ended_on            | date                     |                   | true     |          |                                   |         |
| id                  | uuid                     | gen_random_uuid() | false    |          |                                   |         |
| kind                | text                     |                   | false    |          |                                   |         |
| note                | text                     |                   | true     |          |                                   |         |
| other_party_id      | uuid                     |                   | false    |          | [next.party](next.party.md)       |         |
| party_id            | uuid                     |                   | false    |          | [next.party](next.party.md)       |         |
| started_on          | date                     |                   | true     |          |                                   |         |

## Viewpoints

| Name                                        | Definition                                             |
| ------------------------------------------- | ------------------------------------------------------ |
| [Relationships](viewpoint-relationships.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                  | Type        | Definition                                                                                                                           |
| ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| party_link_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| party_link_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| party_link_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| party_link_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| party_link_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| party_link_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| party_link_ends_after_it_starts       | CHECK       | CHECK ((ended_on >= started_on))                                                                                                     |
| party_link_id_not_null                | n           | NOT NULL id                                                                                                                          |
| party_link_kind_check                 | CHECK       | CHECK ((kind = ANY (ARRAY['knows'::text, 'can_introduce'::text])))                                                                   |
| party_link_kind_not_null              | n           | NOT NULL kind                                                                                                                        |
| party_link_note_check                 | CHECK       | CHECK ((note ~ '\S'::text))                                                                                                          |
| party_link_other_party_id_fkey        | FOREIGN KEY | FOREIGN KEY (other_party_id) REFERENCES party(id)                                                                                    |
| party_link_other_party_id_not_null    | n           | NOT NULL other_party_id                                                                                                              |
| party_link_party_id_fkey              | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                          |
| party_link_party_id_not_null          | n           | NOT NULL party_id                                                                                                                    |
| party_link_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| party_link_two_parties                | CHECK       | CHECK ((party_id <> other_party_id))                                                                                                 |

## Indexes

| Name                          | Definition                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| party_link_can_introduce_once | CREATE UNIQUE INDEX party_link_can_introduce_once ON next.party_link USING btree (party_id, other_party_id) WHERE ((kind = 'can_introduce'::text) AND (ended_on IS NULL))                            |
| party_link_knows_once         | CREATE UNIQUE INDEX party_link_knows_once ON next.party_link USING btree (LEAST(party_id, other_party_id), GREATEST(party_id, other_party_id)) WHERE ((kind = 'knows'::text) AND (ended_on IS NULL)) |
| party_link_pkey               | CREATE UNIQUE INDEX party_link_pkey ON next.party_link USING btree (id)                                                                                                                              |

## Triggers

| Name          | Definition                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.party_link FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.party_link FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
