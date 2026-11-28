# Client websites

Each line shows a connection. The foreign keys below name the exact columns.

### Deal client website

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Deal client website"]
  n0["Deal client website attempt"]
  center --- n0
  n1["Deal client website grant"]
  center --- n1
  n2["Deals (area)"]
  center --- n2
  n3["People (area)"]
  center --- n3
  n4["Users and jobs (area)"]
  center --- n4
```

### Deal client website attempt

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Deal client website attempt"]
  n0["Deal client website"]
  center --- n0
```

### Deal client website grant

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Deal client website grant"]
  n0["Deal client website"]
  center --- n0
  n1["Users and jobs (area)"]
  center --- n1
```

## Foreign keys

| From table and columns                                                      | To table and columns                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [deal_client_website](next.deal_client_website.md) (`changed_by_user_id`)   | [app_user](next.app_user.md) (`id`)                         |
| [deal_client_website](next.deal_client_website.md) (`changed_for_user_id`)  | [app_user](next.app_user.md) (`id`)                         |
| [deal_client_website](next.deal_client_website.md) (`deal_id`)              | [deal](next.deal.md) (`id`)                                 |
| [deal_client_website](next.deal_client_website.md) (`changed_by_job`)       | [job](next.job.md) (`slug`)                                 |
| [deal_client_website](next.deal_client_website.md) (`client_party_id`)      | [party](next.party.md) (`id`)                               |
| [deal_client_website_attempt](next.deal_client_website_attempt.md) (`slug`) | [deal_client_website](next.deal_client_website.md) (`slug`) |
| [deal_client_website_grant](next.deal_client_website_grant.md) (`user_id`)  | [app_user](next.app_user.md) (`id`)                         |
| [deal_client_website_grant](next.deal_client_website_grant.md) (`slug`)     | [deal_client_website](next.deal_client_website.md) (`slug`) |

## Connects to

Numbers count foreign keys between the two areas.

[Deals](viewpoint-deals.md) (1) · [People](viewpoint-people.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (4)

## Tables

- [Deal client website](next.deal_client_website.md)
- [Deal client website attempt](next.deal_client_website_attempt.md)
- [Deal client website grant](next.deal_client_website_grant.md)
