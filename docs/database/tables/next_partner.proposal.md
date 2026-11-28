# next_partner.proposal

## Description

<details>
<summary><strong>Table Definition</strong></summary>

```sql
CREATE VIEW proposal AS (
 SELECT activity_id,
    activity_kind,
    call_deal_id,
    candidate_id,
    changed_at,
    changed_by_job,
    changed_by_user_id,
    changed_for_user_id,
    created_at,
    deal_id,
    decided_at,
    decided_by_user_id,
    due_on,
    due_source,
    filed_deal_id,
    filed_vendor_id,
    filing_reason,
    filing_scope,
    from_phase,
    from_stage,
    held_deal_id,
    how_found,
    id,
    keeps_deal_date,
    kind,
    lead_role,
    merged_step_id,
    next_step_id,
    owner_party_id,
    party_id,
    phase_on,
    phase_stated,
    property_id,
    proposed_by_job,
    status,
    step_seen_at,
    strength,
    superseded_reason,
    to_phase,
    to_stage,
    evidence,
    reason,
    dismiss_reason,
    what
   FROM proposal p
)
```

</details>

## Columns

| Name                | Type                     | Default | Nullable | Children | Parents | Comment |
| ------------------- | ------------------------ | ------- | -------- | -------- | ------- | ------- |
| activity_id         | uuid                     |         | true     |          |         |         |
| activity_kind       | text                     |         | true     |          |         |         |
| call_deal_id        | uuid                     |         | true     |          |         |         |
| candidate_id        | uuid                     |         | true     |          |         |         |
| changed_at          | timestamp with time zone |         | true     |          |         |         |
| changed_by_job      | text                     |         | true     |          |         |         |
| changed_by_user_id  | uuid                     |         | true     |          |         |         |
| changed_for_user_id | uuid                     |         | true     |          |         |         |
| created_at          | timestamp with time zone |         | true     |          |         |         |
| deal_id             | uuid                     |         | true     |          |         |         |
| decided_at          | timestamp with time zone |         | true     |          |         |         |
| decided_by_user_id  | uuid                     |         | true     |          |         |         |
| dismiss_reason      | text                     |         | true     |          |         |         |
| due_on              | date                     |         | true     |          |         |         |
| due_source          | text                     |         | true     |          |         |         |
| evidence            | text                     |         | true     |          |         |         |
| filed_deal_id       | uuid                     |         | true     |          |         |         |
| filed_vendor_id     | uuid                     |         | true     |          |         |         |
| filing_reason       | text                     |         | true     |          |         |         |
| filing_scope        | text                     |         | true     |          |         |         |
| from_phase          | text                     |         | true     |          |         |         |
| from_stage          | text                     |         | true     |          |         |         |
| held_deal_id        | uuid                     |         | true     |          |         |         |
| how_found           | text                     |         | true     |          |         |         |
| id                  | uuid                     |         | true     |          |         |         |
| keeps_deal_date     | boolean                  |         | true     |          |         |         |
| kind                | text                     |         | true     |          |         |         |
| lead_role           | text                     |         | true     |          |         |         |
| merged_step_id      | uuid                     |         | true     |          |         |         |
| next_step_id        | uuid                     |         | true     |          |         |         |
| owner_party_id      | uuid                     |         | true     |          |         |         |
| party_id            | uuid                     |         | true     |          |         |         |
| phase_on            | date                     |         | true     |          |         |         |
| phase_stated        | boolean                  |         | true     |          |         |         |
| property_id         | uuid                     |         | true     |          |         |         |
| proposed_by_job     | text                     |         | true     |          |         |         |
| reason              | text                     |         | true     |          |         |         |
| status              | text                     |         | true     |          |         |         |
| step_seen_at        | timestamp with time zone |         | true     |          |         |         |
| strength            | text                     |         | true     |          |         |         |
| superseded_reason   | text                     |         | true     |          |         |         |
| to_phase            | text                     |         | true     |          |         |         |
| to_stage            | text                     |         | true     |          |         |         |
| what                | text                     |         | true     |          |         |         |

## Referenced Tables

| Name                              | Columns | Comment | Type       |
| --------------------------------- | ------- | ------- | ---------- |
| [next.proposal](next.proposal.md) | 44      |         | BASE TABLE |

---

> Generated by [tbls](https://github.com/k1LoW/tbls)
