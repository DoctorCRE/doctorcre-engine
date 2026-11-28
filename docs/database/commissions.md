# commissions

## next.commission

```mermaid
erDiagram
"next.commission" }o--o| "next.app_user" : ""
"next.commission" }o--o| "next.app_user" : ""
"next.commission" |o--|| "next.deal" : ""
"next.commission" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.commission_payment

```mermaid
erDiagram
"next.commission_payment" }o--o| "next.app_user" : ""
"next.commission_payment" }o--o| "next.app_user" : ""
"next.commission_payment" }o--|| "next.commission" : ""
"next.commission_payment" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES commission(deal_id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.commission_share

```mermaid
erDiagram
"next.commission_share" }o--o| "next.app_user" : ""
"next.commission_share" }o--o| "next.app_user" : ""
"next.commission_share" }o--|| "next.commission" : ""
"next.commission_share" }o--o| "next.job" : ""
"next.commission_share" }o--|| "next.party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES commission(deal_id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`

## next.commission_tier

```mermaid
erDiagram
"next.commission_tier" }o--o| "next.app_user" : ""
"next.commission_tier" }o--o| "next.app_user" : ""
"next.commission_tier" }o--|| "next.app_user" : ""
"next.commission_tier" }o--|| "next.app_user" : ""
"next.commission_tier" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (partner_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
