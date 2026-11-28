# Commissions

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Commission"
  "Commission payment"
  "Commission share"
  "Commission tier"
  "Deals (area)" {
    string deal
  }
  "Invoices (area)" {
    string invoice_email
  }
  "People (area)" {
    string party
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Commission" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Commission" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Commission" |o--|| "Deals (area)" : "deal ID to Deal"
  "Commission" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Commission payment" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Commission payment" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Commission payment" }o--|| "Commission" : "deal ID"
  "Commission payment" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Commission share" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Commission share" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Commission share" }o--|| "Commission" : "deal ID"
  "Commission share" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Commission share" }o--|| "People (area)" : "party ID to Party"
  "Commission tier" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Commission tier" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Commission tier" }o--|| "Users and jobs (area)" : "partner user ID to App user"
  "Commission tier" }o--|| "Users and jobs (area)" : "user ID to App user"
  "Commission tier" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Invoices (area)" }o--o| "Commission payment" : "Invoice email: payment ID, deal ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Deals](viewpoint-deals.md) (1) · [Invoices](viewpoint-invoices.md) (1) · [People](viewpoint-people.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (14)

## Tables

- [Commission](next.commission.md)
- [Commission payment](next.commission_payment.md)
- [Commission share](next.commission_share.md)
- [Commission tier](next.commission_tier.md)

See each table for its columns and links to other areas.
