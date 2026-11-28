# vendors-territories

## next.market

```mermaid
erDiagram
"next.market" }o--o| "next.app_user" : ""
"next.market" }o--o| "next.app_user" : ""
"next.market" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.market_city

```mermaid
erDiagram
"next.market_city" }o--o| "next.app_user" : ""
"next.market_city" }o--o| "next.app_user" : ""
"next.market_city" }o--o| "next.job" : ""
"next.market_city" }o--|| "next.market" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (market_id) REFERENCES market(id)`

## next.market_county

```mermaid
erDiagram
"next.market_county" }o--o| "next.app_user" : ""
"next.market_county" }o--o| "next.app_user" : ""
"next.market_county" }o--o| "next.job" : ""
"next.market_county" }o--|| "next.market" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (market_id) REFERENCES market(id)`

## next.party_territory

```mermaid
erDiagram
"next.party_territory" }o--o| "next.app_user" : ""
"next.party_territory" }o--o| "next.app_user" : ""
"next.party_territory" }o--o| "next.job" : ""
"next.party_territory" }o--|| "next.party" : ""
"next.party_territory" }o--|| "next.territory" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
- `FOREIGN KEY (territory_id) REFERENCES territory(id)`

## next.party_territory_review

```mermaid
erDiagram
"next.party_territory_review" }o--o| "next.app_user" : ""
"next.party_territory_review" }o--o| "next.app_user" : ""
"next.party_territory_review" }o--o| "next.app_user" : ""
"next.party_territory_review" }o--o| "next.app_user" : ""
"next.party_territory_review" }o--o| "next.job" : ""
"next.party_territory_review" }o--o| "next.job" : ""
"next.party_territory_review" |o--|| "next.party_territory" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (reviewed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (reviewed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (reviewed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_territory_id) REFERENCES party_territory(id)`

## next.territory

```mermaid
erDiagram
"next.territory" }o--o| "next.app_user" : ""
"next.territory" }o--o| "next.app_user" : ""
"next.territory" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.territory_piece

```mermaid
erDiagram
"next.territory_piece" }o--o| "next.app_user" : ""
"next.territory_piece" }o--o| "next.app_user" : ""
"next.territory_piece" }o--o| "next.job" : ""
"next.territory_piece" }o--o| "next.market" : ""
"next.territory_piece" }o--|| "next.territory" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (market_id) REFERENCES market(id)`
- `FOREIGN KEY (territory_id) REFERENCES territory(id)`

## next.vendor_loan_program

```mermaid
erDiagram
"next.vendor_loan_program" }o--o| "next.app_user" : ""
"next.vendor_loan_program" }o--o| "next.app_user" : ""
"next.vendor_loan_program" }o--o| "next.job" : ""
"next.vendor_loan_program" }o--|| "next.party_role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE`

## next.vendor_vertical

```mermaid
erDiagram
"next.vendor_vertical" }o--o| "next.app_user" : ""
"next.vendor_vertical" }o--o| "next.app_user" : ""
"next.vendor_vertical" }o--o| "next.job" : ""
"next.vendor_vertical" }o--|| "next.party_role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id, role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE`
