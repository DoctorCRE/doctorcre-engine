# next.building_ownership

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
| party_id            | uuid                     |                   | false    |          | [next.party](next.party.md)       |         |
| property_id         | uuid                     |                   | false    |          | [next.property](next.property.md) |         |
| source              | text                     |                   | false    |          |                                   |         |
| started_on          | date                     |                   | true     |          |                                   |         |

## Viewpoints

| Name                              | Definition                                                                  |
| --------------------------------- | --------------------------------------------------------------------------- |
| [Property](viewpoint-property.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                                        | Type        | Definition                                                                                                                           |
| ----------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| building_ownership_changed_at_not_null                      | n           | NOT NULL changed_at                                                                                                                  |
| building_ownership_changed_by_a_user_or_a_job               | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| building_ownership_changed_by_job_fkey                      | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| building_ownership_changed_by_user_id_fkey                  | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| building_ownership_changed_for_user_id_fkey                 | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| building_ownership_check                                    | CHECK       | CHECK ((ended_on >= started_on))                                                                                                     |
| building_ownership_created_at_not_null                      | n           | NOT NULL created_at                                                                                                                  |
| building_ownership_id_not_null                              | n           | NOT NULL id                                                                                                                          |
| building_ownership_kind_check                               | CHECK       | CHECK ((kind = ANY (ARRAY['owner'::text, 'landlord_rep'::text, 'property_manager'::text, 'listing_agent'::text])))                   |
| building_ownership_kind_not_null                            | n           | NOT NULL kind                                                                                                                        |
| building_ownership_party_id_fkey                            | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                          |
| building_ownership_party_id_not_null                        | n           | NOT NULL party_id                                                                                                                    |
| building_ownership_pkey                                     | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                     |
| building_ownership_property_id_fkey                         | FOREIGN KEY | FOREIGN KEY (property_id) REFERENCES property(id)                                                                                    |
| building_ownership_property_id_not_null                     | n           | NOT NULL property_id                                                                                                                 |
| building_ownership_property_id_party_id_kind_started_on_key | UNIQUE      | UNIQUE NULLS NOT DISTINCT (property_id, party_id, kind, started_on)                                                                  |
| building_ownership_source_check                             | CHECK       | CHECK ((source ~ '\S'::text))                                                                                                        |
| building_ownership_source_not_null                          | n           | NOT NULL source                                                                                                                      |

## Indexes

| Name                                                        | Definition                                                                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| building_ownership_pkey                                     | CREATE UNIQUE INDEX building_ownership_pkey ON next.building_ownership USING btree (id)                                                                                             |
| building_ownership_property_id_party_id_kind_started_on_key | CREATE UNIQUE INDEX building_ownership_property_id_party_id_kind_started_on_key ON next.building_ownership USING btree (property_id, party_id, kind, started_on) NULLS NOT DISTINCT |

## Triggers

| Name          | Definition                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.building_ownership FOR EACH ROW EXECUTE FUNCTION record_change('id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.building_ownership FOR EACH ROW EXECUTE FUNCTION stamp_change()                |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
