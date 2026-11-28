# next.email_summary

## Columns

| Name               | Type                     | Default | Nullable | Children | Parents                     | Comment |
| ------------------ | ------------------------ | ------- | -------- | -------- | --------------------------- | ------- |
| activity_id        | uuid                     |         | false    |          | [next.email](next.email.md) |         |
| generator_version  | text                     |         | false    |          |                             |         |
| provenance         | jsonb                    |         | false    |          |                             |         |
| recorded_at        | timestamp with time zone |         | false    |          |                             |         |
| source_activity_id | uuid                     |         | false    |          |                             |         |
| source_hash        | text                     |         | false    |          |                             |         |
| status             | text                     |         | false    |          |                             |         |
| text               | text                     |         | true     |          |                             |         |

## Viewpoints

| Name                        | Definition                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| [Email](viewpoint-email.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                      | Type        | Definition                                                                                                                                                                 |
| ----------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| email_summary_activity_id_fkey            | FOREIGN KEY | FOREIGN KEY (activity_id) REFERENCES email(activity_id)                                                                                                                    |
| email_summary_activity_id_not_null        | n           | NOT NULL activity_id                                                                                                                                                       |
| email_summary_check                       | CHECK       | CHECK ((((status = 'available'::text) AND (text IS NOT NULL) AND ((length(text) >= 1) AND (length(text) <= 300))) OR ((status = 'unavailable'::text) AND (text IS NULL)))) |
| email_summary_generator_version_check     | CHECK       | CHECK ((generator_version ~ '\S'::text))                                                                                                                                   |
| email_summary_generator_version_not_null  | n           | NOT NULL generator_version                                                                                                                                                 |
| email_summary_pkey                        | PRIMARY KEY | PRIMARY KEY (source_activity_id, source_hash, generator_version)                                                                                                           |
| email_summary_provenance_check            | CHECK       | CHECK ((jsonb_typeof(provenance) = 'object'::text))                                                                                                                        |
| email_summary_provenance_not_null         | n           | NOT NULL provenance                                                                                                                                                        |
| email_summary_recorded_at_not_null        | n           | NOT NULL recorded_at                                                                                                                                                       |
| email_summary_source_activity_id_not_null | n           | NOT NULL source_activity_id                                                                                                                                                |
| email_summary_source_hash_check           | CHECK       | CHECK ((source_hash ~ '^sha256:[a-f0-9]{64}$'::text))                                                                                                                      |
| email_summary_source_hash_not_null        | n           | NOT NULL source_hash                                                                                                                                                       |
| email_summary_status_not_null             | n           | NOT NULL status                                                                                                                                                            |

## Indexes

| Name                | Definition                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| email_summary_email | CREATE INDEX email_summary_email ON next.email_summary USING btree (activity_id)                                              |
| email_summary_pkey  | CREATE UNIQUE INDEX email_summary_pkey ON next.email_summary USING btree (source_activity_id, source_hash, generator_version) |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
