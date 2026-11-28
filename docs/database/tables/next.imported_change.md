# next.imported_change

## Columns

| Name                | Type                     | Default      | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------------ | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |              | false    |          |                                   |         |
| changed_by_job      | text                     |              | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |              | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |              | true     |          | [next.app_user](next.app_user.md) |         |
| erased_fields       | text[]                   | '{}'::text[] | false    |          |                                   |         |
| field               | text                     |              | false    |          |                                   |         |
| id                  | uuid                     |              | false    |          |                                   |         |
| new_value_absent    | boolean                  |              | false    |          |                                   |         |
| old_value_absent    | boolean                  |              | false    |          |                                   |         |
| record              | jsonb                    |              | false    |          |                                   |         |
| source_event        | jsonb                    |              | false    |          |                                   |         |
| table_name          | text                     |              | false    |          |                                   |         |

## Viewpoints

| Name                                                        | Definition                                             |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| [Changes and preferences](viewpoint-changes-preferences.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                      | Type        | Definition                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| imported_change_changed_at_not_null       | n           | NOT NULL changed_at                                                                                                                                                                                                                                                                                                                                                                                        |
| imported_change_changed_by_job_fkey       | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                                                                                                                                                                                                                                                          |
| imported_change_changed_by_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                                                                                                                                                                                                                                                                   |
| imported_change_changed_for_user_id_fkey  | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                                                                                                                                                                                                                                                                  |
| imported_change_check                     | CHECK       | CHECK (((jsonb_typeof(source_event) = 'object'::text) AND (source_event ?& ARRAY['id'::text, 'verb'::text, 'cause'::text, 'actor_id'::text]) AND ((source_event ->> 'id'::text) IS NOT NULL) AND (((source_event ->> 'id'::text))::uuid = id) AND ((source_event ->> 'verb'::text) IS NOT NULL) AND ((source_event ->> 'cause'::text) IS NOT NULL) AND ((source_event ->> 'actor_id'::text) IS NOT NULL))) |
| imported_change_check1                    | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                                                                                                                                                                                                                                                       |
| imported_change_erased_fields_not_null    | n           | NOT NULL erased_fields                                                                                                                                                                                                                                                                                                                                                                                     |
| imported_change_field_check               | CHECK       | CHECK ((field ~ '\S'::text))                                                                                                                                                                                                                                                                                                                                                                               |
| imported_change_field_not_null            | n           | NOT NULL field                                                                                                                                                                                                                                                                                                                                                                                             |
| imported_change_id_not_null               | n           | NOT NULL id                                                                                                                                                                                                                                                                                                                                                                                                |
| imported_change_new_value_absent_not_null | n           | NOT NULL new_value_absent                                                                                                                                                                                                                                                                                                                                                                                  |
| imported_change_old_value_absent_not_null | n           | NOT NULL old_value_absent                                                                                                                                                                                                                                                                                                                                                                                  |
| imported_change_pkey                      | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                                                                                                                                                                                                                                                                                           |
| imported_change_record_check              | CHECK       | CHECK (((jsonb_typeof(record) = 'object'::text) AND (record <> '{}'::jsonb)))                                                                                                                                                                                                                                                                                                                              |
| imported_change_record_not_null           | n           | NOT NULL record                                                                                                                                                                                                                                                                                                                                                                                            |
| imported_change_source_event_not_null     | n           | NOT NULL source_event                                                                                                                                                                                                                                                                                                                                                                                      |
| imported_change_table_name_check          | CHECK       | CHECK ((table_name = ANY (ARRAY['party'::text, 'deal'::text, 'party_role'::text, 'client'::text, 'activity'::text, 'proposal'::text])))                                                                                                                                                                                                                                                                    |
| imported_change_table_name_not_null       | n           | NOT NULL table_name                                                                                                                                                                                                                                                                                                                                                                                        |

## Indexes

| Name                   | Definition                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| imported_change_pkey   | CREATE UNIQUE INDEX imported_change_pkey ON next.imported_change USING btree (id)            |
| imported_change_record | CREATE INDEX imported_change_record ON next.imported_change USING btree (table_name, record) |

## Triggers

| Name                  | Definition                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| stamp_imported_change | CREATE TRIGGER stamp_imported_change BEFORE INSERT ON next.imported_change FOR EACH ROW EXECUTE FUNCTION stamp_change() |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
