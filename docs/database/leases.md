# leases

## next.critical_date

```mermaid
erDiagram
"next.critical_date" }o--o| "next.app_user" : ""
"next.critical_date" }o--o| "next.app_user" : ""
"next.critical_date" }o--o| "next.app_user" : ""
"next.critical_date" }o--o| "next.app_user" : ""
"next.critical_date" }o--|| "next.deal" : ""
"next.critical_date" }o--o| "next.document" : ""
"next.critical_date" }o--o| "next.job" : ""
"next.critical_date" }o--o| "next.lease_option" : ""
"next.critical_date" }o--o| "next.lease_version" : ""
"next.critical_date" }o--o| "next.offer" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (confirmed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (resolved_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (document_id) REFERENCES document(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (lease_version_id, option_number) REFERENCES lease_option(lease_version_id, number)`
- `FOREIGN KEY (lease_version_id) REFERENCES lease_version(id)`
- `FOREIGN KEY (offer_id, deal_id) REFERENCES offer(id, deal_id)`

## next.lease

```mermaid
erDiagram
"next.lease" }o--o| "next.app_user" : ""
"next.lease" }o--o| "next.app_user" : ""
"next.lease" |o--o| "next.deal" : ""
"next.lease" }o--o| "next.deal_party" : ""
"next.lease" }o--o| "next.deal_property" : ""
"next.lease" }o--o| "next.job" : ""
"next.lease" }o--|| "next.party" : ""
"next.lease" }o--|| "next.property" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (deal_id, party_id, client_role) REFERENCES deal_party(deal_id, party_id, role) ON UPDATE CASCADE`
- `FOREIGN KEY (deal_id, property_id) REFERENCES deal_property(deal_id, property_id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
- `FOREIGN KEY (property_id) REFERENCES property(id)`

## next.lease_option

```mermaid
erDiagram
"next.lease_option" }o--o| "next.app_user" : ""
"next.lease_option" }o--o| "next.app_user" : ""
"next.lease_option" }o--o| "next.job" : ""
"next.lease_option" }o--|| "next.lease_version" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (lease_version_id) REFERENCES lease_version(id)`

## next.lease_suite

```mermaid
erDiagram
"next.lease_suite" }o--o| "next.app_user" : ""
"next.lease_suite" }o--o| "next.app_user" : ""
"next.lease_suite" }o--o| "next.job" : ""
"next.lease_suite" }o--|| "next.lease" : ""
"next.lease_suite" }o--|| "next.lease_version" : ""
"next.lease_suite" }o--|| "next.suite" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (lease_id, property_id) REFERENCES lease(id, property_id)`
- `FOREIGN KEY (lease_version_id, lease_id) REFERENCES lease_version(id, lease_id)`
- `FOREIGN KEY (suite_id, property_id) REFERENCES suite(id, property_id)`

## next.lease_version

```mermaid
erDiagram
"next.lease_version" }o--o| "next.app_user" : ""
"next.lease_version" }o--o| "next.app_user" : ""
"next.lease_version" }o--|| "next.document" : ""
"next.lease_version" }o--o| "next.job" : ""
"next.lease_version" }o--|| "next.lease" : ""
"next.lease_version" }o--o| "next.lease_version" : ""
"next.lease_version" }o--o| "next.offer" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (document_id) REFERENCES document(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (lease_id) REFERENCES lease(id)`
- `FOREIGN KEY (lease_id, previous_version) REFERENCES lease_version(lease_id, version)`
- `FOREIGN KEY (offer_id) REFERENCES offer(id)`
