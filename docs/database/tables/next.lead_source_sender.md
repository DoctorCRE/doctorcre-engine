# next.lead_source_sender

## Columns

| Name       | Type                     | Default           | Nullable | Children | Parents | Comment |
| ---------- | ------------------------ | ----------------- | -------- | -------- | ------- | ------- |
| address    | email_address            |                   | true     |          |         |         |
| created_at | timestamp with time zone | now()             | false    |          |         |         |
| domain     | text                     |                   | true     |          |         |         |
| fields     | jsonb                    |                   | true     |          |         |         |
| id         | uuid                     | gen_random_uuid() | false    |          |         |         |
| name       | text                     |                   | false    |          |         |         |

## Viewpoints

| Name                        | Definition                                             |
| --------------------------- | ------------------------------------------------------ |
| [Leads](viewpoint-leads.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                   | Type        | Definition                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| lead_source_sender_check               | CHECK       | CHECK (((address IS NULL) <> (domain IS NULL)))                                                                                                                                                                                                                                                                                                              |
| lead_source_sender_created_at_not_null | n           | NOT NULL created_at                                                                                                                                                                                                                                                                                                                                          |
| lead_source_sender_domain_check        | CHECK       | CHECK (((length(domain) <= 253) AND ((domain COLLATE "C") ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'::text)))                                                                                                                                                                                                           |
| lead_source_sender_domain_key          | UNIQUE      | UNIQUE (domain)                                                                                                                                                                                                                                                                                                                                              |
| lead_source_sender_fields              | CHECK       | CHECK (<br />CASE<br />    WHEN (fields IS NULL) THEN true<br />    WHEN (jsonb_typeof(fields) = 'object'::text) THEN ((fields ? 'name'::text) AND ((fields - ARRAY['name'::text, 'email'::text, 'phone'::text, 'street_address'::text, 'city'::text, 'request'::text]) = '{}'::jsonb) AND (NOT jsonb_path_exists(fields, 'strict $.*?((@.type() != "string" |     | !(@ like_regex "[^[:space:]]")) |     | @ like_regex ":[[:space:]]*$")'::jsonpath)))<br />    ELSE false<br />END) |
| lead_source_sender_id_not_null         | n           | NOT NULL id                                                                                                                                                                                                                                                                                                                                                  |
| lead_source_sender_name_check          | CHECK       | CHECK ((name ~ '\S'::text))                                                                                                                                                                                                                                                                                                                                  |
| lead_source_sender_name_not_null       | n           | NOT NULL name                                                                                                                                                                                                                                                                                                                                                |
| lead_source_sender_pkey                | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                                                                                                                                                                                                                                             |

## Indexes

| Name                              | Definition                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| lead_source_sender_address_unique | CREATE UNIQUE INDEX lead_source_sender_address_unique ON next.lead_source_sender USING btree (lower((address)::text)) |
| lead_source_sender_domain_key     | CREATE UNIQUE INDEX lead_source_sender_domain_key ON next.lead_source_sender USING btree (domain)                     |
| lead_source_sender_pkey           | CREATE UNIQUE INDEX lead_source_sender_pkey ON next.lead_source_sender USING btree (id)                               |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
