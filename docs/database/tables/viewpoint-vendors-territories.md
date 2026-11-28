# Vendors and territories

Each line shows a connection. The foreign keys below name the exact columns.

### Market

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Market"]
  n0["Deals (area)"]
  center --- n0
  n1["Market city"]
  center --- n1
  n2["Market county"]
  center --- n2
  n3["Property (area)"]
  center --- n3
  n4["Territory piece"]
  center --- n4
  n5["Users and jobs (area)"]
  center --- n5
```

### Market city

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Market city"]
  n0["Market"]
  center --- n0
  n1["Users and jobs (area)"]
  center --- n1
```

### Market county

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Market county"]
  n0["Market"]
  center --- n0
  n1["Users and jobs (area)"]
  center --- n1
```

### Party territory

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Party territory"]
  n0["Party territory review"]
  center --- n0
  n1["People (area)"]
  center --- n1
  n2["Territory"]
  center --- n2
  n3["Users and jobs (area)"]
  center --- n3
```

### Party territory review

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Party territory review"]
  n0["Party territory"]
  center --- n0
  n1["Users and jobs (area)"]
  center --- n1
```

### Territory

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Territory"]
  n0["Party territory"]
  center --- n0
  n1["Territory piece"]
  center --- n1
  n2["Users and jobs (area)"]
  center --- n2
```

### Territory piece

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Territory piece"]
  n0["Market"]
  center --- n0
  n1["Territory"]
  center --- n1
  n2["Users and jobs (area)"]
  center --- n2
```

### Vendor loan program

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Vendor loan program"]
  n0["Relationships (area)"]
  center --- n0
  n1["Users and jobs (area)"]
  center --- n1
```

### Vendor vertical

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Vendor vertical"]
  n0["Relationships (area)"]
  center --- n0
  n1["Users and jobs (area)"]
  center --- n1
