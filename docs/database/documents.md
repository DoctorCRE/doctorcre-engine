# documents

## next.document

```mermaid
erDiagram
"next.document" }o--o| "next.app_user" : ""
"next.document" }o--o| "next.app_user" : ""
"next.document" }o--o| "next.deal" : ""
"next.document" }o--o| "next.document" : ""
"next.document" }o--o| "next.document_kind" : ""
"next.document" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (supersedes_id, deal_id, kind, previous_version) REFERENCES document(id, deal_id, kind, version)`
- `FOREIGN KEY (kind) REFERENCES document_kind(slug)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.document_extraction

```mermaid
erDiagram
"next.document_extraction" }o--o| "next.app_user" : ""
"next.document_extraction" }o--o| "next.app_user" : ""
"next.document_extraction" }o--|| "next.document" : ""
"next.document_extraction" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (document_id, deal_id) REFERENCES document(id, deal_id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.document_kind

```mermaid
erDiagram
"next.document_kind" }o--o| "next.app_user" : ""
"next.document_kind" }o--o| "next.app_user" : ""
"next.document_kind" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.party_document

```mermaid
erDiagram
"next.party_document" }o--o| "next.app_user" : ""
"next.party_document" }o--o| "next.app_user" : ""
"next.party_document" }o--|| "next.document" : ""
"next.party_document" }o--o| "next.job" : ""
"next.party_document" }o--|| "next.party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (document_id) REFERENCES document(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
