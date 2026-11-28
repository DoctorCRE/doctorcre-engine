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
  "Client" }o--o| "Client type" : "client type"
  "Client brand" }o--|| "Client" : "location ID"
  "Client research fact" }o--|| "Client research" : "research ID"
  "National account owner" }o--|| "National account" : "account ID"
```

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
