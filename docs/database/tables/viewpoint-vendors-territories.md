# Vendors and territories

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Market"
  "Market city"
  "Market county"
  "Party territory"
  "Party territory review"
  "Territory"
  "Territory piece"
  "Vendor loan program"
  "Vendor vertical"
  "Deals (area)" {
    string deal
  }
  "People (area)" {
    string party
  }
  "Property (area)" {
    string space_need
  }
  "Relationships (area)" {
    string party_role
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Deals (area)" }o--o| "Market" : "Deal: market ID"
  "Market" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Market" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Market" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Market city" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Market city" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Market city" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Market city" }o--|| "Market" : "market ID"
  "Market county" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Market county" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Market county" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Market county" }o--|| "Market" : "market ID"
  "Party territory" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Party territory" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Party territory" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Party territory" }o--|| "People (area)" : "party ID to Party"
  "Party territory" }o--|| "Territory" : "territory ID"
  "Party territory review" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Party territory review" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Party territory review" }o--o| "Users and jobs (area)" : "reviewed by user ID to App user"
  "Party territory review" }o--o| "Users and jobs (area)" : "reviewed for user ID to App user"
  "Party territory review" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Party territory review" }o--o| "Users and jobs (area)" : "reviewed by job to Job"
  "Party territory review" |o--|| "Party territory" : "party territory ID"
  "Property (area)" }o--o| "Market" : "Space need: market ID"
  "Territory" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Territory" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Territory" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Territory piece" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Territory piece" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Territory piece" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Territory piece" }o--o| "Market" : "market ID"
  "Territory piece" }o--|| "Territory" : "territory ID"
  "Vendor loan program" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Vendor loan program" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Vendor loan program" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Vendor loan program" }o--|| "Relationships (area)" : "party ID, role to Party role"
  "Vendor vertical" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Vendor vertical" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Vendor vertical" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Vendor vertical" }o--|| "Relationships (area)" : "party ID, role to Party role"
```

## Connects to

Numbers count foreign keys between the two areas.

[Deals](viewpoint-deals.md) (1) · [People](viewpoint-people.md) (1) · [Property](viewpoint-property.md) (1) · [Relationships](viewpoint-relationships.md) (2) · [Users and jobs](viewpoint-users-jobs.md) (30)

## Tables

- [Market](next.market.md)
- [Market city](next.market_city.md)
- [Market county](next.market_county.md)
- [Party territory](next.party_territory.md)
- [Party territory review](next.party_territory_review.md)
- [Territory](next.territory.md)
- [Territory piece](next.territory_piece.md)
- [Vendor loan program](next.vendor_loan_program.md)
- [Vendor vertical](next.vendor_vertical.md)

See each table for its columns and links to other areas.
