# Leads

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Candidate"
  "Lead contact draft"
  "Lead email attention"
  "Lead email evidence"
  "Lead email source"
  "Lead lane"
  "Lead source sender"
  "Lead stage move"
  "Candidate" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Candidate" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Candidate" }o--o| "Job (Users and jobs)" : "changed by job"
  "Candidate" }o--o| "Party (People)" : "promoted party ID"
  "Candidate" }o--o| "Party role (Relationships)" : "promoted party ID, lead role"
  "Lead contact draft" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Lead contact draft" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Lead contact draft" }o--o| "App user (Users and jobs)" : "owner user ID"
  "Lead contact draft" }o--o| "Job (Users and jobs)" : "changed by job"
  "Lead contact draft" |o--|| "Party (People)" : "party ID"
  "Lead contact draft" }o--|| "Party role (Relationships)" : "party ID, role"
  "Lead email attention" }o--o| "App user (Users and jobs)" : "acknowledged by user ID, acknowledger is partner"
  "Lead email attention" }o--|| "Lead email source" : "activity ID, party ID"
  "Lead email attention" |o--|| "Party (People)" : "party ID"
  "Lead email evidence" }o--|| "App user (Users and jobs)" : "mailbox user ID"
  "Lead email source" |o--|| "Activity about (Activity)" : "activity ID, party ID"
  "Lead email source" }o--|| "Email mailbox (Email)" : "activity ID, mailbox user ID"
  "Lead email source" }o--|| "Party (People)" : "party ID"
  "Lead email source" }o--o| "Party role (Relationships)" : "party ID, lead role"
  "Lead lane" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Lead lane" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Lead lane" }o--o| "Job (Users and jobs)" : "changed by job"
  "Lead stage move" }o--o| "Activity (Activity)" : "activity ID"
  "Lead stage move" }o--o| "Activity about (Activity)" : "activity ID, party ID"
  "Lead stage move" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Lead stage move" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Lead stage move" }o--o| "Job (Users and jobs)" : "changed by job"
  "Lead stage move" }o--|| "Party (People)" : "party ID"
  "Lead stage move" }o--|| "Party role (Relationships)" : "party ID, role"
  "Lead stage move" }o--|| "Stage (Deals)" : "role, from stage"
  "Lead stage move" }o--|| "Stage (Deals)" : "role, to stage"
  "Party role (Relationships)" }o--o| "Lead lane" : "lane"
  "Proposal (Offers)" |o--o| "Candidate" : "candidate ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Activity](viewpoint-activity.md) (3) · [Deals](viewpoint-deals.md) (2) · [Email](viewpoint-email.md) (1) · [Offers](viewpoint-offers.md) (1) · [People](viewpoint-people.md) (5) · [Relationships](viewpoint-relationships.md) (5) · [Users and jobs](viewpoint-users-jobs.md) (15)

## Tables

- [Candidate](next.candidate.md)
- [Lead contact draft](next.lead_contact_draft.md)
- [Lead email attention](next.lead_email_attention.md)
- [Lead email evidence](next.lead_email_evidence.md)
- [Lead email source](next.lead_email_source.md)
- [Lead lane](next.lead_lane.md)
- [Lead source sender](next.lead_source_sender.md)
- [Lead stage move](next.lead_stage_move.md)

See each table for its columns and links to other areas.

Lead source sender is standalone intake configuration.
