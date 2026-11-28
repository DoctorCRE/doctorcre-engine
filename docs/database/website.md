# website

## next.deal_client_website

```mermaid
erDiagram
"next.deal_client_website" }o--o| "next.app_user" : ""
"next.deal_client_website" }o--o| "next.app_user" : ""
"next.deal_client_website" }o--|| "next.deal" : ""
"next.deal_client_website" }o--o| "next.job" : ""
"next.deal_client_website" }o--|| "next.party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (client_party_id) REFERENCES party(id)`

## next.deal_client_website_attempt

```mermaid
erDiagram
"next.deal_client_website_attempt" |o--|| "next.deal_client_website" : ""
```

- `FOREIGN KEY (slug) REFERENCES deal_client_website(slug)`

## next.deal_client_website_grant

```mermaid
erDiagram
"next.deal_client_website_grant" }o--|| "next.app_user" : ""
"next.deal_client_website_grant" }o--|| "next.deal_client_website" : ""
```

- `FOREIGN KEY (user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (slug) REFERENCES deal_client_website(slug)`
