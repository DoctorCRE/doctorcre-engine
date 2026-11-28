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
  "Email document" }o--|| "Email" : "email activity ID"
  "Email mailbox" }o--|| "Email" : "activity ID"
  "Email recipient" }o--|| "Email" : "activity ID"
  "Email summary" }o--|| "Email" : "activity ID"
  "Reply draft" }o--|| "Email" : "email activity ID"
  "Reply draft document" }o--|| "Reply draft" : "reply draft ID"
```

## Tables

- [Email](next.email.md)
- [Email document](next.email_document.md)
- [Email mailbox](next.email_mailbox.md)
- [Email recipient](next.email_recipient.md)
- [Email summary](next.email_summary.md)
- [Reply draft](next.reply_draft.md)
- [Reply draft document](next.reply_draft_document.md)

See each table for its columns and links to other areas.
