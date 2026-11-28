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
  "Activity about (Activity)" }o--o| "Deal" : "deal ID"
  "Commission (Commissions)" |o--|| "Deal" : "deal ID"
  "Critical date (Leases)" }o--|| "Deal" : "deal ID"
  "Deal" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Deal" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Deal" }o--|| "App user (Users and jobs)" : "owner user ID"
  "Deal" }o--o| "App user (Users and jobs)" : "parked by user ID"
  "Deal" }o--o| "Deal kind" : "kind"
  "Deal" }o--o| "Deal reason" : "reason"
  "Deal" }o--o| "Job (Users and jobs)" : "changed by job"
  "Deal" }o--o| "Lease (Leases)" : "renews lease ID"
  "Deal" }o--o| "Market (Vendors and territories)" : "market ID"
  "Deal attention alert (Activity)" |o--|| "Deal" : "deal ID"
  "Deal client website (Client websites)" }o--|| "Deal" : "deal ID"
  "Deal kind" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Deal kind" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Deal kind" }o--o| "Job (Users and jobs)" : "changed by job"
  "Deal open name" |o--|| "Deal" : "deal ID"
  "Deal party" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Deal party" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Deal party" }o--|| "Deal" : "deal ID"
  "Deal party" }o--o| "Job (Users and jobs)" : "changed by job"
  "Deal party" }o--|| "Party (People)" : "party ID"
  "Deal party" }o--o| "Party role (Relationships)" : "party ID, client role"
  "Deal party" }o--|| "Role (Relationships)" : "role"
  "Deal phase change" }o--o| "Activity (Activity)" : "call activity ID, call kind"
  "Deal phase change" }o--o| "Activity about (Activity)" : "call activity ID, deal ID"
  "Deal phase change" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Deal phase change" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Deal phase change" }o--|| "Deal" : "deal ID"
  "Deal phase change" }o--o| "Job (Users and jobs)" : "changed by job"
  "Deal phase change" }o--|| "Phase" : "phase"
  "Deal property (Property)" }o--|| "Deal" : "deal ID"
  "Deal reason" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Deal reason" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Deal reason" }o--o| "Job (Users and jobs)" : "changed by job"
  "Doc judgment destination (Doc)" }o--o| "Deal" : "deal ID"
  "Document (Documents)" }o--o| "Deal" : "deal ID"
  "Home update (Home and calendar)" }o--|| "Deal" : "deal ID"
  "Imported automatic phase move (Imported deals)" |o--|| "Deal phase change" : "deal ID, happened at"
  "Imported automatic phase move (Imported deals)" }o--|| "Phase" : "prior phase"
  "Imported deal board (Imported deals)" |o--|| "Deal" : "deal ID"
  "Imported deal board (Imported deals)" }o--o| "Deal phase change" : "deal ID, phase at"
  "Imported deal board (Imported deals)" }o--o| "Phase" : "phase"
  "Imported deal history (Imported deals)" }o--|| "Deal" : "deal ID"
  "Imported deal invoiced (Imported deals)" |o--|| "Deal" : "deal ID"
  "Imported deal owner (Imported deals)" }o--|| "Deal" : "deal ID"
  "Imported deal party (Imported deals)" }o--|| "Deal" : "deal ID"
  "Introduction (Relationships)" }o--o| "Deal" : "deal ID"
  "Introduction (Relationships)" }o--o| "Deal party" : "deal ID, introduced party ID, maker client role"
  "Invoice email (Invoices)" }o--o| "Deal" : "deal ID"
  "Invoice email (Invoices)" }o--o| "Deal phase change" : "deal ID, applied phase at"
  "Invoice email (Invoices)" }o--o| "Deal phase change" : "deal ID, prior phase at"
  "Lead stage move (Leads)" }o--|| "Stage" : "role, from stage"
  "Lead stage move (Leads)" }o--|| "Stage" : "role, to stage"
  "Lease (Leases)" |o--o| "Deal" : "deal ID"
  "Lease (Leases)" }o--o| "Deal party" : "deal ID, party ID, client role"
  "Next step (Activity)" }o--o| "Deal" : "deal ID"
  "Offer (Offers)" }o--|| "Deal party" : "deal ID, from party ID, from role"
  "Outside ID (People)" }o--o| "Deal" : "deal ID"
  "Party role (Relationships)" }o--o| "Stage" : "role, stage"
  "Phase" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Phase" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Phase" }o--o| "Job (Users and jobs)" : "changed by job"
  "Proposal (Offers)" }o--o| "Deal" : "deal ID"
  "Proposal (Offers)" }o--o| "Deal" : "filed deal ID"
  "Proposal (Offers)" }o--o| "Phase" : "from phase"
  "Proposal (Offers)" }o--o| "Phase" : "to phase"
  "Proposal (Offers)" }o--o| "Stage" : "lead role, from stage"
  "Proposal (Offers)" }o--o| "Stage" : "lead role, to stage"
  "Space need (Property)" }o--|| "Deal" : "deal ID"
  "Stage" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Stage" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Stage" }o--o| "Job (Users and jobs)" : "changed by job"
  "Stage" }o--|| "Role (Relationships)" : "role"
  "Tour plan (Tours)" }o--|| "Deal" : "deal ID"
  "Typical length" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Typical length" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Typical length" }o--|| "Deal kind" : "deal kind"
  "Typical length" }o--o| "Job (Users and jobs)" : "changed by job"
  "Weekly review (Home and calendar)" }o--o| "Deal" : "deal ID"
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
