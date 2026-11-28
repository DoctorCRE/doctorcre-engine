# next.imported_deal_party

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |          |                                   |         |
| changed_by_job      | text                     |         | true     |          | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |          | [next.app_user](next.app_user.md) |         |
| deal_id             | uuid                     |         | false    |          | [next.deal](next.deal.md)         |         |
| ended_at            | timestamp with time zone |         | false    |          |                                   |         |
| id                  | uuid                     |         | false    |          |                                   |         |
| party_id            | uuid                     |         | false    |          | [next.party](next.party.md)       |         |
| role                | text                     |         | false    |          | [next.role](next.role.md)         |         |
| started_at          | timestamp with time zone |         | true     |          |                                   |         |

## Viewpoints

| Name                                          | Definition                                             |
| --------------------------------------------- | ------------------------------------------------------ |
| [Imported deals](viewpoint-imported-deals.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                           | Type        | Definition                                                                                                                                                                                                        |
| ---------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deal_party_rejoins_after_leaving               | TRIGGER     | CREATE CONSTRAINT TRIGGER deal_party_rejoins_after_leaving AFTER INSERT OR UPDATE ON next.imported_deal_party NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION deal_party_rejoins_after_leaving() |
| imported_deal_party_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                                                                                               |
| imported_deal_party_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                                                              |
| imported_deal_party_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                                                                 |
| imported_deal_party_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                                                                          |
| imported_deal_party_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                                                                         |
| imported_deal_party_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                                                                                                         |
| imported_deal_party_deal_id_not_null           | n           | NOT NULL deal_id                                                                                                                                                                                                  |
| imported_deal_party_ended_at_not_null          | n           | NOT NULL ended_at                                                                                                                                                                                                 |
| imported_deal_party_ends_after_it_starts       | CHECK       | CHECK ((ended_at > started_at))                                                                                                                                                                                   |
| imported_deal_party_id_not_null                | n           | NOT NULL id                                                                                                                                                                                                       |
| imported_deal_party_once_at_a_time             | x           | EXCLUDE USING gist (deal_id WITH =, party_id WITH =, role WITH =, tstzrange(started_at, ended_at) WITH &&)                                                                                                        |
| imported_deal_party_party_id_fkey              | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                                                                                                       |
| imported_deal_party_party_id_not_null          | n           | NOT NULL party_id                                                                                                                                                                                                 |
| imported_deal_party_pkey                       | PRIMARY KEY | PRIMARY KEY (id)                                                                                                                                                                                                  |
| imported_deal_party_role_fkey                  | FOREIGN KEY | FOREIGN KEY (role) REFERENCES role(slug)                                                                                                                                                                          |
| imported_deal_party_role_not_null              | n           | NOT NULL role                                                                                                                                                                                                     |

## Indexes

| Name                               | Definition                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| imported_deal_party_once_at_a_time | CREATE INDEX imported_deal_party_once_at_a_time ON next.imported_deal_party USING gist (deal_id, party_id, role, tstzrange(started_at, ended_at)) |
| imported_deal_party_pkey           | CREATE UNIQUE INDEX imported_deal_party_pkey ON next.imported_deal_party USING btree (id)                                                         |

## Triggers

| Name                             | Definition                                                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deal_party_rejoins_after_leaving | CREATE CONSTRAINT TRIGGER deal_party_rejoins_after_leaving AFTER INSERT OR UPDATE ON next.imported_deal_party NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION deal_party_rejoins_after_leaving() |
| record_change                    | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.imported_deal_party FOR EACH ROW EXECUTE FUNCTION record_change('id')                                                                       |
| stamp_change                     | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.imported_deal_party FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                                                      |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
