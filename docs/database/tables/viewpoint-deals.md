# Deals

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Deal"
  "Deal kind"
  "Deal open name"
  "Deal party"
  "Deal phase change"
  "Deal reason"
  "Deal star"
  "Phase"
  "Stage"
  "Typical length"
  "Deal" }o--o| "Deal kind" : "kind"
  "Deal" }o--o| "Deal reason" : "reason"
  "Deal open name" |o--|| "Deal" : "deal ID"
  "Deal party" }o--|| "Deal" : "deal ID"
  "Deal phase change" }o--|| "Deal" : "deal ID"
  "Deal phase change" }o--|| "Phase" : "phase"
  "Deal star" }o--|| "Deal" : "deal ID"
  "Typical length" }o--|| "Deal kind" : "deal kind"
```

## Tables

- [Deal](next.deal.md)
- [Deal kind](next.deal_kind.md)
- [Deal open name](next.deal_open_name.md)
- [Deal party](next.deal_party.md)
- [Deal phase change](next.deal_phase_change.md)
- [Deal reason](next.deal_reason.md)
- [Deal star](next.deal_star.md)
- [Phase](next.phase.md)
- [Stage](next.stage.md)
- [Typical length](next.typical_length.md)

See each table for its columns and links to other areas.
