# next.deal_party

## Columns

| Name                | Type                     | Default | Nullable | Extra Definition                                                                                                        | Children                                                | Parents                                                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |                                                                                                                         |                                                         |                                                                   |         |
| changed_by_job      | text                     |         | true     |                                                                                                                         |                                                         | [next.job](next.job.md)                                           |         |
| changed_by_user_id  | uuid                     |         | true     |                                                                                                                         |                                                         | [next.app_user](next.app_user.md)                                 |         |
| changed_for_user_id | uuid                     |         | true     |                                                                                                                         |                                                         | [next.app_user](next.app_user.md)                                 |         |
| client_role         | text                     |         | true     | GENERATED ALWAYS AS <br />CASE<br />    WHEN (role = 'client'::text) THEN role<br />    ELSE NULL::text<br />END STORED |                                                         | [next.party_role](next.party_role.md)                             |         |
| created_at          | timestamp with time zone | now()   | false    |                                                                                                                         |                                                         |                                                                   |         |
| deal_id             | uuid                     |         | false    |                                                                                                                         | [next.lease](next.lease.md) [next.offer](next.offer.md) | [next.deal](next.deal.md)                                         |         |
| party_id            | uuid                     |         | false    |                                                                                                                         | [next.lease](next.lease.md) [next.offer](next.offer.md) | [next.party](next.party.md) [next.party_role](next.party_role.md) |         |
| role                | text                     |         | false    |                                                                                                                         | [next.lease](next.lease.md) [next.offer](next.offer.md) | [next.role](next.role.md)                                         |         |

## Viewpoints

| Name                        | Definition                                             |
| --------------------------- | ------------------------------------------------------ |
| [Deals](viewpoint-deals.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                  | Type        | Definition                                                                                                                                                                                               |
| ------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deal_party_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                                                                                      |
| deal_party_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                                                                     |
| deal_party_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                                                                        |
| deal_party_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                                                                 |
| deal_party_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                                                                |
| deal_party_client_is_a_client         | FOREIGN KEY | FOREIGN KEY (party_id, client_role) REFERENCES party_role(party_id, role) DEFERRABLE INITIALLY DEFERRED                                                                                                  |
| deal_party_created_at_not_null        | n           | NOT NULL created_at                                                                                                                                                                                      |
| deal_party_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                                                                                                |
| deal_party_deal_id_not_null           | n           | NOT NULL deal_id                                                                                                                                                                                         |
| deal_party_one_client                 | UNIQUE      | UNIQUE (deal_id, client_role)                                                                                                                                                                            |
| deal_party_party_id_fkey              | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                                                                                                              |
| deal_party_party_id_not_null          | n           | NOT NULL party_id                                                                                                                                                                                        |
| deal_party_pkey                       | PRIMARY KEY | PRIMARY KEY (deal_id, party_id, role)                                                                                                                                                                    |
| deal_party_rejoins_after_leaving      | TRIGGER     | CREATE CONSTRAINT TRIGGER deal_party_rejoins_after_leaving AFTER INSERT OR UPDATE ON next.deal_party NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION deal_party_rejoins_after_leaving() |
| deal_party_role_fkey                  | FOREIGN KEY | FOREIGN KEY (role) REFERENCES role(slug)                                                                                                                                                                 |
| deal_party_role_not_null              | n           | NOT NULL role                                                                                                                                                                                            |

## Indexes

| Name                  | Definition                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| deal_party_by_party   | CREATE INDEX deal_party_by_party ON next.deal_party USING btree (party_id)                      |
| deal_party_one_client | CREATE UNIQUE INDEX deal_party_one_client ON next.deal_party USING btree (deal_id, client_role) |
| deal_party_pkey       | CREATE UNIQUE INDEX deal_party_pkey ON next.deal_party USING btree (deal_id, party_id, role)    |

## Triggers

| Name                             | Definition                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deal_party_rejoins_after_leaving | CREATE CONSTRAINT TRIGGER deal_party_rejoins_after_leaving AFTER INSERT OR UPDATE ON next.deal_party NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION deal_party_rejoins_after_leaving() |
| record_change                    | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.deal_party FOR EACH ROW EXECUTE FUNCTION record_change('deal_id', 'party_id', 'role')                                              |
| stamp_change                     | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.deal_party FOR EACH ROW EXECUTE FUNCTION stamp_change()                                                                                      |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
