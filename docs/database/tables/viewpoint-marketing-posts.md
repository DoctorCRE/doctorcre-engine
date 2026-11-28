# Marketing posts

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Post"
  "Post media"
  "Measurement (Property)" }o--|| "Post" : "post ID, platform"
  "Post" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Post" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Post" }o--o| "Design template (Marketing categories)" : "design template ID"
  "Post" }o--o| "Idea (Marketing categories)" : "idea ID"
  "Post" }o--o| "Job (Users and jobs)" : "changed by job"
  "Post" }o--|| "Platform format (Marketing categories)" : "platform, format"
  "Post" }o--|| "Social account (Social accounts)" : "social account ID, platform"
  "Post media" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Post media" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Post media" }o--|| "Document (Documents)" : "document ID, content type"
  "Post media" }o--o| "Job (Users and jobs)" : "changed by job"
  "Post media" }o--|| "Post" : "post ID, format"
  "Post review (Marketing review)" }o--|| "Post" : "post ID"
  "Post text (Marketing review)" }o--|| "Post" : "post ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Documents](viewpoint-documents.md) (1) · [Marketing categories](viewpoint-marketing-categories.md) (3) · [Marketing review](viewpoint-marketing-review.md) (2) · [Property](viewpoint-property.md) (1) · [Social accounts](viewpoint-social-accounts.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (6)

## Tables

- [Post](next.post.md)
- [Post media](next.post_media.md)

See each table for its columns and links to other areas.
