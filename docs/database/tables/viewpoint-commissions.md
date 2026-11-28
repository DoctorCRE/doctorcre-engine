# Commissions

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Commission"
  "Commission payment"
  "Commission share"
  "Commission tier"
  "Commission payment" }o--|| "Commission" : "deal ID"
  "Commission share" }o--|| "Commission" : "deal ID"
```

## Tables

- [Commission](next.commission.md)
- [Commission payment](next.commission_payment.md)
- [Commission share](next.commission_share.md)
- [Commission tier](next.commission_tier.md)

See each table for its columns and links to other areas.
