# Clients

Each line shows a connection. The foreign keys below name the exact columns.

### Client

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Client"]
  n0["Client brand"]
  center --- n0
  n1["Client type"]
  center --- n1
  n2["Relationships (area)"]
  center --- n2
  n3["Users and jobs (area)"]
  center --- n3
```

### Client brand

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Client brand"]
  n0["Client"]
  center --- n0
  n1["People (area)"]
  center --- n1
  n2["Users and jobs (area)"]
  center --- n2
```

### Client research

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Client research"]
  n0["Client research fact"]
  center --- n0
  n1["Relationships (area)"]
  center --- n1
  n2["Users and jobs (area)"]
  center --- n2
```

### Client research fact

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Client research fact"]
  n0["Client research"]
  center --- n0
  n1["Users and jobs (area)"]
  center --- n1
```

### Client type

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Client type"]
  n0["Client"]
  center --- n0
  n1["Users and jobs (area)"]
  center --- n1
```

### Client vertical

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Client vertical"]
  n0["Relationships (area)"]
  center --- n0
  n1["Users and jobs (area)"]
  center --- n1
```

### National account

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["National account"]
  n0["National account owner"]
  center --- n0
  n1["People (area)"]
  center --- n1
  n2["Relationships (area)"]
  center --- n2
  n3["Users and jobs (area)"]
  center --- n3
```

### National account owner

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["National account owner"]
  n0["National account"]
  center --- n0
  n1["Users and jobs (area)"]
  center --- n1
```

## Foreign keys

| From table and columns                                                                    | To table and columns                                      |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [client](next.client.md) (`changed_by_user_id`)                                           | [app_user](next.app_user.md) (`id`)                       |
| [client](next.client.md) (`changed_for_user_id`)                                          | [app_user](next.app_user.md) (`id`)                       |
| [client](next.client.md) (`owner_user_id`)                                                | [app_user](next.app_user.md) (`id`)                       |
| [client](next.client.md) (`client_type`)                                                  | [client_type](next.client_type.md) (`slug`)               |
| [client](next.client.md) (`changed_by_job`)                                               | [job](next.job.md) (`slug`)                               |
| [client](next.client.md) (`party_id`, `role`)                                             | [party_role](next.party_role.md) (`party_id`, `role`)     |
| [client_brand](next.client_brand.md) (`changed_by_user_id`)                               | [app_user](next.app_user.md) (`id`)                       |
| [client_brand](next.client_brand.md) (`changed_for_user_id`)                              | [app_user](next.app_user.md) (`id`)                       |
| [client_brand](next.client_brand.md) (`location_id`)                                      | [client](next.client.md) (`party_id`)                     |
| [client_brand](next.client_brand.md) (`changed_by_job`)                                   | [job](next.job.md) (`slug`)                               |
| [client_brand](next.client_brand.md) (`brand_id`, `brand_kind`)                           | [party](next.party.md) (`id`, `kind`)                     |
| [client_research](next.client_research.md) (`changed_by_user_id`)                         | [app_user](next.app_user.md) (`id`)                       |
| [client_research](next.client_research.md) (`changed_for_user_id`)                        | [app_user](next.app_user.md) (`id`)                       |
| [client_research](next.client_research.md) (`changed_by_job`)                             | [job](next.job.md) (`slug`)                               |
| [client_research](next.client_research.md) (`party_id`, `role`)                           | [party_role](next.party_role.md) (`party_id`, `role`)     |
| [client_research_fact](next.client_research_fact.md) (`changed_by_user_id`)               | [app_user](next.app_user.md) (`id`)                       |
| [client_research_fact](next.client_research_fact.md) (`changed_for_user_id`)              | [app_user](next.app_user.md) (`id`)                       |
| [client_research_fact](next.client_research_fact.md) (`research_id`)                      | [client_research](next.client_research.md) (`id`)         |
| [client_research_fact](next.client_research_fact.md) (`changed_by_job`)                   | [job](next.job.md) (`slug`)                               |
| [client_type](next.client_type.md) (`changed_by_user_id`)                                 | [app_user](next.app_user.md) (`id`)                       |
| [client_type](next.client_type.md) (`changed_for_user_id`)                                | [app_user](next.app_user.md) (`id`)                       |
| [client_type](next.client_type.md) (`changed_by_job`)                                     | [job](next.job.md) (`slug`)                               |
| [client_vertical](next.client_vertical.md) (`changed_by_user_id`)                         | [app_user](next.app_user.md) (`id`)                       |
| [client_vertical](next.client_vertical.md) (`changed_for_user_id`)                        | [app_user](next.app_user.md) (`id`)                       |
| [client_vertical](next.client_vertical.md) (`changed_by_job`)                             | [job](next.job.md) (`slug`)                               |
| [client_vertical](next.client_vertical.md) (`party_id`, `role`)                           | [party_role](next.party_role.md) (`party_id`, `role`)     |
| [national_account](next.national_account.md) (`changed_by_user_id`)                       | [app_user](next.app_user.md) (`id`)                       |
| [national_account](next.national_account.md) (`changed_for_user_id`)                      | [app_user](next.app_user.md) (`id`)                       |
| [national_account](next.national_account.md) (`changed_by_job`)                           | [job](next.job.md) (`slug`)                               |
| [national_account](next.national_account.md) (`party_id`, `kind`)                         | [party](next.party.md) (`id`, `kind`)                     |
| [national_account](next.national_account.md) (`party_id`, `role`)                         | [party_role](next.party_role.md) (`party_id`, `role`)     |
| [national_account_owner](next.national_account_owner.md) (`changed_by_user_id`)           | [app_user](next.app_user.md) (`id`)                       |
| [national_account_owner](next.national_account_owner.md) (`changed_for_user_id`)          | [app_user](next.app_user.md) (`id`)                       |
| [national_account_owner](next.national_account_owner.md) (`owner_id`, `owner_is_partner`) | [app_user](next.app_user.md) (`id`, `is_account_partner`) |
| [national_account_owner](next.national_account_owner.md) (`changed_by_job`)               | [job](next.job.md) (`slug`)                               |
| [national_account_owner](next.national_account_owner.md) (`account_id`)                   | [national_account](next.national_account.md) (`party_id`) |
| [party_role](next.party_role.md) (`lead_client_id`)                                       | [client](next.client.md) (`party_id`)                     |

## Connects to

Numbers count foreign keys between the two areas.

[People](viewpoint-people.md) (2) · [Relationships](viewpoint-relationships.md) (5) · [Users and jobs](viewpoint-users-jobs.md) (26)

## Tables

- [Client](next.client.md)
- [Client brand](next.client_brand.md)
- [Client research](next.client_research.md)
- [Client research fact](next.client_research_fact.md)
- [Client type](next.client_type.md)
- [Client vertical](next.client_vertical.md)
- [National account](next.national_account.md)
- [National account owner](next.national_account_owner.md)
