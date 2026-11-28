# Home and calendar

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Calendar agenda"
  "Calendar review dismissal"
  "Home mark"
  "Home update"
  "Weekly review"
  "Calendar agenda" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Calendar agenda" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Calendar agenda" |o--|| "App user (Users and jobs)" : "user ID"
  "Calendar agenda" }o--o| "Job (Users and jobs)" : "changed by job"
  "Calendar review dismissal" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Calendar review dismissal" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Calendar review dismissal" }o--|| "App user (Users and jobs)" : "user ID"
  "Calendar review dismissal" }o--o| "Job (Users and jobs)" : "changed by job"
  "Home mark" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Home mark" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Home mark" }o--|| "App user (Users and jobs)" : "user ID"
  "Home mark" }o--o| "Home update" : "home update ID, user ID"
  "Home mark" }o--o| "Job (Users and jobs)" : "changed by job"
  "Home mark" }o--o| "Next step (Activity)" : "call follow up ID"
  "Home mark" }o--o| "Next step (Activity)" : "next step ID"
  "Home mark" }o--o| "Party (People)" : "waiting on party ID"
  "Home mark" }o--o| "Proposal (Offers)" : "proposal ID"
  "Home mark" }o--o| "Reply draft (Email)" : "reply draft ID, user ID"
  "Home update" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Home update" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Home update" }o--|| "App user (Users and jobs)" : "user ID"
  "Home update" }o--|| "Deal (Deals)" : "deal ID"
  "Home update" }o--o| "Job (Users and jobs)" : "changed by job"
  "Home update" }o--o| "Property (Property)" : "property ID"
  "Weekly review" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Weekly review" }o--o| "App user (Users and jobs)" : "changed by user ID, reviewer is partner"
  "Weekly review" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Weekly review" }o--o| "Deal (Deals)" : "deal ID"
  "Weekly review" }o--o| "Job (Users and jobs)" : "changed by job"
  "Weekly review" }o--o| "Party role (Relationships)" : "party ID, lead role"
```

## Connects to

Numbers count foreign keys between the two areas.

[Activity](viewpoint-activity.md) (2) · [Deals](viewpoint-deals.md) (2) · [Email](viewpoint-email.md) (1) · [Offers](viewpoint-offers.md) (1) · [People](viewpoint-people.md) (1) · [Property](viewpoint-property.md) (1) · [Relationships](viewpoint-relationships.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (20)

## Tables

- [Calendar agenda](next.calendar_agenda.md)
- [Calendar review dismissal](next.calendar_review_dismissal.md)
- [Home mark](next.home_mark.md)
- [Home update](next.home_update.md)
- [Weekly review](next.weekly_review.md)

See each table for its columns and links to other areas.
