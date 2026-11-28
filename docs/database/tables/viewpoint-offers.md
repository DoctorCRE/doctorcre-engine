# Offers

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Offer"
  "Offer claim"
  "Offer document"
  "Proposal"
  "Offer" }o--o| "Offer" : "deal ID, answers round#160;#160;#160;#160;"
  "Offer claim" }o--|| "Offer" : "offer ID"
  "Offer document" }o--|| "Offer" : "offer ID"
```

## Tables

- [Offer](next.offer.md)
- [Offer claim](next.offer_claim.md)
- [Offer document](next.offer_document.md)
- [Proposal](next.proposal.md)

See each table for its columns and links to other areas.
