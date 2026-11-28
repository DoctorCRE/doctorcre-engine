# system

## next.app_user

```mermaid
erDiagram
"next.app_user" }o--|| "next.party" : ""
```

- `FOREIGN KEY (id, kind) REFERENCES party(id, kind)`

## next.change

```mermaid
erDiagram
"next.change" }o--o| "next.app_user" : ""
"next.change" }o--o| "next.app_user" : ""
"next.change" }o--o| "next.job" : ""
"next.change" }o--o| "next.merged_party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id) DEFERRABLE INITIALLY DEFERRED`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (merge_of) REFERENCES merged_party(id)`

## next.imported_change

```mermaid
erDiagram
"next.imported_change" }o--o| "next.app_user" : ""
"next.imported_change" }o--o| "next.app_user" : ""
"next.imported_change" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.job

```mermaid
erDiagram
"next.job"
```

## next.save_receipt

```mermaid
erDiagram
"next.save_receipt"
```

## next.user_preference

```mermaid
erDiagram
"next.user_preference" }o--o| "next.app_user" : ""
"next.user_preference" }o--o| "next.app_user" : ""
"next.user_preference" |o--|| "next.app_user" : ""
"next.user_preference" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
