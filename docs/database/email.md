# email

## next.email

```mermaid
erDiagram
"next.email" }o--|| "next.activity" : ""
"next.email" }o--o| "next.app_user" : ""
"next.email" }o--o| "next.app_user" : ""
"next.email" }o--o| "next.job" : ""
```

- `FOREIGN KEY (activity_id, activity_kind) REFERENCES activity(id, kind)`
- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.email_document

```mermaid
erDiagram
"next.email_document" }o--o| "next.app_user" : ""
"next.email_document" }o--o| "next.app_user" : ""
"next.email_document" }o--|| "next.document" : ""
"next.email_document" }o--|| "next.email" : ""
"next.email_document" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (document_id) REFERENCES document(id)`
- `FOREIGN KEY (email_activity_id) REFERENCES email(activity_id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.email_mailbox

```mermaid
erDiagram
"next.email_mailbox" }o--o| "next.app_user" : ""
"next.email_mailbox" }o--o| "next.app_user" : ""
"next.email_mailbox" }o--|| "next.app_user" : ""
"next.email_mailbox" }o--|| "next.email" : ""
"next.email_mailbox" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (activity_id) REFERENCES email(activity_id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.email_recipient

```mermaid
erDiagram
"next.email_recipient" }o--o| "next.app_user" : ""
"next.email_recipient" }o--o| "next.app_user" : ""
"next.email_recipient" }o--|| "next.email" : ""
"next.email_recipient" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (activity_id) REFERENCES email(activity_id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.email_summary

```mermaid
erDiagram
"next.email_summary" }o--|| "next.email" : ""
```

- `FOREIGN KEY (activity_id) REFERENCES email(activity_id)`

## next.reply_draft

```mermaid
erDiagram
"next.reply_draft" }o--o| "next.app_user" : ""
"next.reply_draft" }o--o| "next.app_user" : ""
"next.reply_draft" }o--|| "next.app_user" : ""
"next.reply_draft" }o--o| "next.doc_turn" : ""
"next.reply_draft" }o--|| "next.email" : ""
"next.reply_draft" }o--o| "next.job" : ""
"next.reply_draft" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (owner_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (confirmed_doc_turn_id, owner_user_id) REFERENCES doc_turn(id, owner_user_id)`
- `FOREIGN KEY (email_activity_id) REFERENCES email(activity_id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (proposed_by_job) REFERENCES job(slug)`

## next.reply_draft_document

```mermaid
erDiagram
"next.reply_draft_document" }o--o| "next.app_user" : ""
"next.reply_draft_document" }o--o| "next.app_user" : ""
"next.reply_draft_document" }o--|| "next.document" : ""
"next.reply_draft_document" }o--o| "next.job" : ""
"next.reply_draft_document" }o--|| "next.reply_draft" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (document_id) REFERENCES document(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (reply_draft_id) REFERENCES reply_draft(id)`
