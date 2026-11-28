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
  "Documents (area)" {
    string document
  }
  "Marketing categories (area)" {
    string design_template
    string idea
    string platform_format
  }
  "Marketing review (area)" {
    string post_review
    string post_text
  }
  "Property (area)" {
    string measurement
  }
  "Social accounts (area)" {
    string social_account
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Property (area)" }o--|| "Post" : "Measurement: post ID, platform"
  "Post" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Post" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Post" }o--o| "Marketing categories (area)" : "design template ID to Design template"
  "Post" }o--o| "Marketing categories (area)" : "idea ID to Idea"
  "Post" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Post" }o--|| "Marketing categories (area)" : "platform, format to Platform format"
  "Post" }o--|| "Social accounts (area)" : "social account ID, platform to Social account"
  "Post media" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Post media" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Post media" }o--|| "Documents (area)" : "document ID, content type to Document"
  "Post media" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Post media" }o--|| "Post" : "post ID, format"
  "Marketing review (area)" }o--|| "Post" : "Post review: post ID"
  "Marketing review (area)" }o--|| "Post" : "Post text: post ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Documents](viewpoint-documents.md) (1) · [Marketing categories](viewpoint-marketing-categories.md) (3) · [Marketing review](viewpoint-marketing-review.md) (2) · [Property](viewpoint-property.md) (1) · [Social accounts](viewpoint-social-accounts.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (6)

## Tables

- [Post](next.post.md)
- [Post media](next.post_media.md)

See each table for its columns and links to other areas.
