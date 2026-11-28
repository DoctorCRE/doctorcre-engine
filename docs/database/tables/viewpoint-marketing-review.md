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
  "Post review" |o--o| "Post text" : "post ID, text version"
  "Post text" }o--o| "Post text" : "post ID, previous version"
```

## Tables

- [Platform metric](next.platform_metric.md)
- [Post review](next.post_review.md)
- [Post text](next.post_text.md)

See each table for its columns and links to other areas.
