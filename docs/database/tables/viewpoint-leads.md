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
  "Activity (area)" {
    string activity
    string activity_about
  }
  "Deals (area)" {
    string stage
  }
  "Email (area)" {
    string email_mailbox
  }
  "Offers (area)" {
    string proposal
  }
  "People (area)" {
    string party
  }
  "Relationships (area)" {
    string party_role
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Candidate" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Candidate" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Candidate" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Candidate" }o--o| "People (area)" : "promoted party ID to Party"
  "Candidate" }o--o| "Relationships (area)" : "promoted party ID, lead role to Party role"
  "Lead contact draft" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Lead contact draft" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Lead contact draft" }o--o| "Users and jobs (area)" : "owner user ID to App user"
  "Lead contact draft" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Lead contact draft" |o--|| "People (area)" : "party ID to Party"
  "Lead contact draft" }o--|| "Relationships (area)" : "party ID, role to Party role"
  "Lead email attention" }o--o| "Users and jobs (area)" : "acknowledged by user ID, acknowledger is partner to App user"
  "Lead email attention" }o--|| "Lead email source" : "activity ID, party ID"
  "Lead email attention" |o--|| "People (area)" : "party ID to Party"
  "Lead email evidence" }o--|| "Users and jobs (area)" : "mailbox user ID to App user"
  "Lead email source" |o--|| "Activity (area)" : "activity ID, party ID to Activity about"
  "Lead email source" }o--|| "Email (area)" : "activity ID, mailbox user ID to Email mailbox"
  "Lead email source" }o--|| "People (area)" : "party ID to Party"
  "Lead email source" }o--o| "Relationships (area)" : "party ID, lead role to Party role"
  "Lead lane" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Lead lane" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Lead lane" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Lead stage move" }o--o| "Activity (area)" : "activity ID to Activity"
  "Lead stage move" }o--o| "Activity (area)" : "activity ID, party ID to Activity about"
  "Lead stage move" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Lead stage move" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Lead stage move" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Lead stage move" }o--|| "People (area)" : "party ID to Party"
  "Lead stage move" }o--|| "Relationships (area)" : "party ID, role to Party role"
  "Lead stage move" }o--|| "Deals (area)" : "role, from stage to Stage"
  "Lead stage move" }o--|| "Deals (area)" : "role, to stage to Stage"
  "Relationships (area)" }o--o| "Lead lane" : "Party role: lane"
  "Offers (area)" |o--o| "Candidate" : "Proposal: candidate ID"
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
