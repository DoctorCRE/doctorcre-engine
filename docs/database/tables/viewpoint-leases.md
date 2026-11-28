# Leases

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Critical date"
  "Lease"
  "Lease option"
  "Lease suite"
  "Lease version"
  "Critical date" }o--o| "Lease option" : "lease version ID, option number"
  "Critical date" }o--o| "Lease version" : "lease version ID"
  "Lease option" }o--|| "Lease version" : "lease version ID"
  "Lease suite" }o--|| "Lease" : "lease ID, property ID"
  "Lease suite" }o--|| "Lease version" : "lease version ID, lease ID"
  "Lease version" }o--|| "Lease" : "lease ID"
  "Lease version" }o--o| "Lease version" : "lease ID, previous version"
```

## Tables

- [Critical date](next.critical_date.md)
- [Lease](next.lease.md)
- [Lease option](next.lease_option.md)
- [Lease suite](next.lease_suite.md)
- [Lease version](next.lease_version.md)

See each table for its columns and links to other areas.
