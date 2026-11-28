# home-calendar

## next.calendar_agenda

```mermaid
erDiagram
"next.calendar_agenda" }o--o| "next.app_user" : ""
"next.calendar_agenda" }o--o| "next.app_user" : ""
"next.calendar_agenda" |o--|| "next.app_user" : ""
"next.calendar_agenda" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.calendar_review_dismissal

```mermaid
erDiagram
"next.calendar_review_dismissal" }o--o| "next.app_user" : ""
"next.calendar_review_dismissal" }o--o| "next.app_user" : ""
"next.calendar_review_dismissal" }o--|| "next.app_user" : ""
"next.calendar_review_dismissal" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.home_mark

```mermaid
erDiagram
"next.home_mark" }o--o| "next.app_user" : ""
"next.home_mark" }o--o| "next.app_user" : ""
"next.home_mark" }o--|| "next.app_user" : ""
"next.home_mark" }o--o| "next.home_update" : ""
"next.home_mark" }o--o| "next.job" : ""
"next.home_mark" }o--o| "next.next_step" : ""
"next.home_mark" }o--o| "next.next_step" : ""
"next.home_mark" }o--o| "next.party" : ""
"next.home_mark" }o--o| "next.proposal" : ""
"next.home_mark" }o--o| "next.reply_draft" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (home_update_id, user_id) REFERENCES home_update(id, user_id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (call_follow_up_id) REFERENCES next_step(home_call_follow_up_id)`
- `FOREIGN KEY (next_step_id) REFERENCES next_step(home_step_id)`
- `FOREIGN KEY (waiting_on_party_id) REFERENCES party(id)`
- `FOREIGN KEY (proposal_id) REFERENCES proposal(id) ON DELETE CASCADE`
- `FOREIGN KEY (reply_draft_id, user_id) REFERENCES reply_draft(id, owner_user_id)`

## next.home_update

```mermaid
erDiagram
"next.home_update" }o--o| "next.app_user" : ""
"next.home_update" }o--o| "next.app_user" : ""
"next.home_update" }o--|| "next.app_user" : ""
"next.home_update" }o--|| "next.deal" : ""
"next.home_update" }o--o| "next.job" : ""
"next.home_update" }o--o| "next.property" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (property_id) REFERENCES property(id)`

## next.weekly_review

```mermaid
erDiagram
"next.weekly_review" }o--o| "next.app_user" : ""
"next.weekly_review" }o--o| "next.app_user" : ""
"next.weekly_review" }o--o| "next.app_user" : ""
"next.weekly_review" }o--o| "next.deal" : ""
"next.weekly_review" }o--o| "next.job" : ""
"next.weekly_review" }o--o| "next.party_role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_user_id, reviewer_is_partner) REFERENCES app_user(id, is_account_partner)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id, lead_role) REFERENCES party_role(party_id, role)`
