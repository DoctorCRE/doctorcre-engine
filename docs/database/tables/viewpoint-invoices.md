# Invoices

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Invoice email"
  "Invoice mailbox"
  "Invoice email" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Invoice email" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Invoice email" }o--o| "Change (Changes and preferences)" : "payment change ID"
  "Invoice email" }o--o| "Commission payment (Commissions)" : "payment ID, deal ID"
  "Invoice email" }o--o| "Deal (Deals)" : "deal ID"
  "Invoice email" }o--o| "Deal phase change (Deals)" : "deal ID, applied phase at"
  "Invoice email" }o--o| "Deal phase change (Deals)" : "deal ID, prior phase at"
  "Invoice email" }o--o| "Invoice email" : "application ID, deal ID, payment ID, email date#160;#160;#160;#160;"
  "Invoice email" }o--o| "Job (Users and jobs)" : "changed by job"
  "Invoice mailbox" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Invoice mailbox" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Invoice mailbox" }o--o| "Job (Users and jobs)" : "changed by job"
```

## Connects to

Numbers count foreign keys between the two areas.

[Changes and preferences](viewpoint-changes-preferences.md) (1) · [Commissions](viewpoint-commissions.md) (1) · [Deals](viewpoint-deals.md) (3) · [Users and jobs](viewpoint-users-jobs.md) (6)

## Tables

- [Invoice email](next.invoice_email.md)
- [Invoice mailbox](next.invoice_mailbox.md)

See each table for its columns and links to other areas.
