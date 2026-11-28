# Doc

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Doc conversation"
  "Doc judgment destination"
  "Doc judgment job"
  "Doc link"
  "Doc turn"
  "Changes and preferences (area)" {
    string save_receipt
  }
  "Deals (area)" {
    string deal
  }
  "Email (area)" {
    string email_mailbox
    string reply_draft
  }
  "People (area)" {
    string party
  }
  "Relationships (area)" {
    string introduction
    string party_role
  }
  "Users and jobs (area)" {
    string app_user
  }
  "Doc conversation" }o--|| "Users and jobs (area)" : "owner user ID, is account partner to App user"
  "Doc judgment destination" }o--o| "Deals (area)" : "deal ID to Deal"
  "Doc judgment destination" }o--o| "Doc judgment job" : "job ID, job kind"
  "Doc judgment destination" }o--o| "People (area)" : "vendor ID to Party"
  "Doc judgment destination" }o--o| "Relationships (area)" : "vendor ID, vendor role to Party role"
  "Doc judgment job" }o--|| "Users and jobs (area)" : "owner user ID, is account partner to App user"
  "Doc judgment job" }o--o| "Doc judgment destination" : "ID, first destination"
  "Doc judgment job" }o--|| "Email (area)" : "activity ID, owner user ID to Email mailbox"
  "Doc link" }o--|| "Users and jobs (area)" : "owner user ID, is account partner to App user"
  "Doc turn" }o--|| "Doc conversation" : "conversation ID, owner user ID"
  "Doc turn" |o--o| "Changes and preferences (area)" : "confirmation key to Save receipt"
  "Relationships (area)" }o--o| "Doc judgment job" : "Introduction: source job ID"
  "Email (area)" }o--o| "Doc turn" : "Reply draft: confirmed doc turn ID, owner user ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Changes and preferences](viewpoint-changes-preferences.md) (1) · [Deals](viewpoint-deals.md) (1) · [Email](viewpoint-email.md) (2) · [People](viewpoint-people.md) (1) · [Relationships](viewpoint-relationships.md) (2) · [Users and jobs](viewpoint-users-jobs.md) (3)

## Tables

- [Doc conversation](next.doc_conversation.md)
- [Doc judgment destination](next.doc_judgment_destination.md)
- [Doc judgment job](next.doc_judgment_job.md)
- [Doc link](next.doc_link.md)
- [Doc turn](next.doc_turn.md)

See each table for its columns and links to other areas.
