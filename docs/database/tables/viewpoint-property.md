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
  "Activity about (Activity)" }o--o| "Property" : "property ID"
  "Building ownership" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Building ownership" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Building ownership" }o--o| "Job (Users and jobs)" : "changed by job"
  "Building ownership" }o--|| "Party (People)" : "party ID"
  "Building ownership" }o--|| "Property" : "property ID"
  "Deal property" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Deal property" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Deal property" }o--|| "Deal (Deals)" : "deal ID"
  "Deal property" }o--o| "Job (Users and jobs)" : "changed by job"
  "Deal property" }o--|| "Property" : "property ID"
  "Home update (Home and calendar)" }o--o| "Property" : "property ID"
  "Lease (Leases)" }o--o| "Deal property" : "deal ID, property ID"
  "Lease (Leases)" }o--|| "Property" : "property ID"
  "Lease suite (Leases)" }o--|| "Suite" : "suite ID, property ID"
  "Measurement" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Measurement" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Measurement" }o--o| "Job (Users and jobs)" : "changed by job"
  "Measurement" }o--|| "Platform metric (Marketing review)" : "platform, metric"
  "Measurement" }o--|| "Post (Marketing posts)" : "post ID, platform"
  "Next step (Activity)" }o--o| "Property" : "property ID"
  "Offer (Offers)" }o--|| "Deal property" : "deal ID, property ID"
  "Property" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Property" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Property" }o--o| "Job (Users and jobs)" : "changed by job"
  "Proposal (Offers)" }o--o| "Property" : "property ID"
  "Space need" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Space need" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Space need" }o--|| "Deal (Deals)" : "deal ID"
  "Space need" }o--o| "Job (Users and jobs)" : "changed by job"
  "Space need" }o--o| "Market (Vendors and territories)" : "market ID"
  "Space need" }o--o| "Party role (Relationships)" : "vendor ID, vendor role"
  "Suite" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Suite" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Suite" }o--o| "Job (Users and jobs)" : "changed by job"
  "Suite" }o--|| "Property" : "property ID"
  "Tour stop (Tours)" }o--|| "Property" : "property ID"
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
