# clients

## next.client

```mermaid
erDiagram
"next.client" }o--o| "next.app_user" : ""
"next.client" }o--o| "next.app_user" : ""
"next.client" }o--o| "next.app_user" : ""
"next.client" }o--o| "next.client_type" : ""
"next.client" }o--o| "next.job" : ""
"next.client" }o--|| "next.party_role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (owner_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (client_type) REFERENCES client_type(slug)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE`

## next.client_brand

```mermaid
erDiagram
"next.client_brand" }o--o| "next.app_user" : ""
"next.client_brand" }o--o| "next.app_user" : ""
"next.client_brand" }o--|| "next.client" : ""
"next.client_brand" }o--o| "next.job" : ""
"next.client_brand" }o--o| "next.party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (location_id) REFERENCES client(party_id) ON UPDATE CASCADE`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (brand_id, brand_kind) REFERENCES party(id, kind)`

## next.client_research

```mermaid
erDiagram
"next.client_research" }o--o| "next.app_user" : ""
"next.client_research" }o--o| "next.app_user" : ""
"next.client_research" }o--o| "next.job" : ""
"next.client_research" }o--|| "next.party_role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE`

## next.client_research_fact

```mermaid
erDiagram
"next.client_research_fact" }o--o| "next.app_user" : ""
"next.client_research_fact" }o--o| "next.app_user" : ""
"next.client_research_fact" }o--|| "next.client_research" : ""
"next.client_research_fact" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (research_id) REFERENCES client_research(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.client_type

```mermaid
erDiagram
"next.client_type" }o--o| "next.app_user" : ""
"next.client_type" }o--o| "next.app_user" : ""
"next.client_type" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.client_vertical

```mermaid
erDiagram
"next.client_vertical" }o--o| "next.app_user" : ""
"next.client_vertical" }o--o| "next.app_user" : ""
"next.client_vertical" }o--o| "next.job" : ""
"next.client_vertical" }o--|| "next.party_role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE`

## next.national_account

```mermaid
erDiagram
"next.national_account" }o--o| "next.app_user" : ""
"next.national_account" }o--o| "next.app_user" : ""
"next.national_account" }o--o| "next.job" : ""
"next.national_account" }o--o| "next.party" : ""
"next.national_account" }o--|| "next.party_role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id, kind) REFERENCES party(id, kind)`
- `FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE`

## next.national_account_owner

```mermaid
erDiagram
"next.national_account_owner" }o--o| "next.app_user" : ""
"next.national_account_owner" }o--o| "next.app_user" : ""
"next.national_account_owner" }o--o| "next.app_user" : ""
"next.national_account_owner" }o--o| "next.job" : ""
"next.national_account_owner" }o--|| "next.national_account" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (owner_id, owner_is_partner) REFERENCES app_user(id, is_account_partner)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (account_id) REFERENCES national_account(party_id) ON UPDATE CASCADE`
