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
  "Phase"
  "Stage"
  "Typical length"
  "Deal" }o--o| "Deal kind" : "kind"
  "Deal" }o--o| "Deal reason" : "reason"
  "Deal open name" |o--|| "Deal" : "deal ID"
  "Deal party" }o--|| "Deal" : "deal ID"
  "Deal phase change" }o--|| "Deal" : "deal ID"
  "Deal phase change" }o--|| "Phase" : "phase"
  "Typical length" }o--|| "Deal kind" : "deal kind"
```

## Connects to

Numbers count foreign keys between the two areas.

[Activity](viewpoint-activity.md) (5) · [Client websites](viewpoint-website.md) (1) · [Commissions](viewpoint-commissions.md) (1) · [Doc](viewpoint-doc.md) (1) · [Documents](viewpoint-documents.md) (1) · [Home and calendar](viewpoint-home-calendar.md) (2) · [Imported deals](viewpoint-imported-deals.md) (9) · [Invoices](viewpoint-invoices.md) (3) · [Leads](viewpoint-leads.md) (2) · [Leases](viewpoint-leases.md) (4) · [Offers](viewpoint-offers.md) (7) · [People](viewpoint-people.md) (2) · [Property](viewpoint-property.md) (2) · [Relationships](viewpoint-relationships.md) (6) · [Tours](viewpoint-tours.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (26) · [Vendors and territories](viewpoint-vendors-territories.md) (1)

## Tables

- [Deal](next.deal.md)
- [Deal kind](next.deal_kind.md)
- [Deal open name](next.deal_open_name.md)
- [Deal party](next.deal_party.md)
- [Deal phase change](next.deal_phase_change.md)
- [Deal reason](next.deal_reason.md)
- [Phase](next.phase.md)
- [Stage](next.stage.md)
- [Typical length](next.typical_length.md)

See each table for its columns and links to other areas.
