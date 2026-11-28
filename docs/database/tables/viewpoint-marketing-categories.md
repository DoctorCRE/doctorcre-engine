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
  "Marketing posts (area)" {
    string post
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Design template" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Design template" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Design template" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Idea" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Idea" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Idea" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Marketing posts (area)" }o--o| "Design template" : "Post: design template ID"
  "Marketing posts (area)" }o--o| "Idea" : "Post: idea ID"
  "Marketing posts (area)" }o--|| "Platform format" : "Post: platform, format"
```

## Connects to

Numbers count foreign keys between the two areas.

[Marketing posts](viewpoint-marketing-posts.md) (3) · [Users and jobs](viewpoint-users-jobs.md) (6)

## Tables

- [Design template](next.design_template.md)
- [Idea](next.idea.md)
- [Platform format](next.platform_format.md)

See each table for its columns and links to other areas.
