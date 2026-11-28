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
  "Tour plan" }o--o| "Activity (Activity)" : "completed activity ID, completed activity kind"
  "Tour plan" }o--o| "Activity about (Activity)" : "completed activity ID, deal ID"
  "Tour plan" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Tour plan" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Tour plan" }o--|| "Deal (Deals)" : "deal ID"
  "Tour plan" }o--o| "Job (Users and jobs)" : "changed by job"
  "Tour stop" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Tour stop" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Tour stop" }o--o| "Job (Users and jobs)" : "changed by job"
  "Tour stop" }o--|| "Property (Property)" : "property ID"
  "Tour stop" }o--|| "Tour plan" : "tour plan ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Activity](viewpoint-activity.md) (2) · [Deals](viewpoint-deals.md) (1) · [Property](viewpoint-property.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (6)

## Tables

- [Tour plan](next.tour_plan.md)
- [Tour stop](next.tour_stop.md)

See each table for its columns and links to other areas.
