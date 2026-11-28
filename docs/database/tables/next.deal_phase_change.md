# next.deal_phase_change

## Columns

| Name                | Type                     | Default | Nullable | Extra Definition                        | Children                                                                                                                                                                        | Parents                                                                         | Comment |
| ------------------- | ------------------------ | ------- | -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------- |
| call_activity_id    | uuid                     |         | true     |                                         |                                                                                                                                                                                 | [next.activity](next.activity.md) [next.activity_about](next.activity_about.md) |         |
| call_kind           | text                     |         | true     | GENERATED ALWAYS AS 'call'::text STORED |                                                                                                                                                                                 | [next.activity](next.activity.md)                                               |         |
| call_move_id        | uuid                     |         | true     |                                         |                                                                                                                                                                                 |                                                                                 |         |
| changed_at          | timestamp with time zone |         | false    |                                         |                                                                                                                                                                                 |                                                                                 |         |
| changed_by_job      | text                     |         | true     |                                         |                                                                                                                                                                                 | [next.job](next.job.md)                                                         |         |
| changed_by_user_id  | uuid                     |         | true     |                                         |                                                                                                                                                                                 | [next.app_user](next.app_user.md)                                               |         |
| changed_for_user_id | uuid                     |         | true     |                                         |                                                                                                                                                                                 | [next.app_user](next.app_user.md)                                               |         |
| deal_id             | uuid                     |         | false    |                                         | [next.imported_automatic_phase_move](next.imported_automatic_phase_move.md) [next.imported_deal_board](next.imported_deal_board.md) [next.invoice_email](next.invoice_email.md) | [next.activity_about](next.activity_about.md) [next.deal](next.deal.md)         |         |
| happened_at         | timestamp with time zone |         | false    |                                         | [next.imported_automatic_phase_move](next.imported_automatic_phase_move.md) [next.imported_deal_board](next.imported_deal_board.md) [next.invoice_email](next.invoice_email.md) |                                                                                 |         |
| phase               | text                     |         | false    |                                         |                                                                                                                                                                                 | [next.phase](next.phase.md)                                                     |         |
| reason              | text                     |         | true     |                                         |                                                                                                                                                                                 |                                                                                 |         |

## Viewpoints

| Name                        | Definition                                             |
| --------------------------- | ------------------------------------------------------ |
| [Deals](viewpoint-deals.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                         | Type        | Definition                                                                                                                                               |
| -------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| deal_phase_change_call_move_id_key           | UNIQUE      | UNIQUE (call_move_id)                                                                                                                                    |
| deal_phase_change_call_on_deal               | FOREIGN KEY | FOREIGN KEY (call_activity_id, deal_id) REFERENCES activity_about(activity_id, deal_id)                                                                  |
| deal_phase_change_call_source                | CHECK       | CHECK ((num_nonnulls(call_activity_id, call_move_id) =<br />CASE<br />    WHEN (changed_by_job = 'call_capture'::text) THEN 2<br />    ELSE 0<br />END)) |
| deal_phase_change_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                                      |
| deal_phase_change_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL))))                     |
| deal_phase_change_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                                        |
| deal_phase_change_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                                                 |
| deal_phase_change_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                                                |
| deal_phase_change_dead_has_reason            | CHECK       | CHECK (((phase <> 'dead'::text) OR (reason IS NOT NULL)))                                                                                                |
| deal_phase_change_deal_id_fkey               | FOREIGN KEY | FOREIGN KEY (deal_id) REFERENCES deal(id)                                                                                                                |
| deal_phase_change_deal_id_not_null           | n           | NOT NULL deal_id                                                                                                                                         |
| deal_phase_change_happened_at_not_null       | n           | NOT NULL happened_at                                                                                                                                     |
| deal_phase_change_phase_fkey                 | FOREIGN KEY | FOREIGN KEY (phase) REFERENCES phase(slug)                                                                                                               |
| deal_phase_change_phase_not_null             | n           | NOT NULL phase                                                                                                                                           |
| deal_phase_change_pkey                       | PRIMARY KEY | PRIMARY KEY (deal_id, happened_at)                                                                                                                       |
| deal_phase_change_source_is_call             | FOREIGN KEY | FOREIGN KEY (call_activity_id, call_kind) REFERENCES activity(id, kind)                                                                                  |

## Indexes

| Name                               | Definition                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| deal_phase_change_call_move_id_key | CREATE UNIQUE INDEX deal_phase_change_call_move_id_key ON next.deal_phase_change USING btree (call_move_id) |
| deal_phase_change_pkey             | CREATE UNIQUE INDEX deal_phase_change_pkey ON next.deal_phase_change USING btree (deal_id, happened_at)     |

## Triggers

| Name                | Definition                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change       | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.deal_phase_change FOR EACH ROW EXECUTE FUNCTION record_change('deal_id', 'happened_at') |
| stamp_change        | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.deal_phase_change FOR EACH ROW EXECUTE FUNCTION stamp_change()                                    |
| sync_deal_open_name | CREATE TRIGGER sync_deal_open_name AFTER INSERT OR DELETE ON next.deal_phase_change FOR EACH ROW EXECUTE FUNCTION sync_deal_open_name('deal_id')              |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
