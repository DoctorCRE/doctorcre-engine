# Client websites

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Deal client website"
  "Deal client website attempt"
  "Deal client website grant"
  "Deals (area)" {
    string deal
  }
  "People (area)" {
    string party
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Deal client website" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Deal client website" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Deal client website" }o--|| "Deals (area)" : "deal ID to Deal"
  "Deal client website" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Deal client website" }o--|| "People (area)" : "client party ID to Party"
  "Deal client website attempt" |o--|| "Deal client website" : "slug"
  "Deal client website grant" }o--|| "Users and jobs (area)" : "user ID to App user"
  "Deal client website grant" }o--|| "Deal client website" : "slug"
```

## Connects to

Numbers count foreign keys between the two areas.

[Deals](viewpoint-deals.md) (1) · [People](viewpoint-people.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (4)

## Tables

- [Deal client website](next.deal_client_website.md)
- [Deal client website attempt](next.deal_client_website_attempt.md)
- [Deal client website grant](next.deal_client_website_grant.md)

See each table for its columns and links to other areas.
