# people

## next.do_not_contact

```mermaid
erDiagram
"next.do_not_contact" }o--o| "next.app_user" : ""
"next.do_not_contact" }o--o| "next.app_user" : ""
"next.do_not_contact" }o--o| "next.job" : ""
"next.do_not_contact" |o--|| "next.party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`

## next.merged_party

```mermaid
erDiagram
"next.merged_party" }o--o| "next.app_user" : ""
"next.merged_party" }o--o| "next.app_user" : ""
"next.merged_party" }o--o| "next.job" : ""
"next.merged_party" }o--|| "next.party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (survivor_id) REFERENCES party(id)`

## next.outside_id

```mermaid
erDiagram
"next.outside_id" }o--o| "next.app_user" : ""
"next.outside_id" }o--o| "next.app_user" : ""
"next.outside_id" }o--o| "next.deal" : ""
"next.outside_id" }o--o| "next.email" : ""
"next.outside_id" }o--o| "next.job" : ""
"next.outside_id" }o--o| "next.party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (email_activity_id) REFERENCES email(activity_id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`

## next.party

```mermaid
erDiagram
"next.party" }o--o| "next.app_user" : ""
"next.party" }o--o| "next.app_user" : ""
"next.party" }o--o| "next.how_found" : ""
"next.party" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id) DEFERRABLE INITIALLY DEFERRED`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (how_found) REFERENCES how_found(slug)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.party_company

```mermaid
erDiagram
"next.party_company" }o--o| "next.app_user" : ""
"next.party_company" }o--o| "next.app_user" : ""
"next.party_company" }o--o| "next.job" : ""
"next.party_company" }o--|| "next.party" : ""
"next.party_company" }o--|| "next.party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (company_id, company_kind) REFERENCES party(id, kind)`
- `FOREIGN KEY (person_id, person_kind) REFERENCES party(id, kind)`

## next.party_email

```mermaid
erDiagram
"next.party_email" }o--o| "next.app_user" : ""
"next.party_email" }o--o| "next.app_user" : ""
"next.party_email" }o--o| "next.job" : ""
"next.party_email" }o--|| "next.party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`

## next.party_phone

```mermaid
erDiagram
"next.party_phone" }o--o| "next.app_user" : ""
"next.party_phone" }o--o| "next.app_user" : ""
"next.party_phone" }o--o| "next.job" : ""
"next.party_phone" }o--|| "next.party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
