# property

## next.building_ownership

```mermaid
erDiagram
"next.building_ownership" }o--o| "next.app_user" : ""
"next.building_ownership" }o--o| "next.app_user" : ""
"next.building_ownership" }o--o| "next.job" : ""
"next.building_ownership" }o--|| "next.party" : ""
"next.building_ownership" }o--|| "next.property" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (party_id) REFERENCES party(id)`
- `FOREIGN KEY (property_id) REFERENCES property(id)`

## next.deal_property

```mermaid
erDiagram
"next.deal_property" }o--o| "next.app_user" : ""
"next.deal_property" }o--o| "next.app_user" : ""
"next.deal_property" }o--|| "next.deal" : ""
"next.deal_property" }o--o| "next.job" : ""
"next.deal_property" }o--|| "next.property" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (property_id) REFERENCES property(id)`

## next.measurement

```mermaid
erDiagram
"next.measurement" }o--o| "next.app_user" : ""
"next.measurement" }o--o| "next.app_user" : ""
"next.measurement" }o--o| "next.job" : ""
"next.measurement" }o--|| "next.platform_metric" : ""
"next.measurement" }o--|| "next.post" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (platform, metric) REFERENCES platform_metric(platform, metric)`
- `FOREIGN KEY (post_id, platform) REFERENCES post(id, platform)`

## next.property

```mermaid
erDiagram
"next.property" }o--o| "next.app_user" : ""
"next.property" }o--o| "next.app_user" : ""
"next.property" }o--o| "next.job" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`

## next.space_need

```mermaid
erDiagram
"next.space_need" }o--o| "next.app_user" : ""
"next.space_need" }o--o| "next.app_user" : ""
"next.space_need" }o--|| "next.deal" : ""
"next.space_need" }o--o| "next.job" : ""
"next.space_need" }o--o| "next.market" : ""
"next.space_need" }o--o| "next.party_role" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (deal_id) REFERENCES deal(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (market_id) REFERENCES market(id)`
- `FOREIGN KEY (vendor_id, vendor_role) REFERENCES party_role(party_id, role) ON UPDATE CASCADE`

## next.suite

```mermaid
erDiagram
"next.suite" }o--o| "next.app_user" : ""
"next.suite" }o--o| "next.app_user" : ""
"next.suite" }o--o| "next.job" : ""
"next.suite" }o--|| "next.property" : ""
```

- `FOREIGN KEY (changed_by_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_for_user_id) REFERENCES app_user(id)`
- `FOREIGN KEY (changed_by_job) REFERENCES job(slug)`
- `FOREIGN KEY (property_id) REFERENCES property(id)`
