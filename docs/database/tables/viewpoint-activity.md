# Activity

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Activity"
  "Activity about"
  "Deal attention alert"
  "Next step"
  "Deals (area)" {
    string deal
    string deal_phase_change
  }
  "Email (area)" {
    string email
  }
  "Home and calendar (area)" {
    string home_mark
  }
  "Leads (area)" {
    string lead_email_source
    string lead_stage_move
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
  "Tours (area)" {
    string tour_plan
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Activity" }o--o| "Users and jobs (area)" : "calendar review user ID to App user"
  "Activity" }o--o| "Users and jobs (area)" : "call owner user ID to App user"
  "Activity" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Activity" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Activity" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Activity" }o--o| "People (area)" : "from party ID to Party"
  "Activity about" }o--|| "Activity" : "activity ID"
  "Activity about" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Activity about" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Activity about" }o--o| "Deals (area)" : "deal ID to Deal"
  "Activity about" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Activity about" }o--o| "People (area)" : "party ID to Party"
  "Activity about" }o--o| "Property (area)" : "property ID to Property"
  "Deal attention alert" }o--|| "Users and jobs (area)" : "owner user ID to App user"
  "Deal attention alert" |o--|| "Deals (area)" : "deal ID to Deal"
  "Deals (area)" }o--o| "Activity" : "Deal phase change: call activity ID, call kind"
  "Deals (area)" }o--o| "Activity about" : "Deal phase change: call activity ID, deal ID"
  "Email (area)" }o--|| "Activity" : "Email: activity ID, activity kind"
  "Home and calendar (area)" }o--o| "Next step" : "Home mark: call follow up ID"
  "Home and calendar (area)" }o--o| "Next step" : "Home mark: next step ID"
  "Leads (area)" |o--|| "Activity about" : "Lead email source: activity ID, party ID"
  "Leads (area)" }o--o| "Activity" : "Lead stage move: activity ID"
  "Leads (area)" }o--o| "Activity about" : "Lead stage move: activity ID, party ID"
  "Next step" }o--o| "Activity" : "call activity ID, call kind"
  "Next step" }o--o| "Activity about" : "call activity ID, deal ID"
  "Next step" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Next step" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Next step" }o--o| "Deals (area)" : "deal ID to Deal"
  "Next step" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Next step" }o--o| "People (area)" : "call contact party ID to Party"
  "Next step" }o--o| "People (area)" : "owner party ID to Party"
  "Next step" }o--o| "People (area)" : "party ID to Party"
  "Next step" }o--o| "Property (area)" : "property ID to Property"
  "Offers (area)" }o--o| "Activity" : "Proposal: activity ID, activity kind"
  "Offers (area)" }o--o| "Activity about" : "Proposal: activity ID, call deal ID"
  "Offers (area)" }o--o| "Activity about" : "Proposal: activity ID, held deal ID"
  "Offers (area)" }o--o| "Activity about" : "Proposal: activity ID, party ID"
  "Offers (area)" }o--o| "Next step" : "Proposal: merged step ID"
  "Offers (area)" }o--o| "Next step" : "Proposal: next step ID, deal ID"
  "Tours (area)" }o--o| "Activity" : "Tour plan: completed activity ID, completed activity kind"
  "Tours (area)" }o--o| "Activity about" : "Tour plan: completed activity ID, deal ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Deals](viewpoint-deals.md) (5) · [Email](viewpoint-email.md) (1) · [Home and calendar](viewpoint-home-calendar.md) (2) · [Leads](viewpoint-leads.md) (3) · [Offers](viewpoint-offers.md) (6) · [People](viewpoint-people.md) (5) · [Property](viewpoint-property.md) (2) · [Tours](viewpoint-tours.md) (2) · [Users and jobs](viewpoint-users-jobs.md) (12)

## Tables

- [Activity](next.activity.md)
- [Activity about](next.activity_about.md)
- [Deal attention alert](next.deal_attention_alert.md)
- [Next step](next.next_step.md)

See each table for its columns and links to other areas.
