# next.deal_client_website

## Columns

| Name                | Type                     | Default | Nullable | Children                                                                                                                                    | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |                                                                                                                                             |                                   |         |
| changed_by_job      | text                     |         | true     |                                                                                                                                             | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |                                                                                                                                             | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |                                                                                                                                             | [next.app_user](next.app_user.md) |         |
| client_party_id     | uuid                     |         | false    |                                                                                                                                             | [next.party](next.party.md)       |         |
| created_at          | timestamp with time zone | now()   | false    |                                                                                                                                             |                                   |         |
| deal_id             | uuid                     |         | false    |                                                                                                                                             | [next.deal](next.deal.md)         |         |
| disabled_at         | timestamp with time zone |         | true     |                                                                                                                                             |                                   |         |
| password_hash       | text                     |         | false    |                                                                                                                                             |                                   |         |
| slug                | text                     |         | false    | [next.deal_client_website_attempt](next.deal_client_website_attempt.md) [next.deal_client_website_grant](next.deal_client_website_grant.md) |                                   |         |

## Viewpoints

| Name                                    | Definition                                             |
| --------------------------------------- | ------------------------------------------------------ |
| [Client websites](viewpoint-website.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                           | Type        | Definition                                                                                                                           |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| deal_client_website_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| deal_client_website_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| deal_client_website_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| deal_client_website_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| deal_client_website_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| deal_client_website_client_party_id_fkey       | FOREIGN KEY | FOREIGN KEY (client_party_id) REFERENCES party(id)                                                                                   |
| deal_client_website_client_party_id_not_null   | n           | NOT NULL client_party_id                                                                                                             |
| deal_client_website_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| deal_client_website_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                            |
| deal_client_website_deal_id_not_null           | n           | NOT NULL deal_id                                                                                                                     |
| deal_client_website_password_hash_check        | CHECK       | CHECK ((password_hash ~ '^[$]2[aby][$]12[$][./A-Za-z0-9]{53}$'::text))                                                               |
| deal_client_website_password_hash_not_null     | n           | NOT NULL password_hash                                                                                                               |
| deal_client_website_pkey                       | PRIMARY KEY | PRIMARY KEY (slug)                                                                                                                   |
| deal_client_website_slug_check                 | CHECK       | CHECK ((slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'::text))                                                                                   |
| deal_client_website_slug_not_null              | n           | NOT NULL slug                                                                                                                        |

## Indexes

| Name                           | Definition                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| deal_client_website_one_active | CREATE UNIQUE INDEX deal_client_website_one_active ON next.deal_client_website USING btree (deal_id) WHERE (disabled_at IS NULL) |
| deal_client_website_pkey       | CREATE UNIQUE INDEX deal_client_website_pkey ON next.deal_client_website USING btree (slug)                                      |

## Triggers

| Name          | Definition                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.deal_client_website FOR EACH ROW EXECUTE FUNCTION record_change('slug') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.deal_client_website FOR EACH ROW EXECUTE FUNCTION stamp_change()                  |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
