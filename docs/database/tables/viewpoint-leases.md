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
  "Deals (area)" {
    string deal
    string deal_party
  }
  "Documents (area)" {
    string document
  }
  "Offers (area)" {
    string offer
  }
  "People (area)" {
    string party
  }
  "Property (area)" {
    string deal_property
    string property
    string suite
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Critical date" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Critical date" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Critical date" }o--o| "Users and jobs (area)" : "confirmed by user ID to App user"
  "Critical date" }o--o| "Users and jobs (area)" : "resolved by user ID to App user"
  "Critical date" }o--|| "Deals (area)" : "deal ID to Deal"
  "Critical date" }o--o| "Documents (area)" : "document ID to Document"
  "Critical date" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Critical date" }o--o| "Lease option" : "lease version ID, option number"
  "Critical date" }o--o| "Lease version" : "lease version ID"
  "Critical date" }o--o| "Offers (area)" : "offer ID, deal ID to Offer"
  "Deals (area)" }o--o| "Lease" : "Deal: renews lease ID"
  "Lease" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Lease" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Lease" |o--o| "Deals (area)" : "deal ID to Deal"
  "Lease" }o--o| "Deals (area)" : "deal ID, party ID, client role to Deal party"
  "Lease" }o--o| "Property (area)" : "deal ID, property ID to Deal property"
  "Lease" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Lease" }o--|| "People (area)" : "party ID to Party"
  "Lease" }o--|| "Property (area)" : "property ID to Property"
  "Lease option" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Lease option" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Lease option" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Lease option" }o--|| "Lease version" : "lease version ID"
  "Lease suite" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Lease suite" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Lease suite" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Lease suite" }o--|| "Lease" : "lease ID, property ID"
  "Lease suite" }o--|| "Lease version" : "lease version ID, lease ID"
  "Lease suite" }o--|| "Property (area)" : "suite ID, property ID to Suite"
  "Lease version" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Lease version" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Lease version" }o--|| "Documents (area)" : "document ID to Document"
  "Lease version" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Lease version" }o--|| "Lease" : "lease ID"
  "Lease version" }o--o| "Lease version" : "lease ID, previous version#160;#160;#160;#160;"
  "Lease version" }o--o| "Offers (area)" : "offer ID to Offer"
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
