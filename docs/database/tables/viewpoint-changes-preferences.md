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
  "Change" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Change" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Change" }o--o| "Job (Users and jobs)" : "changed by job"
  "Change" }o--o| "Merged party (People)" : "merge of"
  "Doc turn (Doc)" |o--o| "Save receipt" : "confirmation key"
  "Imported change" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Imported change" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Imported change" }o--o| "Job (Users and jobs)" : "changed by job"
  "Invoice email (Invoices)" }o--o| "Change" : "payment change ID"
  "User preference" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "User preference" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "User preference" |o--|| "App user (Users and jobs)" : "user ID"
  "User preference" }o--o| "Job (Users and jobs)" : "changed by job"
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
