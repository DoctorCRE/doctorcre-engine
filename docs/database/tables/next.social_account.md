# next.social_account

## Columns

| Name                  | Type                     | Default           | Nullable | Children                                                                | Parents                           | Comment |
| --------------------- | ------------------------ | ----------------- | -------- | ----------------------------------------------------------------------- | --------------------------------- | ------- |
| changed_at            | timestamp with time zone |                   | false    |                                                                         |                                   |         |
| changed_by_job        | text                     |                   | true     |                                                                         | [next.job](next.job.md)           |         |
| changed_by_user_id    | uuid                     |                   | true     |                                                                         | [next.app_user](next.app_user.md) |         |
| changed_for_user_id   | uuid                     |                   | true     |                                                                         | [next.app_user](next.app_user.md) |         |
| created_at            | timestamp with time zone | now()             | false    |                                                                         |                                   |         |
| engine_publishes_from | timestamp with time zone |                   | true     |                                                                         |                                   |         |
| handle                | text                     |                   | false    |                                                                         |                                   |         |
| id                    | uuid                     | gen_random_uuid() | false    | [next.post](next.post.md) [next.social_sign_in](next.social_sign_in.md) |                                   |         |
| owner_party_id        | uuid                     |                   | false    |                                                                         | [next.party](next.party.md)       |         |
| platform              | text                     |                   | false    | [next.post](next.post.md)                                               |                                   |         |
| platform_account_id   | text                     |                   | true     | [next.social_sign_in](next.social_sign_in.md)                           |                                   |         |

## Viewpoints

| Name                                            | Definition                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| [Social accounts](viewpoint-social-accounts.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                            | Type        | Definition                                                                                                                           |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| social_account_changed_at_not_null              | n           | NOT NULL changed_at                                                                                                                  |
| social_account_changed_by_a_user_or_a_job       | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| social_account_changed_by_job_fkey              | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| social_account_changed_by_user_id_fkey          | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| social_account_changed_for_user_id_fkey         | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| social_account_created_at_not_null              | n           | NOT NULL created_at                                                                                                                  |
| social_account_handle_check                     | CHECK       | CHECK ((handle ~ '\S'::text))                                                                                                        |
| social_account_handle_not_null                  | n           | NOT NULL handle                                                                                                                      |
| social_account_id_not_null                      | n           | NOT NULL id                                                                                                                          |
| social_account_id_platform_account_id_key       | UNIQUE      | UNIQUE (id, platform_account_id)                                                                                                     |
| social_account_id_platform_key                  | UNIQUE      | UNIQUE (id, platform)                                                                                                                |
| social_account_owner_party_id_fkey              | FOREIGN KEY | FOREIGN KEY (owner_party_id) REFERENCES party(id)                                                                                    |
| social_account_owner_party_id_not_null          | n           | NOT NULL owner_party_id                                                                                                              |
| social_account_pkey                             | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| social_account_platform_account_id_check        | CHECK       | CHECK ((platform_account_id ~ '\S'::text))                                                                                           |
| social_account_platform_check                   | CHECK       | CHECK ((platform = ANY (ARRAY['x'::text, 'linkedin'::text, 'facebook'::text, 'instagram'::text])))                                   |
| social_account_platform_not_null                | n           | NOT NULL platform                                                                                                                    |
| social_account_platform_platform_account_id_key | UNIQUE      | UNIQUE (platform, platform_account_id)                                                                                               |

## Indexes

| Name                                            | Definition                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| social_account_id_platform_account_id_key       | CREATE UNIQUE INDEX social_account_id_platform_account_id_key ON next.social_account USING btree (id, platform_account_id)             |
| social_account_id_platform_key                  | CREATE UNIQUE INDEX social_account_id_platform_key ON next.social_account USING btree (id, platform)                                   |
| social_account_one_per_handle                   | CREATE UNIQUE INDEX social_account_one_per_handle ON next.social_account USING btree (platform, lower(handle))                         |
| social_account_pkey                             | CREATE UNIQUE INDEX social_account_pkey ON next.social_account USING btree (id)                                                        |
| social_account_platform_platform_account_id_key | CREATE UNIQUE INDEX social_account_platform_platform_account_id_key ON next.social_account USING btree (platform, platform_account_id) |

## Triggers

| Name          | Definition                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.social_account FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.social_account FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
