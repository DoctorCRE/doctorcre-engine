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
  "Market city" }o--|| "Market" : "market ID"
  "Market county" }o--|| "Market" : "market ID"
  "Party territory" }o--|| "Territory" : "territory ID"
  "Party territory review" |o--|| "Party territory" : "party territory ID"
  "Territory piece" }o--o| "Market" : "market ID"
  "Territory piece" }o--|| "Territory" : "territory ID"
```

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
