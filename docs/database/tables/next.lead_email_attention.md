# next.lead_email_attention

## Columns

| Name                    | Type                     | Default | Nullable | Extra Definition                | Children | Parents                                                                         | Comment |
| ----------------------- | ------------------------ | ------- | -------- | ------------------------------- | -------- | ------------------------------------------------------------------------------- | ------- |
| acknowledged_at         | timestamp with time zone |         | true     |                                 |          |                                                                                 |         |
| acknowledged_by_user_id | uuid                     |         | true     |                                 |          | [next.app_user](next.app_user.md)                                               |         |
| acknowledger_is_partner | boolean                  |         | true     | GENERATED ALWAYS AS true STORED |          | [next.app_user](next.app_user.md)                                               |         |
| activity_id             | uuid                     |         | false    |                                 |          | [next.lead_email_source](next.lead_email_source.md)                             |         |
| created_at              | timestamp with time zone | now()   | false    |                                 |          |                                                                                 |         |
| party_id                | uuid                     |         | false    |                                 |          | [next.lead_email_source](next.lead_email_source.md) [next.party](next.party.md) |         |

## Viewpoints

| Name                        | Definition                                                                  |
| --------------------------- | --------------------------------------------------------------------------- |
| [Leads](viewpoint-leads.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                                            | Type        | Definition                                                                                                            |
| --------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| lead_email_attention_acknowledged_by_user_id_acknowledger__fkey | FOREIGN KEY | FOREIGN KEY (acknowledged_by_user_id, acknowledger_is_partner) REFERENCES app_user(id, is_account_partner)            |
| lead_email_attention_activity_id_not_null                       | n           | NOT NULL activity_id                                                                                                  |
| lead_email_attention_activity_id_party_id_fkey                  | FOREIGN KEY | FOREIGN KEY (activity_id, party_id) REFERENCES lead_email_source(activity_id, party_id) DEFERRABLE INITIALLY DEFERRED |
| lead_email_attention_check                                      | CHECK       | CHECK (((acknowledged_by_user_id IS NULL) = (acknowledged_at IS NULL)))                                               |
| lead_email_attention_created_at_not_null                        | n           | NOT NULL created_at                                                                                                   |
| lead_email_attention_party_id_fkey                              | FOREIGN KEY | FOREIGN KEY (party_id) REFERENCES party(id)                                                                           |
| lead_email_attention_party_id_not_null                          | n           | NOT NULL party_id                                                                                                     |
| lead_email_attention_pkey                                       | PRIMARY KEY | PRIMARY KEY (party_id)                                                                                                |

## Indexes

| Name                      | Definition                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| lead_email_attention_pkey | CREATE UNIQUE INDEX lead_email_attention_pkey ON next.lead_email_attention USING btree (party_id) |

## Triggers

| Name                        | Definition                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lead_email_attention_change | CREATE TRIGGER lead_email_attention_change BEFORE INSERT OR UPDATE ON next.lead_email_attention FOR EACH ROW EXECUTE FUNCTION lead_email_attention_change() |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
