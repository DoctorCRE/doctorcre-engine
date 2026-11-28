# Property

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Building ownership"
  "Deal property"
  "Measurement"
  "Property"
  "Space need"
  "Suite"
  "Activity (area)" {
    string activity_about
    string next_step
  }
  "Deals (area)" {
    string deal
  }
  "Home and calendar (area)" {
    string home_update
  }
  "Leases (area)" {
    string lease
    string lease_suite
  }
  "Marketing posts (area)" {
    string post
  }
  "Marketing review (area)" {
    string platform_metric
  }
  "Offers (area)" {
    string offer
    string proposal
  }
  "People (area)" {
    string party
  }
  "Relationships (area)" {
    string party_role
  }
  "Tours (area)" {
    string tour_stop
  }
  "Users and jobs (area)" {
    string app_user
    string job
  }
  "Vendors and territories (area)" {
    string market
  }
  "Activity (area)" }o--o| "Property" : "Activity about: property ID"
  "Building ownership" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Building ownership" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Building ownership" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Building ownership" }o--|| "People (area)" : "party ID to Party"
  "Building ownership" }o--|| "Property" : "property ID"
  "Deal property" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Deal property" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Deal property" }o--|| "Deals (area)" : "deal ID to Deal"
  "Deal property" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Deal property" }o--|| "Property" : "property ID"
  "Home and calendar (area)" }o--o| "Property" : "Home update: property ID"
  "Leases (area)" }o--o| "Deal property" : "Lease: deal ID, property ID"
  "Leases (area)" }o--|| "Property" : "Lease: property ID"
  "Leases (area)" }o--|| "Suite" : "Lease suite: suite ID, property ID"
  "Measurement" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Measurement" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Measurement" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Measurement" }o--|| "Marketing review (area)" : "platform, metric to Platform metric"
  "Measurement" }o--|| "Marketing posts (area)" : "post ID, platform to Post"
  "Activity (area)" }o--o| "Property" : "Next step: property ID"
  "Offers (area)" }o--|| "Deal property" : "Offer: deal ID, property ID"
  "Property" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Property" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Property" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Offers (area)" }o--o| "Property" : "Proposal: property ID"
  "Space need" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Space need" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Space need" }o--|| "Deals (area)" : "deal ID to Deal"
  "Space need" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Space need" }o--o| "Vendors and territories (area)" : "market ID to Market"
  "Space need" }o--o| "Relationships (area)" : "vendor ID, vendor role to Party role"
  "Suite" }o--o| "Users and jobs (area)" : "changed by user ID to App user"
  "Suite" }o--o| "Users and jobs (area)" : "changed for user ID to App user"
  "Suite" }o--o| "Users and jobs (area)" : "changed by job to Job"
  "Suite" }o--|| "Property" : "property ID"
  "Tours (area)" }o--|| "Property" : "Tour stop: property ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Activity](viewpoint-activity.md) (2) · [Deals](viewpoint-deals.md) (2) · [Home and calendar](viewpoint-home-calendar.md) (1) · [Leases](viewpoint-leases.md) (3) · [Marketing posts](viewpoint-marketing-posts.md) (1) · [Marketing review](viewpoint-marketing-review.md) (1) · [Offers](viewpoint-offers.md) (2) · [People](viewpoint-people.md) (1) · [Relationships](viewpoint-relationships.md) (1) · [Tours](viewpoint-tours.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (18) · [Vendors and territories](viewpoint-vendors-territories.md) (1)

## Tables

- [Building ownership](next.building_ownership.md)
- [Deal property](next.deal_property.md)
- [Measurement](next.measurement.md)
- [Property](next.property.md)
- [Space need](next.space_need.md)
- [Suite](next.suite.md)

See each table for its columns and links to other areas.
