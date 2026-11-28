# Social accounts

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Social account"
  "Social sign in"
  "Marketing posts (area)" {
    string post
  }
  "People (area)" {
    string party
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Marketing posts (area)" }o--|| "Social account" : "Post: social account ID, platform"
  "Social account" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Social account" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Social account" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Social account" }o--|| "People (area)" : "owner party ID to Party"
  "Social sign in" }o--|| "Users and jobs (area)" : "signed in by user ID to App user"
  "Social sign in" }o--|| "Social account" : "social account ID, platform account ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Marketing posts](viewpoint-marketing-posts.md) (1) · [People](viewpoint-people.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (4)

## Tables

- [Social account](next.social_account.md)
- [Social sign in](next.social_sign_in.md)

See each table for its columns and links to other areas.
