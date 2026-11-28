# Tours

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Tour plan"
  "Tour stop"
  "Activity (area)" {
    string activity
    string activity_about
  }
  "Deals (area)" {
    string deal
  }
  "Property (area)" {
    string property
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Tour plan" }o--o| "Activity (area)" : "completed activity ID, completed activity kind to Activity"
  "Tour plan" }o--o| "Activity (area)" : "completed activity ID, deal ID to Activity about"
  "Tour plan" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Tour plan" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Tour plan" }o--|| "Deals (area)" : "deal ID to Deal"
  "Tour plan" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Tour stop" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Tour stop" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Tour stop" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Tour stop" }o--|| "Property (area)" : "property ID to Property"
  "Tour stop" }o--|| "Tour plan" : "tour plan ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Activity](viewpoint-activity.md) (2) · [Deals](viewpoint-deals.md) (1) · [Property](viewpoint-property.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (6)

## Tables

- [Tour plan](next.tour_plan.md)
- [Tour stop](next.tour_stop.md)

See each table for its columns and links to other areas.
