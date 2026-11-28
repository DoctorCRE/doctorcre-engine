# next.vendor_loan_program

## Columns

| Name                | Type                     | Default        | Nullable | Children | Parents                               | Comment |
| ------------------- | ------------------------ | -------------- | -------- | -------- | ------------------------------------- | ------- |
| changed_at          | timestamp with time zone |                | false    |          |                                       |         |
| changed_by_job      | text                     |                | true     |          | [next.job](next.job.md)               |         |
| changed_by_user_id  | uuid                     |                | true     |          | [next.app_user](next.app_user.md)     |         |
| changed_for_user_id | uuid                     |                | true     |          | [next.app_user](next.app_user.md)     |         |
| created_at          | timestamp with time zone | now()          | false    |          |                                       |         |
| loan_program        | text                     |                | false    |          |                                       |         |
| party_id            | uuid                     |                | false    |          | [next.party_role](next.party_role.md) |         |
| role                | text                     | 'vendor'::text | false    |          | [next.party_role](next.party_role.md) |         |

## Viewpoints

| Name                                                        | Definition                                             |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| [Vendors and territories](viewpoint-vendors-territories.md) | Tables in this area and the foreign keys between them. |

## Constraints

| Name                                           | Type        | Definition                                                                                                                           |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| vendor_loan_program_changed_at_not_null        | n           | NOT NULL changed_at                                                                                                                  |
| vendor_loan_program_changed_by_a_user_or_a_job | CHECK       | CHECK (((num_nonnulls(changed_by_user_id, changed_by_job) = 1) AND ((changed_by_job IS NOT NULL) OR (changed_for_user_id IS NULL)))) |
| vendor_loan_program_changed_by_job_fkey        | FOREIGN KEY | FOREIGN KEY (changed_by_job) REFERENCES job(slug)                                                                                    |
| vendor_loan_program_changed_by_user_id_fkey    | FOREIGN KEY | FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)                                                                             |
| vendor_loan_program_changed_for_user_id_fkey   | FOREIGN KEY | FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)                                                                            |
| vendor_loan_program_created_at_not_null        | n           | NOT NULL created_at                                                                                                                  |
| vendor_loan_program_loan_program_check         | CHECK       | CHECK (((loan_program = regexp_replace(loan_program, '^\s+                                                                           | \s+$'::text, ''::text, 'g'::text)) AND (loan_program ~ '\S'::text))) |
| vendor_loan_program_loan_program_not_null      | n           | NOT NULL loan_program                                                                                                                |
| vendor_loan_program_party_id_not_null          | n           | NOT NULL party_id                                                                                                                    |
| vendor_loan_program_party_id_role_fkey         | FOREIGN KEY | FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE                                                 |
| vendor_loan_program_pkey                       | PRIMARY KEY | PRIMARY KEY (party_id, loan_program)                                                                                                 |
| vendor_loan_program_role_check                 | CHECK       | CHECK ((role = 'vendor'::text))                                                                                                      |
| vendor_loan_program_role_not_null              | n           | NOT NULL role                                                                                                                        |

## Indexes

| Name                     | Definition                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| vendor_loan_program_pkey | CREATE UNIQUE INDEX vendor_loan_program_pkey ON next.vendor_loan_program USING btree (party_id, loan_program) |

## Triggers

| Name          | Definition                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| record_change | CREATE TRIGGER record_change AFTER INSERT OR DELETE OR UPDATE ON next.vendor_loan_program FOR EACH ROW EXECUTE FUNCTION record_change('party_id', 'loan_program') |
| stamp_change  | CREATE TRIGGER stamp_change BEFORE INSERT OR UPDATE ON next.vendor_loan_program FOR EACH ROW EXECUTE FUNCTION stamp_change()                                      |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
