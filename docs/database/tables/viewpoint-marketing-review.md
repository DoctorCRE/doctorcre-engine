# Marketing review

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Platform metric"
  "Post review"
  "Post text"
  "Marketing posts (area)" {
    string post
  }
  "Property (area)" {
    string measurement
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Property (area)" }o--|| "Platform metric" : "Measurement: platform, metric"
  "Post review" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Post review" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Post review" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Post review" }o--|| "Marketing posts (area)" : "post ID to Post"
  "Post review" |o--o| "Post text" : "post ID, text version"
  "Post text" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Post text" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Post text" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Post text" }o--|| "Marketing posts (area)" : "post ID to Post"
  "Post text" }o--o| "Post text" : "post ID, previous version#160;#160;#160;#160;"
```

## Connects to

Numbers count foreign keys between the two areas.

[Marketing posts](viewpoint-marketing-posts.md) (2) · [Property](viewpoint-property.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (6)

## Tables

- [Platform metric](next.platform_metric.md)
- [Post review](next.post_review.md)
- [Post text](next.post_text.md)

See each table for its columns and links to other areas.
