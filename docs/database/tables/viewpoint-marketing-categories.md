# Marketing categories

Each line shows a connection. The foreign keys below name the exact columns.

### Design template

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Design template"]
  n0["Marketing posts (area)"]
  center --- n0
  n1["Users and jobs (area)"]
  center --- n1
```

### Idea

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Idea"]
  n0["Marketing posts (area)"]
  center --- n0
  n1["Users and jobs (area)"]
  center --- n1
```

### Platform format

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  center["Platform format"]
  n0["Marketing posts (area)"]
  center --- n0
```

## Foreign keys

| From table and columns                                             | To table and columns                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [design_template](next.design_template.md) (`changed_by_user_id`)  | [app_user](next.app_user.md) (`id`)                               |
| [design_template](next.design_template.md) (`changed_for_user_id`) | [app_user](next.app_user.md) (`id`)                               |
| [design_template](next.design_template.md) (`changed_by_job`)      | [job](next.job.md) (`slug`)                                       |
| [idea](next.idea.md) (`changed_by_user_id`)                        | [app_user](next.app_user.md) (`id`)                               |
| [idea](next.idea.md) (`changed_for_user_id`)                       | [app_user](next.app_user.md) (`id`)                               |
| [idea](next.idea.md) (`changed_by_job`)                            | [job](next.job.md) (`slug`)                                       |
| [post](next.post.md) (`design_template_id`)                        | [design_template](next.design_template.md) (`id`)                 |
| [post](next.post.md) (`idea_id`)                                   | [idea](next.idea.md) (`id`)                                       |
| [post](next.post.md) (`platform`, `format`)                        | [platform_format](next.platform_format.md) (`platform`, `format`) |

## Connects to

Numbers count foreign keys between the two areas.

[Marketing posts](viewpoint-marketing-posts.md) (3) · [Users and jobs](viewpoint-users-jobs.md) (6)

## Tables

- [Design template](next.design_template.md)
- [Idea](next.idea.md)
- [Platform format](next.platform_format.md)
