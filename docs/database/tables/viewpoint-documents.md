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
  "Deals (area)" {
    string deal
  }
  "Email (area)" {
    string email_document
    string reply_draft_document
  }
  "Leases (area)" {
    string critical_date
    string lease_version
  }
  "Marketing posts (area)" {
    string post_media
  }
  "Offers (area)" {
    string offer_document
  }
  "People (area)" {
    string party
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Leases (area)" }o--o| "Document" : "Critical date: document ID"
  "Document" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Document" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Document" }o--o| "Deals (area)" : "deal ID to Deal"
  "Document" }o--o| "Document" : "supersedes ID, deal ID, kind, previous version#160;#160;#160;#160;"
  "Document" }o--o| "Document kind" : "kind"
  "Document" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Document extraction" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Document extraction" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Document extraction" }o--|| "Document" : "document ID, deal ID"
  "Document extraction" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Document kind" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Document kind" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Document kind" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Email (area)" }o--|| "Document" : "Email document: document ID"
  "Leases (area)" }o--|| "Document" : "Lease version: document ID"
  "Offers (area)" }o--|| "Document" : "Offer document: document ID"
  "Party document" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Party document" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Party document" }o--|| "Document" : "document ID"
  "Party document" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Party document" }o--|| "People (area)" : "party ID to Party"
  "Marketing posts (area)" }o--|| "Document" : "Post media: document ID, content type"
  "Email (area)" }o--|| "Document" : "Reply draft document: document ID"
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
