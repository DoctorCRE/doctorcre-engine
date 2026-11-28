# Leads

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Candidate"
  "Lead contact draft"
  "Lead email attention"
  "Lead email evidence"
  "Lead email source"
  "Lead lane"
  "Lead source sender"
  "Lead stage move"
  "Lead email attention" }o--|| "Lead email source" : "activity ID, party ID"
```

## Tables

- [Candidate](next.candidate.md)
- [Lead contact draft](next.lead_contact_draft.md)
- [Lead email attention](next.lead_email_attention.md)
- [Lead email evidence](next.lead_email_evidence.md)
- [Lead email source](next.lead_email_source.md)
- [Lead lane](next.lead_lane.md)
- [Lead source sender](next.lead_source_sender.md)
- [Lead stage move](next.lead_stage_move.md)

See each table for its columns and links to other areas.
