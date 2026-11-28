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
  "Activity (area)" {
    string next_step
  }
  "Deals (area)" {
    string deal
  }
  "Email (area)" {
    string reply_draft
  }
  "Offers (area)" {
    string proposal
  }
  "People (area)" {
    string party
  }
  "Property (area)" {
    string property
  }
  "Relationships (area)" {
    string party_role
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Calendar agenda" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Calendar agenda" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Calendar agenda" |o--|| "Users and jobs (area)" : "user ID to App user"
  "Calendar agenda" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Calendar review dismissal" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Calendar review dismissal" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Calendar review dismissal" }o--|| "Users and jobs (area)" : "user ID to App user"
  "Calendar review dismissal" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Home mark" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Home mark" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Home mark" }o--|| "Users and jobs (area)" : "user ID to App user"
  "Home mark" }o--o| "Home update" : "home update ID, user ID"
  "Home mark" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Home mark" }o--o| "Activity (area)" : "call follow up ID to Next step"
  "Home mark" }o--o| "Activity (area)" : "next step ID to Next step"
  "Home mark" }o--o| "People (area)" : "waiting on party ID to Party"
  "Home mark" }o--o| "Offers (area)" : "proposal ID to Proposal"
  "Home mark" }o--o| "Email (area)" : "reply draft ID, user ID to Reply draft"
  "Home update" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Home update" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Home update" }o--|| "Users and jobs (area)" : "user ID to App user"
  "Home update" }o--|| "Deals (area)" : "deal ID to Deal"
  "Home update" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Home update" }o--o| "Property (area)" : "property ID to Property"
  "Weekly review" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Weekly review" }o--o| "Users and jobs (area)" : "changed by user ID, reviewer is partner to App user"
  "Weekly review" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Weekly review" }o--o| "Deals (area)" : "deal ID to Deal"
  "Weekly review" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Weekly review" }o--o| "Relationships (area)" : "party ID, lead role to Party role"
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
