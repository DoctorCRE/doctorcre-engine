# Email

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Email"
  "Email document"
  "Email mailbox"
  "Email recipient"
  "Email summary"
  "Reply draft"
  "Reply draft document"
  "Activity (area)" {
    string activity
  }
  "Doc (area)" {
    string doc_judgment_job
    string doc_turn
  }
  "Documents (area)" {
    string document
  }
  "Home and calendar (area)" {
    string home_mark
  }
  "Leads (area)" {
    string lead_email_source
  }
  "People (area)" {
    string outside_id
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Doc (area)" }o--|| "Email mailbox" : "Doc judgment job: activity ID, owner user ID"
  "Email" }o--|| "Activity (area)" : "activity ID, activity kind to Activity"
  "Email" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Email" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Email" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Email document" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Email document" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Email document" }o--|| "Documents (area)" : "document ID to Document"
  "Email document" }o--|| "Email" : "email activity ID"
  "Email document" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Email mailbox" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Email mailbox" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Email mailbox" }o--|| "Users and jobs (area)" : "user ID to App user"
  "Email mailbox" }o--|| "Email" : "activity ID"
  "Email mailbox" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Email recipient" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Email recipient" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Email recipient" }o--|| "Email" : "activity ID"
  "Email recipient" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Email summary" }o--|| "Email" : "activity ID"
  "Home and calendar (area)" }o--o| "Reply draft" : "Home mark: reply draft ID, user ID"
  "Leads (area)" }o--|| "Email mailbox" : "Lead email source: activity ID, mailbox user ID"
  "People (area)" }o--o| "Email" : "Outside ID: email activity ID"
  "Reply draft" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Reply draft" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Reply draft" }o--|| "Users and jobs (area)" : "owner user ID to App user"
  "Reply draft" }o--o| "Doc (area)" : "confirmed doc turn ID, owner user ID to Doc turn"
  "Reply draft" }o--|| "Email" : "email activity ID"
  "Reply draft" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Reply draft" }o--o| "Users and jobs (area)" : "proposed by job to Job"
  "Reply draft document" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Reply draft document" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Reply draft document" }o--|| "Documents (area)" : "document ID to Document"
  "Reply draft document" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Reply draft document" }o--|| "Reply draft" : "reply draft ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Activity](viewpoint-activity.md) (1) · [Doc](viewpoint-doc.md) (2) · [Documents](viewpoint-documents.md) (2) · [Home and calendar](viewpoint-home-calendar.md) (1) · [Leads](viewpoint-leads.md) (1) · [People](viewpoint-people.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (21)

## Tables

- [Email](next.email.md)
- [Email document](next.email_document.md)
- [Email mailbox](next.email_mailbox.md)
- [Email recipient](next.email_recipient.md)
- [Email summary](next.email_summary.md)
- [Reply draft](next.reply_draft.md)
- [Reply draft document](next.reply_draft_document.md)

See each table for its columns and links to other areas.
