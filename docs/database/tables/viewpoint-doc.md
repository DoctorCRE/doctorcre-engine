# Doc

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Doc conversation"
  "Doc judgment destination"
  "Doc judgment job"
  "Doc link"
  "Doc turn"
  "Doc judgment destination" }o--o| "Doc judgment job" : "job ID, job kind"
  "Doc judgment job" }o--o| "Doc judgment destination" : "ID, first destination"
  "Doc turn" }o--|| "Doc conversation" : "conversation ID, owner user ID"
```

## Tables

- [Doc conversation](next.doc_conversation.md)
- [Doc judgment destination](next.doc_judgment_destination.md)
- [Doc judgment job](next.doc_judgment_job.md)
- [Doc link](next.doc_link.md)
- [Doc turn](next.doc_turn.md)

See each table for its columns and links to other areas.
