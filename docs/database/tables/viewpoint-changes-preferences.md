# Changes and preferences

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Change"
  "Imported change"
  "Save receipt"
  "User preference"
  "Doc (area)" {
    string doc_turn
  }
  "Invoices (area)" {
    string invoice_email
  }
  "People (area)" {
    string merged_party
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Change" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Change" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Change" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Change" }o--o| "People (area)" : "merge of to Merged party"
  "Doc (area)" |o--o| "Save receipt" : "Doc turn: confirmation key"
  "Imported change" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Imported change" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Imported change" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Invoices (area)" }o--o| "Change" : "Invoice email: payment change ID"
  "User preference" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "User preference" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "User preference" |o--|| "Users and jobs (area)" : "user ID to App user"
  "User preference" }o--o| "Users and jobs (area)" : "changed by job to Job"
```

## Connects to

Numbers count foreign keys between the two areas.

[Doc](viewpoint-doc.md) (1) · [Invoices](viewpoint-invoices.md) (1) · [People](viewpoint-people.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (10)

## Tables

- [Change](next.change.md)
- [Imported change](next.imported_change.md)
- [Save receipt](next.save_receipt.md)
- [User preference](next.user_preference.md)

See each table for its columns and links to other areas.
