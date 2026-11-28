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
  "Changes and preferences (area)" {
    string change
  }
  "Commissions (area)" {
    string commission_payment
  }
  "Deals (area)" {
    string deal
    string deal_phase_change
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Invoice email" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Invoice email" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Invoice email" }o--o| "Changes and preferences (area)" : "payment change ID to Change"
  "Invoice email" }o--o| "Commissions (area)" : "payment ID, deal ID to Commission payment"
  "Invoice email" }o--o| "Deals (area)" : "deal ID to Deal"
  "Invoice email" }o--o| "Deals (area)" : "deal ID, applied phase at to Deal phase change"
  "Invoice email" }o--o| "Deals (area)" : "deal ID, prior phase at to Deal phase change"
  "Invoice email" }o--o| "Invoice email" : "application ID, deal ID, payment ID, email date#160;#160;#160;#160;"
  "Invoice email" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Invoice mailbox" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Invoice mailbox" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Invoice mailbox" }o--o| "Users and jobs (area)" : "changed by job to Job"
```

## Connects to

Numbers count foreign keys between the two areas.

[Changes and preferences](viewpoint-changes-preferences.md) (1) · [Commissions](viewpoint-commissions.md) (1) · [Deals](viewpoint-deals.md) (3) · [Users and jobs](viewpoint-users-jobs.md) (6)

## Tables

- [Invoice email](next.invoice_email.md)
- [Invoice mailbox](next.invoice_mailbox.md)

See each table for its columns and links to other areas.
