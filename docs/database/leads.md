# leads

## next.candidate

```mermaid
erDiagram
"next.candidate" }o--o| "next.app_user" : ""
"next.candidate" }o--o| "next.app_user" : ""
"next.candidate" }o--o| "next.job" : ""
"next.candidate" }o--o| "next.party" : ""
"next.candidate" }o--o| "next.party_role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (promoted_party_id) REFERENCES party(id)`
- `FOREIGN KEY (promoted_party_id, lead_role) REFERENCES party_role(party_id, role) DEFERRABLE INITIALLY DEFERRED`

## next.lead_contact_draft

```mermaid
erDiagram
"next.lead_contact_draft" }o--o| "next.app_user" : ""
"next.lead_contact_draft" }o--o| "next.app_user" : ""
"next.lead_contact_draft" }o--o| "next.app_user" : ""
"next.lead_contact_draft" }o--o| "next.job" : ""
"next.lead_contact_draft" |o--|| "next.party" : ""
"next.lead_contact_draft" }o--|| "next.party_role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (owner_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
- `FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) DEFERRABLE INITIALLY DEFERRED`

## next.lead_email_attention

```mermaid
erDiagram
"next.lead_email_attention" }o--o| "next.app_user" : ""
"next.lead_email_attention" }o--|| "next.lead_email_source" : ""
"next.lead_email_attention" |o--|| "next.party" : ""
```

- `FOREIGN KEY (acknowledged_by_user_id, acknowledger_is_partner) REFERENCES app_user(id, is_account_partner)`
- `FOREIGN KEY (activity_id, party_id) REFERENCES lead_email_source(activity_id, party_id) DEFERRABLE INITIALLY DEFERRED`
- `FOREIGN KEY (party_id) REFERENCES party(id)`

## next.lead_email_evidence

```mermaid
erDiagram
"next.lead_email_evidence" }o--|| "next.app_user" : ""
```

- `FOREIGN KEY (mailbox_user_id) REFERENCES app_user(id)`

## next.lead_email_source

```mermaid
erDiagram
"next.lead_email_source" |o--|| "next.activity_about" : ""
"next.lead_email_source" }o--|| "next.email_mailbox" : ""
"next.lead_email_source" }o--|| "next.party" : ""
"next.lead_email_source" }o--o| "next.party_role" : ""
```

- `FOREIGN KEY (activity_id, party_id) REFERENCES activity_about(activity_id, party_id) DEFERRABLE INITIALLY DEFERRED`
- `FOREIGN KEY (activity_id, mailbox_user_id) REFERENCES email_mailbox(activity_id, user_id)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
- `FOREIGN KEY (party_id, lead_role) REFERENCES party_role(party_id, role) DEFERRABLE INITIALLY DEFERRED`

## next.lead_lane

```mermaid
erDiagram
"next.lead_lane" }o--o| "next.app_user" : ""
"next.lead_lane" }o--o| "next.app_user" : ""
"next.lead_lane" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.lead_source_sender

```mermaid
erDiagram
"next.lead_source_sender"
```

## next.lead_stage_move

```mermaid
erDiagram
"next.lead_stage_move" }o--o| "next.activity" : ""
"next.lead_stage_move" }o--o| "next.activity_about" : ""
"next.lead_stage_move" }o--o| "next.app_user" : ""
"next.lead_stage_move" }o--o| "next.app_user" : ""
"next.lead_stage_move" }o--o| "next.job" : ""
"next.lead_stage_move" }o--|| "next.party" : ""
"next.lead_stage_move" }o--|| "next.party_role" : ""
"next.lead_stage_move" }o--|| "next.stage" : ""
"next.lead_stage_move" }o--|| "next.stage" : ""
```

- `FOREIGN KEY (activity_id) REFERENCES activity(id)`
- `FOREIGN KEY (activity_id, party_id) REFERENCES activity_about(activity_id, party_id) DEFERRABLE INITIALLY DEFERRED`
- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
- `FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) DEFERRABLE INITIALLY DEFERRED`
- `FOREIGN KEY (role, from_stage) REFERENCES stage(role, slug)`
- `FOREIGN KEY (role, to_stage) REFERENCES stage(role, slug)`
