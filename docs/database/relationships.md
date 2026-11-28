# relationships

## next.claim_type

```mermaid
erDiagram
"next.claim_type" }o--o| "next.app_user" : ""
"next.claim_type" }o--o| "next.app_user" : ""
"next.claim_type" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.how_found

```mermaid
erDiagram
"next.how_found" }o--o| "next.app_user" : ""
"next.how_found" }o--o| "next.app_user" : ""
"next.how_found" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.introduction

```mermaid
erDiagram
"next.introduction" }o--o| "next.app_user" : ""
"next.introduction" }o--o| "next.app_user" : ""
"next.introduction" }o--o| "next.app_user" : ""
"next.introduction" }o--o| "next.deal" : ""
"next.introduction" }o--o| "next.job" : ""
"next.introduction" }o--|| "next.party" : ""
"next.introduction" }o--|| "next.party_role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (introduced_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (introduced_party_id) REFERENCES party(id)`
- `FOREIGN KEY (vendor_id, vendor_role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE`

## next.party_link

```mermaid
erDiagram
"next.party_link" }o--o| "next.app_user" : ""
"next.party_link" }o--o| "next.app_user" : ""
"next.party_link" }o--o| "next.job" : ""
"next.party_link" }o--|| "next.party" : ""
"next.party_link" }o--|| "next.party" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (other_party_id) REFERENCES party(id)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`

## next.party_role

```mermaid
erDiagram
"next.party_role" }o--o| "next.app_user" : ""
"next.party_role" }o--o| "next.app_user" : ""
"next.party_role" }o--o| "next.app_user" : ""
"next.party_role" }o--o| "next.client" : ""
"next.party_role" }o--o| "next.job" : ""
"next.party_role" }o--o| "next.lead_lane" : ""
"next.party_role" }o--|| "next.party" : ""
"next.party_role" }o--o| "next.relationship_level" : ""
"next.party_role" }o--|| "next.role" : ""
"next.party_role" }o--o| "next.stage" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (owner_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (lead_client_id) REFERENCES client(party_id) ON UPDATE CASCADE`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (lane) REFERENCES lead_lane(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
- `FOREIGN KEY (relationship_level) REFERENCES relationship_level(level)`
- `FOREIGN KEY (role) REFERENCES role(slug)`
- `FOREIGN KEY (role, stage) REFERENCES stage(role, slug)`

## next.party_specialty

```mermaid
erDiagram
"next.party_specialty" }o--o| "next.app_user" : ""
"next.party_specialty" }o--o| "next.app_user" : ""
"next.party_specialty" }o--o| "next.job" : ""
"next.party_specialty" }o--|| "next.party" : ""
"next.party_specialty" }o--|| "next.specialty" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (person_id, person_kind) REFERENCES party(id, kind)`
- `FOREIGN KEY (specialty) REFERENCES specialty(slug)`

## next.relationship_level

```mermaid
erDiagram
"next.relationship_level"
```

## next.role

```mermaid
erDiagram
"next.role" }o--o| "next.app_user" : ""
"next.role" }o--o| "next.app_user" : ""
"next.role" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.specialty

```mermaid
erDiagram
"next.specialty" }o--o| "next.app_user" : ""
"next.specialty" }o--o| "next.app_user" : ""
"next.specialty" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
