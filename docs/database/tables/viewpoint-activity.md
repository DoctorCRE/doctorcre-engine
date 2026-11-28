# Activity

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Activity"
  "Activity about"
  "Deal attention alert"
  "Next step"
  "Activity about" }o--|| "Activity" : "activity ID"
  "Next step" }o--o| "Activity" : "call activity ID, call kind"
  "Next step" }o--o| "Activity about" : "call activity ID, deal ID"
```

## Tables

- [Activity](next.activity.md)
- [Activity about](next.activity_about.md)
- [Deal attention alert](next.deal_attention_alert.md)
- [Next step](next.next_step.md)

See each table for its columns and links to other areas.
