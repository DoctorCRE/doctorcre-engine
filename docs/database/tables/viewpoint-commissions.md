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
  "Commission" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Commission" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Commission" |o--|| "Deal (Deals)" : "deal ID"
  "Commission" }o--o| "Job (Users and jobs)" : "changed by job"
  "Commission payment" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Commission payment" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Commission payment" }o--|| "Commission" : "deal ID"
  "Commission payment" }o--o| "Job (Users and jobs)" : "changed by job"
  "Commission share" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Commission share" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Commission share" }o--|| "Commission" : "deal ID"
  "Commission share" }o--o| "Job (Users and jobs)" : "changed by job"
  "Commission share" }o--|| "Party (People)" : "party ID"
  "Commission tier" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Commission tier" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Commission tier" }o--|| "App user (Users and jobs)" : "partner user ID"
  "Commission tier" }o--|| "App user (Users and jobs)" : "user ID"
  "Commission tier" }o--o| "Job (Users and jobs)" : "changed by job"
  "Invoice email (Invoices)" }o--o| "Commission payment" : "payment ID, deal ID"
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
