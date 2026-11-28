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
  "Doc conversation" }o--|| "App user (Users and jobs)" : "owner user ID, is account partner"
  "Doc judgment destination" }o--o| "Deal (Deals)" : "deal ID"
  "Doc judgment destination" }o--o| "Doc judgment job" : "job ID, job kind"
  "Doc judgment destination" }o--o| "Party (People)" : "vendor ID"
  "Doc judgment destination" }o--o| "Party role (Relationships)" : "vendor ID, vendor role"
  "Doc judgment job" }o--|| "App user (Users and jobs)" : "owner user ID, is account partner"
  "Doc judgment job" }o--o| "Doc judgment destination" : "ID, first destination"
  "Doc judgment job" }o--|| "Email mailbox (Email)" : "activity ID, owner user ID"
  "Doc link" }o--|| "App user (Users and jobs)" : "owner user ID, is account partner"
  "Doc turn" }o--|| "Doc conversation" : "conversation ID, owner user ID"
  "Doc turn" |o--o| "Save receipt (Changes and preferences)" : "confirmation key"
  "Introduction (Relationships)" }o--o| "Doc judgment job" : "source job ID"
  "Reply draft (Email)" }o--o| "Doc turn" : "confirmed doc turn ID, owner user ID"
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
