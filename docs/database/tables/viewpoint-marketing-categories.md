# Marketing categories

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Design template"
  "Idea"
  "Platform format"
  "Design template" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Design template" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Design template" }o--o| "Job (Users and jobs)" : "changed by job"
  "Idea" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Idea" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Idea" }o--o| "Job (Users and jobs)" : "changed by job"
  "Post (Marketing posts)" }o--o| "Design template" : "design template ID"
  "Post (Marketing posts)" }o--o| "Idea" : "idea ID"
  "Post (Marketing posts)" }o--|| "Platform format" : "platform, format"
```

## Connects to

Numbers count foreign keys between the two areas.

[Marketing posts](viewpoint-marketing-posts.md) (3) · [Users and jobs](viewpoint-users-jobs.md) (6)

## Tables

- [Design template](next.design_template.md)
- [Idea](next.idea.md)
- [Platform format](next.platform_format.md)

See each table for its columns and links to other areas.
