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
  "Post (Marketing posts)" }o--|| "Social account" : "social account ID, platform"
  "Social account" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Social account" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Social account" }o--o| "Job (Users and jobs)" : "changed by job"
  "Social account" }o--|| "Party (People)" : "owner party ID"
  "Social sign in" }o--|| "App user (Users and jobs)" : "signed in by user ID"
  "Social sign in" }o--|| "Social account" : "social account ID, platform account ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Marketing posts](viewpoint-marketing-posts.md) (1) · [People](viewpoint-people.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (4)

## Tables

- [Social account](next.social_account.md)
- [Social sign in](next.social_sign_in.md)

See each table for its columns and links to other areas.
