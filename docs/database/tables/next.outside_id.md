# next.outside_id

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| deal_id             | uuid                     |         | true     |          | [next.deal](next.deal.md)         |         |
| email_activity_id   | uuid                     |         | true     |          | [next.email](next.email.md)       |         |
| party_id            | uuid                     |         | true     |          | [next.party](next.party.md)       |         |
| source              | text                     |         | false    |          |                                   |         |
| value               | text                     |         | false    |          |                                   |         |

## Viewpoints

| Name                          | Definition                                             |
| ----------------------------- | ------------------------------------------------------ |
| [People](viewpoint-people.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                  | Type        | Definition                                                                                                                           |
| ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| outside_id_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| outside_id_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| outside_id_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| outside_id_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| outside_id_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| outside_id_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                            |
| outside_id_email_activity_id_fkey     | FOREIGN KEY | FOREIGN KEY (email_activity_id) REFERENCES email(activity_id)                                                                        |
| outside_id_one_record                 | CHECK       | CHECK ((num_nonnulls(party_id, deal_id, email_activity_id) = 1))                                                                     |
| outside_id_party_id_fkey              | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                          |
| outside_id_pkey                       | PRIMARY KEY | PRIMARY KEY (source, value)                                                                                                          |
| outside_id_source_check               | CHECK       | CHECK ((source ~ '^[a-z][a-z0-9_]*$'::text))                                                                                         |
| outside_id_source_not_null            | n           | NOT NULL source                                                                                                                      |
| outside_id_value_check                | CHECK       | CHECK ((value ~ '^\S(.*\S)?$'::text))                                                                                                |
| outside_id_value_not_null             | n           | NOT NULL value                                                                                                                       |

## Indexes

| Name                | Definition                                                                         |
| ------------------- | ---------------------------------------------------------------------------------- |
| outside_id_by_party | CREATE INDEX outside_id_by_party ON next.outside_id USING btree (party_id)         |
| outside_id_pkey     | CREATE UNIQUE INDEX outside_id_pkey ON next.outside_id USING btree (source, value) |

## Triggers

| Name          | Definition                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.outside_id FOR EACH ROW EXECUTE FUNCTION record_change('source', 'value') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.outside_id FOR EACH ROW EXECUTE FUNCTION stamp_change()                             |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
