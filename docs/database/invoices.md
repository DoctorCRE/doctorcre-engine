# invoices

## next.invoice_email

```mermaid
erDiagram
"next.invoice_email" }o--o| "next.app_user" : ""
"next.invoice_email" }o--o| "next.app_user" : ""
"next.invoice_email" }o--o| "next.change" : ""
"next.invoice_email" }o--o| "next.commission_payment" : ""
"next.invoice_email" }o--o| "next.deal" : ""
"next.invoice_email" }o--o| "next.deal_phase_change" : ""
"next.invoice_email" }o--o| "next.deal_phase_change" : ""
"next.invoice_email" }o--o| "next.invoice_email" : ""
"next.invoice_email" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (payment_change_id) REFERENCES change(id)`
- `FOREIGN KEY (payment_id, deal_id) REFERENCES commission_payment(id, deal_id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (deal_id, applied_phase_at) REFERENCES deal_phase_change(deal_id, happened_at)`
- `FOREIGN KEY (deal_id, prior_phase_at) REFERENCES deal_phase_change(deal_id, happened_at)`
- `FOREIGN KEY (application_id, deal_id, payment_id, email_date) REFERENCES invoice_email(application_root_id, deal_id, payment_id, email_date)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.invoice_mailbox

```mermaid
erDiagram
"next.invoice_mailbox" }o--o| "next.app_user" : ""
"next.invoice_mailbox" }o--o| "next.app_user" : ""
"next.invoice_mailbox" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
