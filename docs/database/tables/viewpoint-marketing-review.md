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
  "Measurement (Property)" }o--|| "Platform metric" : "platform, metric"
  "Post review" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Post review" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Post review" }o--o| "Job (Users and jobs)" : "changed by job"
  "Post review" }o--|| "Post (Marketing posts)" : "post ID"
  "Post review" |o--o| "Post text" : "post ID, text version"
  "Post text" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Post text" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Post text" }o--o| "Job (Users and jobs)" : "changed by job"
  "Post text" }o--|| "Post (Marketing posts)" : "post ID"
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
