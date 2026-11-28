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
  "Doc judgment job (Doc)" }o--|| "Email mailbox" : "activity ID, owner user ID"
  "Email" }o--|| "Activity (Activity)" : "activity ID, activity kind"
  "Email" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Email" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Email" }o--o| "Job (Users and jobs)" : "changed by job"
  "Email document" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Email document" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Email document" }o--|| "Document (Documents)" : "document ID"
  "Email document" }o--|| "Email" : "email activity ID"
  "Email document" }o--o| "Job (Users and jobs)" : "changed by job"
  "Email mailbox" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Email mailbox" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Email mailbox" }o--|| "App user (Users and jobs)" : "user ID"
  "Email mailbox" }o--|| "Email" : "activity ID"
  "Email mailbox" }o--o| "Job (Users and jobs)" : "changed by job"
  "Email recipient" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Email recipient" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Email recipient" }o--|| "Email" : "activity ID"
  "Email recipient" }o--o| "Job (Users and jobs)" : "changed by job"
  "Email summary" }o--|| "Email" : "activity ID"
  "Home mark (Home and calendar)" }o--o| "Reply draft" : "reply draft ID, user ID"
  "Lead email source (Leads)" }o--|| "Email mailbox" : "activity ID, mailbox user ID"
  "Outside ID (People)" }o--o| "Email" : "email activity ID"
  "Reply draft" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Reply draft" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Reply draft" }o--|| "App user (Users and jobs)" : "owner user ID"
  "Reply draft" }o--o| "Doc turn (Doc)" : "confirmed doc turn ID, owner user ID"
  "Reply draft" }o--|| "Email" : "email activity ID"
  "Reply draft" }o--o| "Job (Users and jobs)" : "changed by job"
  "Reply draft" }o--o| "Job (Users and jobs)" : "proposed by job"
  "Reply draft document" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Reply draft document" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Reply draft document" }o--|| "Document (Documents)" : "document ID"
  "Reply draft document" }o--o| "Job (Users and jobs)" : "changed by job"
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
