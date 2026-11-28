# activity

## next.activity

```mermaid
erDiagram
"next.activity" }o--o| "next.app_user" : ""
"next.activity" }o--o| "next.app_user" : ""
"next.activity" }o--o| "next.app_user" : ""
"next.activity" }o--o| "next.app_user" : ""
"next.activity" }o--o| "next.job" : ""
"next.activity" }o--o| "next.party" : ""
```

- `FOREIGN KEY (calendar_review_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (call_owner_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (from_party_id) REFERENCES party(id)`

## next.activity_about

```mermaid
erDiagram
"next.activity_about" }o--|| "next.activity" : ""
"next.activity_about" }o--o| "next.app_user" : ""
"next.activity_about" }o--o| "next.app_user" : ""
"next.activity_about" }o--o| "next.deal" : ""
"next.activity_about" }o--o| "next.job" : ""
"next.activity_about" }o--o| "next.party" : ""
"next.activity_about" }o--o| "next.property" : ""
```

- `FOREIGN KEY (activity_id) REFERENCES activity(id)`
- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
- `FOREIGN KEY (property_id) REFERENCES property(id)`

## next.deal_attention_alert

```mermaid
erDiagram
"next.deal_attention_alert" }o--|| "next.app_user" : ""
"next.deal_attention_alert" |o--|| "next.deal" : ""
```

- `FOREIGN KEY (owner_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id) ON DELETE CASCADE`

## next.next_step

```mermaid
erDiagram
"next.next_step" }o--o| "next.activity" : ""
"next.next_step" }o--o| "next.activity_about" : ""
"next.next_step" }o--o| "next.app_user" : ""
"next.next_step" }o--o| "next.app_user" : ""
"next.next_step" }o--o| "next.deal" : ""
"next.next_step" }o--o| "next.job" : ""
"next.next_step" }o--o| "next.party" : ""
"next.next_step" }o--o| "next.party" : ""
"next.next_step" }o--o| "next.party" : ""
"next.next_step" }o--o| "next.property" : ""
```

- `FOREIGN KEY (call_activity_id, call_kind) REFERENCES activity(id, kind)`
- `FOREIGN KEY (call_activity_id, deal_id) REFERENCES activity_about(activity_id, deal_id)`
- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (call_contact_party_id) REFERENCES party(id)`
- `FOREIGN KEY (owner_party_id) REFERENCES party(id)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
- `FOREIGN KEY (property_id) REFERENCES property(id)`
