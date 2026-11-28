# next.deal_property

## Columns

| Name                | Type                     | Default | Nullable | Children                                                | Parents                           | Comment |
| ------------------- | ------------------------ | ------- | -------- | ------------------------------------------------------- | --------------------------------- | ------- |
| changed_at          | timestamp with time zone |         | false    |                                                         |                                   |         |
| changed_by_job      | text                     |         | true     |                                                         | [next.job](next.job.md)           |         |
| changed_by_user_id  | uuid                     |         | true     |                                                         | [next.app_user](next.app_user.md) |         |
| changed_for_user_id | uuid                     |         | true     |                                                         | [next.app_user](next.app_user.md) |         |
| created_at          | timestamp with time zone | now()   | false    |                                                         |                                   |         |
| deal_id             | uuid                     |         | false    | [next.lease](next.lease.md) [next.offer](next.offer.md) | [next.deal](next.deal.md)         |         |
| property_id         | uuid                     |         | false    | [next.lease](next.lease.md) [next.offer](next.offer.md) | [next.property](next.property.md) |         |

## Viewpoints

| Name                              | Definition                                                                  |
| --------------------------------- | --------------------------------------------------------------------------- |
| [Property](viewpoint-property.md) | Tables in this area and their foreign keys, including links to other areas. |

## Constraints

| Name                                     | Type        | Definition                                                                                                                           |
| ---------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| deal_property_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| deal_property_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| deal_property_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| deal_property_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| deal_property_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| deal_property_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| deal_property_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                            |
| deal_property_deal_id_not_null           | n           | NOT NULL deal_id                                                                                                                     |
| deal_property_pkey                       | PRIMARY KEY | PRIMARY KEY (deal_id, property_id)                                                                                                   |
| deal_property_property_id_fkey           | FOREIGN KEY | FOREIGN KEY (property_id) REFERENCES property(id)                                                                                    |
| deal_property_property_id_not_null       | n           | NOT NULL property_id                                                                                                                 |

## Indexes

| Name               | Definition                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| deal_property_pkey | CREATE UNIQUE INDEX deal_property_pkey ON next.deal_property USING btree (deal_id, property_id) |

## Triggers

| Name          | Definition                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.deal_property FOR EACH ROW EXECUTE FUNCTION record_change('deal_id', 'property_id') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.deal_property FOR EACH ROW EXECUTE FUNCTION stamp_change()                                    |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
