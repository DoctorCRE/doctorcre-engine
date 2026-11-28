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
  "Critical date" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Critical date" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Critical date" }o--o| "App user (Users and jobs)" : "confirmed by user ID"
  "Critical date" }o--o| "App user (Users and jobs)" : "resolved by user ID"
  "Critical date" }o--|| "Deal (Deals)" : "deal ID"
  "Critical date" }o--o| "Document (Documents)" : "document ID"
  "Critical date" }o--o| "Job (Users and jobs)" : "changed by job"
  "Critical date" }o--o| "Lease option" : "lease version ID, option number"
  "Critical date" }o--o| "Lease version" : "lease version ID"
  "Critical date" }o--o| "Offer (Offers)" : "offer ID, deal ID"
  "Deal (Deals)" }o--o| "Lease" : "renews lease ID"
  "Lease" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Lease" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Lease" |o--o| "Deal (Deals)" : "deal ID"
  "Lease" }o--o| "Deal party (Deals)" : "deal ID, party ID, client role"
  "Lease" }o--o| "Deal property (Property)" : "deal ID, property ID"
  "Lease" }o--o| "Job (Users and jobs)" : "changed by job"
  "Lease" }o--|| "Party (People)" : "party ID"
  "Lease" }o--|| "Property (Property)" : "property ID"
  "Lease option" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Lease option" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Lease option" }o--o| "Job (Users and jobs)" : "changed by job"
  "Lease option" }o--|| "Lease version" : "lease version ID"
  "Lease suite" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Lease suite" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Lease suite" }o--o| "Job (Users and jobs)" : "changed by job"
  "Lease suite" }o--|| "Lease" : "lease ID, property ID"
  "Lease suite" }o--|| "Lease version" : "lease version ID, lease ID"
  "Lease suite" }o--|| "Suite (Property)" : "suite ID, property ID"
  "Lease version" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Lease version" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Lease version" }o--|| "Document (Documents)" : "document ID"
  "Lease version" }o--o| "Job (Users and jobs)" : "changed by job"
  "Lease version" }o--|| "Lease" : "lease ID"
  "Lease version" }o--o| "Lease version" : "lease ID, previous version#160;#160;#160;#160;"
  "Lease version" }o--o| "Offer (Offers)" : "offer ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Deals](viewpoint-deals.md) (4) · [Documents](viewpoint-documents.md) (2) · [Offers](viewpoint-offers.md) (2) · [People](viewpoint-people.md) (1) · [Property](viewpoint-property.md) (3) · [Users and jobs](viewpoint-users-jobs.md) (17)

## Tables

- [Critical date](next.critical_date.md)
- [Lease](next.lease.md)
- [Lease option](next.lease_option.md)
- [Lease suite](next.lease_suite.md)
- [Lease version](next.lease_version.md)

See each table for its columns and links to other areas.
