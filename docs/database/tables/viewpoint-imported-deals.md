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
  "Deals (area)" {
    string deal
    string deal_phase_change
    string phase
  }
  "People (area)" {
    string party
  }
  "Relationships (area)" {
    string role
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Imported automatic phase move" |o--|| "Deals (area)" : "deal ID, happened at to Deal phase change"
  "Imported automatic phase move" }o--|| "Deals (area)" : "prior phase to Phase"
  "Imported deal board" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Imported deal board" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Imported deal board" |o--|| "Deals (area)" : "deal ID to Deal"
  "Imported deal board" }o--o| "Deals (area)" : "deal ID, phase at to Deal phase change"
  "Imported deal board" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Imported deal board" }o--o| "Deals (area)" : "phase to Phase"
  "Imported deal history" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Imported deal history" }o--|| "Deals (area)" : "deal ID to Deal"
  "Imported deal history" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Imported deal invoiced" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Imported deal invoiced" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Imported deal invoiced" |o--|| "Deals (area)" : "deal ID to Deal"
  "Imported deal invoiced" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Imported deal owner" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Imported deal owner" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Imported deal owner" }o--|| "Users and jobs (area)" : "user ID to App user"
  "Imported deal owner" }o--|| "Deals (area)" : "deal ID to Deal"
  "Imported deal owner" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Imported deal party" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Imported deal party" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Imported deal party" }o--|| "Deals (area)" : "deal ID to Deal"
  "Imported deal party" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Imported deal party" }o--|| "People (area)" : "party ID to Party"
  "Imported deal party" }o--|| "Relationships (area)" : "role to Role"
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
