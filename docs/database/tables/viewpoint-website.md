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
  "Deal client website" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Deal client website" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Deal client website" }o--|| "Deal (Deals)" : "deal ID"
  "Deal client website" }o--o| "Job (Users and jobs)" : "changed by job"
  "Deal client website" }o--|| "Party (People)" : "client party ID"
  "Deal client website attempt" |o--|| "Deal client website" : "slug"
  "Deal client website grant" }o--|| "App user (Users and jobs)" : "user ID"
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
