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
  "Activity" }o--o| "App user (Users and jobs)" : "calendar review user ID"
  "Activity" }o--o| "App user (Users and jobs)" : "call owner user ID"
  "Activity" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Activity" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Activity" }o--o| "Job (Users and jobs)" : "changed by job"
  "Activity" }o--o| "Party (People)" : "from party ID"
  "Activity about" }o--|| "Activity" : "activity ID"
  "Activity about" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Activity about" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Activity about" }o--o| "Deal (Deals)" : "deal ID"
  "Activity about" }o--o| "Job (Users and jobs)" : "changed by job"
  "Activity about" }o--o| "Party (People)" : "party ID"
  "Activity about" }o--o| "Property (Property)" : "property ID"
  "Deal attention alert" }o--|| "App user (Users and jobs)" : "owner user ID"
  "Deal attention alert" |o--|| "Deal (Deals)" : "deal ID"
  "Deal phase change (Deals)" }o--o| "Activity" : "call activity ID, call kind"
  "Deal phase change (Deals)" }o--o| "Activity about" : "call activity ID, deal ID"
  "Email (Email)" }o--|| "Activity" : "activity ID, activity kind"
  "Home mark (Home and calendar)" }o--o| "Next step" : "call follow up ID"
  "Home mark (Home and calendar)" }o--o| "Next step" : "next step ID"
  "Lead email source (Leads)" |o--|| "Activity about" : "activity ID, party ID"
  "Lead stage move (Leads)" }o--o| "Activity" : "activity ID"
  "Lead stage move (Leads)" }o--o| "Activity about" : "activity ID, party ID"
  "Next step" }o--o| "Activity" : "call activity ID, call kind"
  "Next step" }o--o| "Activity about" : "call activity ID, deal ID"
  "Next step" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Next step" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Next step" }o--o| "Deal (Deals)" : "deal ID"
  "Next step" }o--o| "Job (Users and jobs)" : "changed by job"
  "Next step" }o--o| "Party (People)" : "call contact party ID"
  "Next step" }o--o| "Party (People)" : "owner party ID"
  "Next step" }o--o| "Party (People)" : "party ID"
  "Next step" }o--o| "Property (Property)" : "property ID"
  "Proposal (Offers)" }o--o| "Activity" : "activity ID, activity kind"
  "Proposal (Offers)" }o--o| "Activity about" : "activity ID, call deal ID"
  "Proposal (Offers)" }o--o| "Activity about" : "activity ID, held deal ID"
  "Proposal (Offers)" }o--o| "Activity about" : "activity ID, party ID"
  "Proposal (Offers)" }o--o| "Next step" : "merged step ID"
  "Proposal (Offers)" }o--o| "Next step" : "next step ID, deal ID"
  "Tour plan (Tours)" }o--o| "Activity" : "completed activity ID, completed activity kind"
  "Tour plan (Tours)" }o--o| "Activity about" : "completed activity ID, deal ID"
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
