# deals

## next.deal

```mermaid
erDiagram
"next.deal" }o--o| "next.app_user" : ""
"next.deal" }o--o| "next.app_user" : ""
"next.deal" }o--|| "next.app_user" : ""
"next.deal" }o--o| "next.app_user" : ""
"next.deal" }o--o| "next.deal_kind" : ""
"next.deal" }o--o| "next.deal_reason" : ""
"next.deal" }o--o| "next.job" : ""
"next.deal" }o--o| "next.lease" : ""
"next.deal" }o--o| "next.market" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (owner_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (parked_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (kind) REFERENCES deal_kind(slug)`
- `FOREIGN KEY (reason) REFERENCES deal_reason(slug)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (renews_lease_id) REFERENCES lease(id)`
- `FOREIGN KEY (market_id) REFERENCES market(id)`

## next.deal_kind

```mermaid
erDiagram
"next.deal_kind" }o--o| "next.app_user" : ""
"next.deal_kind" }o--o| "next.app_user" : ""
"next.deal_kind" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.deal_open_name

```mermaid
erDiagram
"next.deal_open_name" |o--|| "next.deal" : ""
```

- `FOREIGN KEY (deal_id) REFERENCES deal(id) ON DELETE CASCADE`

## next.deal_party

```mermaid
erDiagram
"next.deal_party" }o--o| "next.app_user" : ""
"next.deal_party" }o--o| "next.app_user" : ""
"next.deal_party" }o--|| "next.deal" : ""
"next.deal_party" }o--o| "next.job" : ""
"next.deal_party" }o--|| "next.party" : ""
"next.deal_party" }o--o| "next.party_role" : ""
"next.deal_party" }o--|| "next.role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
- `FOREIGN KEY (party_id, client_role) REFERENCES party_role(party_id, role) DEFERRABLE INITIALLY DEFERRED`
- `FOREIGN KEY (role) REFERENCES role(slug)`

## next.deal_phase_change

```mermaid
erDiagram
"next.deal_phase_change" }o--o| "next.activity" : ""
"next.deal_phase_change" }o--o| "next.activity_about" : ""
"next.deal_phase_change" }o--o| "next.app_user" : ""
"next.deal_phase_change" }o--o| "next.app_user" : ""
"next.deal_phase_change" }o--|| "next.deal" : ""
"next.deal_phase_change" }o--o| "next.job" : ""
"next.deal_phase_change" }o--|| "next.phase" : ""
```

- `FOREIGN KEY (call_activity_id, call_kind) REFERENCES activity(id, kind)`
- `FOREIGN KEY (call_activity_id, deal_id) REFERENCES activity_about(activity_id, deal_id)`
- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (phase) REFERENCES phase(slug)`

## next.deal_reason

```mermaid
erDiagram
"next.deal_reason" }o--o| "next.app_user" : ""
"next.deal_reason" }o--o| "next.app_user" : ""
"next.deal_reason" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.deal_star

```mermaid
erDiagram
"next.deal_star" }o--o| "next.app_user" : ""
"next.deal_star" }o--o| "next.app_user" : ""
"next.deal_star" }o--|| "next.app_user" : ""
"next.deal_star" }o--|| "next.deal" : ""
"next.deal_star" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id) ON DELETE CASCADE`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.phase

```mermaid
erDiagram
"next.phase" }o--o| "next.app_user" : ""
"next.phase" }o--o| "next.app_user" : ""
"next.phase" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.stage

```mermaid
erDiagram
"next.stage" }o--o| "next.app_user" : ""
"next.stage" }o--o| "next.app_user" : ""
"next.stage" }o--o| "next.job" : ""
"next.stage" }o--|| "next.role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (role) REFERENCES role(slug)`

## next.typical_length

```mermaid
erDiagram
"next.typical_length" }o--o| "next.app_user" : ""
"next.typical_length" }o--o| "next.app_user" : ""
"next.typical_length" }o--|| "next.deal_kind" : ""
"next.typical_length" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_kind) REFERENCES deal_kind(slug)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
