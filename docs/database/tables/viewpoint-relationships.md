# Relationships

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Claim type"
  "How found"
  "Introduction"
  "Party link"
  "Party role"
  "Party specialty"
  "Relationship level"
  "Role"
  "Specialty"
  "Introduction" }o--|| "Party role" : "vendor ID, vendor role"
  "Party role" }o--o| "Relationship level" : "relationship level"
  "Party role" }o--|| "Role" : "role"
  "Party specialty" }o--|| "Specialty" : "specialty"
```

## Tables

- [Claim type](next.claim_type.md)
- [How found](next.how_found.md)
- [Introduction](next.introduction.md)
- [Party link](next.party_link.md)
- [Party role](next.party_role.md)
- [Party specialty](next.party_specialty.md)
- [Relationship level](next.relationship_level.md)
- [Role](next.role.md)
- [Specialty](next.specialty.md)

See each table for its columns and links to other areas.
