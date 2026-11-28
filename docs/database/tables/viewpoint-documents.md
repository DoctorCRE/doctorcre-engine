# Documents

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Document"
  "Document extraction"
  "Document kind"
  "Party document"
  "Critical date (Leases)" }o--o| "Document" : "document ID"
  "Document" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Document" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Document" }o--o| "Deal (Deals)" : "deal ID"
  "Document" }o--o| "Document" : "supersedes ID, deal ID, kind, previous version#160;#160;#160;#160;"
  "Document" }o--o| "Document kind" : "kind"
  "Document" }o--o| "Job (Users and jobs)" : "changed by job"
  "Document extraction" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Document extraction" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Document extraction" }o--|| "Document" : "document ID, deal ID"
  "Document extraction" }o--o| "Job (Users and jobs)" : "changed by job"
  "Document kind" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Document kind" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Document kind" }o--o| "Job (Users and jobs)" : "changed by job"
  "Email document (Email)" }o--|| "Document" : "document ID"
  "Lease version (Leases)" }o--|| "Document" : "document ID"
  "Offer document (Offers)" }o--|| "Document" : "document ID"
  "Party document" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Party document" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Party document" }o--|| "Document" : "document ID"
  "Party document" }o--o| "Job (Users and jobs)" : "changed by job"
  "Party document" }o--|| "Party (People)" : "party ID"
  "Post media (Marketing posts)" }o--|| "Document" : "document ID, content type"
  "Reply draft document (Email)" }o--|| "Document" : "document ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Deals](viewpoint-deals.md) (1) · [Email](viewpoint-email.md) (2) · [Leases](viewpoint-leases.md) (2) · [Marketing posts](viewpoint-marketing-posts.md) (1) · [Offers](viewpoint-offers.md) (1) · [People](viewpoint-people.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (12)

## Tables

- [Document](next.document.md)
- [Document extraction](next.document_extraction.md)
- [Document kind](next.document_kind.md)
- [Party document](next.party_document.md)

See each table for its columns and links to other areas.
