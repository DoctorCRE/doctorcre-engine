# Clients

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Client"
  "Client brand"
  "Client research"
  "Client research fact"
  "Client type"
  "Client vertical"
  "National account"
  "National account owner"
  "Client" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Client" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Client" }o--o| "App user (Users and jobs)" : "owner user ID"
  "Client" }o--o| "Client type" : "client type"
  "Client" }o--o| "Job (Users and jobs)" : "changed by job"
  "Client" }o--|| "Party role (Relationships)" : "party ID, role"
  "Client brand" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Client brand" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Client brand" }o--|| "Client" : "location ID"
  "Client brand" }o--o| "Job (Users and jobs)" : "changed by job"
  "Client brand" }o--o| "Party (People)" : "brand ID, brand kind"
  "Client research" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Client research" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Client research" }o--o| "Job (Users and jobs)" : "changed by job"
  "Client research" }o--|| "Party role (Relationships)" : "party ID, role"
  "Client research fact" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Client research fact" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Client research fact" }o--|| "Client research" : "research ID"
  "Client research fact" }o--o| "Job (Users and jobs)" : "changed by job"
  "Client type" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Client type" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Client type" }o--o| "Job (Users and jobs)" : "changed by job"
  "Client vertical" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Client vertical" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Client vertical" }o--o| "Job (Users and jobs)" : "changed by job"
  "Client vertical" }o--|| "Party role (Relationships)" : "party ID, role"
  "National account" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "National account" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "National account" }o--o| "Job (Users and jobs)" : "changed by job"
  "National account" }o--o| "Party (People)" : "party ID, kind"
  "National account" }o--|| "Party role (Relationships)" : "party ID, role"
  "National account owner" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "National account owner" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "National account owner" }o--o| "App user (Users and jobs)" : "owner ID, owner is partner"
  "National account owner" }o--o| "Job (Users and jobs)" : "changed by job"
  "National account owner" }o--|| "National account" : "account ID"
  "Party role (Relationships)" }o--o| "Client" : "lead client ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[People](viewpoint-people.md) (2) · [Relationships](viewpoint-relationships.md) (5) · [Users and jobs](viewpoint-users-jobs.md) (26)

## Tables

- [Client](next.client.md)
- [Client brand](next.client_brand.md)
- [Client research](next.client_research.md)
- [Client research fact](next.client_research_fact.md)
- [Client type](next.client_type.md)
- [Client vertical](next.client_vertical.md)
- [National account](next.national_account.md)
- [National account owner](next.national_account_owner.md)

See each table for its columns and links to other areas.
