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
  "People (area)" {
    string party
  }
  "Relationships (area)" {
    string party_role
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Client" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Client" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Client" }o--o| "Users and jobs (area)" : "owner user ID to App user"
  "Client" }o--o| "Client type" : "client type"
  "Client" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Client" }o--|| "Relationships (area)" : "party ID, role to Party role"
  "Client brand" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Client brand" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Client brand" }o--|| "Client" : "location ID"
  "Client brand" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Client brand" }o--o| "People (area)" : "brand ID, brand kind to Party"
  "Client research" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Client research" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Client research" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Client research" }o--|| "Relationships (area)" : "party ID, role to Party role"
  "Client research fact" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Client research fact" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Client research fact" }o--|| "Client research" : "research ID"
  "Client research fact" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Client type" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Client type" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Client type" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Client vertical" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Client vertical" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Client vertical" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Client vertical" }o--|| "Relationships (area)" : "party ID, role to Party role"
  "National account" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "National account" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "National account" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "National account" }o--o| "People (area)" : "party ID, kind to Party"
  "National account" }o--|| "Relationships (area)" : "party ID, role to Party role"
  "National account owner" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "National account owner" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "National account owner" }o--o| "Users and jobs (area)" : "owner ID, owner is partner to App user"
  "National account owner" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "National account owner" }o--|| "National account" : "account ID"
  "Relationships (area)" }o--o| "Client" : "Party role: lead client ID"
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