```

## Foreign keys

| From table and columns                                                            | To table and columns                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [deal](next.deal.md) (`market_id`)                                                | [market](next.market.md) (`id`)                       |
| [market](next.market.md) (`changed_by_user_id`)                                   | [app_user](next.app_user.md) (`id`)                   |
| [market](next.market.md) (`changed_for_user_id`)                                  | [app_user](next.app_user.md) (`id`)                   |
| [market](next.market.md) (`changed_by_job`)                                       | [job](next.job.md) (`slug`)                           |
| [market_city](next.market_city.md) (`changed_by_user_id`)                         | [app_user](next.app_user.md) (`id`)                   |
| [market_city](next.market_city.md) (`changed_for_user_id`)                        | [app_user](next.app_user.md) (`id`)                   |
| [market_city](next.market_city.md) (`changed_by_job`)                             | [job](next.job.md) (`slug`)                           |
| [market_city](next.market_city.md) (`market_id`)                                  | [market](next.market.md) (`id`)                       |
| [market_county](next.market_county.md) (`changed_by_user_id`)                     | [app_user](next.app_user.md) (`id`)                   |
| [market_county](next.market_county.md) (`changed_for_user_id`)                    | [app_user](next.app_user.md) (`id`)                   |
| [market_county](next.market_county.md) (`changed_by_job`)                         | [job](next.job.md) (`slug`)                           |
| [market_county](next.market_county.md) (`market_id`)                              | [market](next.market.md) (`id`)                       |
| [party_territory](next.party_territory.md) (`changed_by_user_id`)                 | [app_user](next.app_user.md) (`id`)                   |
| [party_territory](next.party_territory.md) (`changed_for_user_id`)                | [app_user](next.app_user.md) (`id`)                   |
| [party_territory](next.party_territory.md) (`changed_by_job`)                     | [job](next.job.md) (`slug`)                           |
| [party_territory](next.party_territory.md) (`party_id`)                           | [party](next.party.md) (`id`)                         |
| [party_territory](next.party_territory.md) (`territory_id`)                       | [territory](next.territory.md) (`id`)                 |
| [party_territory_review](next.party_territory_review.md) (`changed_by_user_id`)   | [app_user](next.app_user.md) (`id`)                   |
| [party_territory_review](next.party_territory_review.md) (`changed_for_user_id`)  | [app_user](next.app_user.md) (`id`)                   |
| [party_territory_review](next.party_territory_review.md) (`reviewed_by_user_id`)  | [app_user](next.app_user.md) (`id`)                   |
| [party_territory_review](next.party_territory_review.md) (`reviewed_for_user_id`) | [app_user](next.app_user.md) (`id`)                   |
| [party_territory_review](next.party_territory_review.md) (`changed_by_job`)       | [job](next.job.md) (`slug`)                           |
| [party_territory_review](next.party_territory_review.md) (`reviewed_by_job`)      | [job](next.job.md) (`slug`)                           |
| [party_territory_review](next.party_territory_review.md) (`party_territory_id`)   | [party_territory](next.party_territory.md) (`id`)     |
| [space_need](next.space_need.md) (`market_id`)                                    | [market](next.market.md) (`id`)                       |
| [territory](next.territory.md) (`changed_by_user_id`)                             | [app_user](next.app_user.md) (`id`)                   |
| [territory](next.territory.md) (`changed_for_user_id`)                            | [app_user](next.app_user.md) (`id`)                   |
| [territory](next.territory.md) (`changed_by_job`)                                 | [job](next.job.md) (`slug`)                           |
| [territory_piece](next.territory_piece.md) (`changed_by_user_id`)                 | [app_user](next.app_user.md) (`id`)                   |
| [territory_piece](next.territory_piece.md) (`changed_for_user_id`)                | [app_user](next.app_user.md) (`id`)                   |
| [territory_piece](next.territory_piece.md) (`changed_by_job`)                     | [job](next.job.md) (`slug`)                           |
| [territory_piece](next.territory_piece.md) (`market_id`)                          | [market](next.market.md) (`id`)                       |
| [territory_piece](next.territory_piece.md) (`territory_id`)                       | [territory](next.territory.md) (`id`)                 |
| [vendor_loan_program](next.vendor_loan_program.md) (`changed_by_user_id`)         | [app_user](next.app_user.md) (`id`)                   |
| [vendor_loan_program](next.vendor_loan_program.md) (`changed_for_user_id`)        | [app_user](next.app_user.md) (`id`)                   |
| [vendor_loan_program](next.vendor_loan_program.md) (`changed_by_job`)             | [job](next.job.md) (`slug`)                           |
| [vendor_loan_program](next.vendor_loan_program.md) (`party_id`, `role`)           | [party_role](next.party_role.md) (`party_id`, `role`) |
| [vendor_vertical](next.vendor_vertical.md) (`changed_by_user_id`)                 | [app_user](next.app_user.md) (`id`)                   |
| [vendor_vertical](next.vendor_vertical.md) (`changed_for_user_id`)                | [app_user](next.app_user.md) (`id`)                   |
| [vendor_vertical](next.vendor_vertical.md) (`changed_by_job`)                     | [job](next.job.md) (`slug`)                           |
| [vendor_vertical](next.vendor_vertical.md) (`party_id`, `role`)                   | [party_role](next.party_role.md) (`party_id`, `role`) |

## Connects to

Numbers count foreign keys between the two areas.

[Deals](viewpoint-deals.md) (1) · [People](viewpoint-people.md) (1) · [Property](viewpoint-property.md) (1) · [Relationships](viewpoint-relationships.md) (2) · [Users and jobs](viewpoint-users-jobs.md) (30)

## Tables

- [Market](next.market.md)
- [Market city](next.market_city.md)
- [Market county](next.market_county.md)
- [Party territory](next.party_territory.md)
- [Party territory review](next.party_territory_review.md)
- [Territory](next.territory.md)
- [Territory piece](next.territory_piece.md)
- [Vendor loan program](next.vendor_loan_program.md)
- [Vendor vertical](next.vendor_vertical.md)
