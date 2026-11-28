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
  "Deal (Deals)" }o--o| "Market" : "market ID"
  "Market" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Market" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Market" }o--o| "Job (Users and jobs)" : "changed by job"
  "Market city" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Market city" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Market city" }o--o| "Job (Users and jobs)" : "changed by job"
  "Market city" }o--|| "Market" : "market ID"
  "Market county" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Market county" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Market county" }o--o| "Job (Users and jobs)" : "changed by job"
  "Market county" }o--|| "Market" : "market ID"
  "Party territory" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Party territory" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Party territory" }o--o| "Job (Users and jobs)" : "changed by job"
  "Party territory" }o--|| "Party (People)" : "party ID"
  "Party territory" }o--|| "Territory" : "territory ID"
  "Party territory review" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Party territory review" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Party territory review" }o--o| "App user (Users and jobs)" : "reviewed by user ID"
  "Party territory review" }o--o| "App user (Users and jobs)" : "reviewed for user ID"
  "Party territory review" }o--o| "Job (Users and jobs)" : "changed by job"
  "Party territory review" }o--o| "Job (Users and jobs)" : "reviewed by job"
  "Party territory review" |o--|| "Party territory" : "party territory ID"
  "Space need (Property)" }o--o| "Market" : "market ID"
  "Territory" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Territory" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Territory" }o--o| "Job (Users and jobs)" : "changed by job"
  "Territory piece" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Territory piece" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Territory piece" }o--o| "Job (Users and jobs)" : "changed by job"
  "Territory piece" }o--o| "Market" : "market ID"
  "Territory piece" }o--|| "Territory" : "territory ID"
  "Vendor loan program" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Vendor loan program" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Vendor loan program" }o--o| "Job (Users and jobs)" : "changed by job"
  "Vendor loan program" }o--|| "Party role (Relationships)" : "party ID, role"
  "Vendor vertical" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Vendor vertical" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Vendor vertical" }o--o| "Job (Users and jobs)" : "changed by job"
  "Vendor vertical" }o--|| "Party role (Relationships)" : "party ID, role"
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
