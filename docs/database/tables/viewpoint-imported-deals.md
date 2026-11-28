# Imported deals

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Imported automatic phase move"
  "Imported deal board"
  "Imported deal history"
  "Imported deal invoiced"
  "Imported deal owner"
  "Imported deal party"
  "Imported automatic phase move" |o--|| "Deal phase change (Deals)" : "deal ID, happened at"
  "Imported automatic phase move" }o--|| "Phase (Deals)" : "prior phase"
  "Imported deal board" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Imported deal board" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Imported deal board" |o--|| "Deal (Deals)" : "deal ID"
  "Imported deal board" }o--o| "Deal phase change (Deals)" : "deal ID, phase at"
  "Imported deal board" }o--o| "Job (Users and jobs)" : "changed by job"
  "Imported deal board" }o--o| "Phase (Deals)" : "phase"
  "Imported deal history" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Imported deal history" }o--|| "Deal (Deals)" : "deal ID"
  "Imported deal history" }o--o| "Job (Users and jobs)" : "changed by job"
  "Imported deal invoiced" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Imported deal invoiced" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Imported deal invoiced" |o--|| "Deal (Deals)" : "deal ID"
  "Imported deal invoiced" }o--o| "Job (Users and jobs)" : "changed by job"
  "Imported deal owner" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Imported deal owner" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Imported deal owner" }o--|| "App user (Users and jobs)" : "user ID"
  "Imported deal owner" }o--|| "Deal (Deals)" : "deal ID"
  "Imported deal owner" }o--o| "Job (Users and jobs)" : "changed by job"
  "Imported deal party" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Imported deal party" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Imported deal party" }o--|| "Deal (Deals)" : "deal ID"
  "Imported deal party" }o--o| "Job (Users and jobs)" : "changed by job"
  "Imported deal party" }o--|| "Party (People)" : "party ID"
  "Imported deal party" }o--|| "Role (Relationships)" : "role"
```

## Connects to

Numbers count foreign keys between the two areas.

[Deals](viewpoint-deals.md) (9) · [People](viewpoint-people.md) (1) · [Relationships](viewpoint-relationships.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (15)

## Tables

- [Imported automatic phase move](next.imported_automatic_phase_move.md)
- [Imported deal board](next.imported_deal_board.md)
- [Imported deal history](next.imported_deal_history.md)
- [Imported deal invoiced](next.imported_deal_invoiced.md)
- [Imported deal owner](next.imported_deal_owner.md)
- [Imported deal party](next.imported_deal_party.md)

See each table for its columns and links to other areas.
