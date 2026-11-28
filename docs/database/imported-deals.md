# imported-deals

## next.imported_automatic_phase_move

```mermaid
erDiagram
"next.imported_automatic_phase_move" |o--|| "next.deal_phase_change" : ""
"next.imported_automatic_phase_move" }o--|| "next.phase" : ""
```

- `FOREIGN KEY (deal_id, happened_at) REFERENCES deal_phase_change(deal_id, happened_at)`
- `FOREIGN KEY (prior_phase) REFERENCES phase(slug)`

## next.imported_deal_board

```mermaid
erDiagram
"next.imported_deal_board" }o--o| "next.app_user" : ""
"next.imported_deal_board" }o--o| "next.app_user" : ""
"next.imported_deal_board" |o--|| "next.deal" : ""
"next.imported_deal_board" }o--o| "next.deal_phase_change" : ""
"next.imported_deal_board" }o--o| "next.job" : ""
"next.imported_deal_board" }o--o| "next.phase" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (deal_id, phase_at) REFERENCES deal_phase_change(deal_id, happened_at)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (phase) REFERENCES phase(slug)`

## next.imported_deal_history

```mermaid
erDiagram
"next.imported_deal_history" }o--o| "next.app_user" : ""
"next.imported_deal_history" }o--|| "next.deal" : ""
"next.imported_deal_history" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.imported_deal_invoiced

```mermaid
erDiagram
"next.imported_deal_invoiced" }o--o| "next.app_user" : ""
"next.imported_deal_invoiced" }o--o| "next.app_user" : ""
"next.imported_deal_invoiced" |o--|| "next.deal" : ""
"next.imported_deal_invoiced" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.imported_deal_owner

```mermaid
erDiagram
"next.imported_deal_owner" }o--o| "next.app_user" : ""
"next.imported_deal_owner" }o--o| "next.app_user" : ""
"next.imported_deal_owner" }o--|| "next.app_user" : ""
"next.imported_deal_owner" }o--|| "next.deal" : ""
"next.imported_deal_owner" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.imported_deal_party

```mermaid
erDiagram
"next.imported_deal_party" }o--o| "next.app_user" : ""
"next.imported_deal_party" }o--o| "next.app_user" : ""
"next.imported_deal_party" }o--|| "next.deal" : ""
"next.imported_deal_party" }o--o| "next.job" : ""
"next.imported_deal_party" }o--|| "next.party" : ""
"next.imported_deal_party" }o--|| "next.role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
- `FOREIGN KEY (role) REFERENCES role(slug)`
