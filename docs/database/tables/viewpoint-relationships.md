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
  "Candidate (Leads)" }o--o| "Party role" : "promoted party ID, lead role"
  "Claim type" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Claim type" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Claim type" }o--o| "Job (Users and jobs)" : "changed by job"
  "Client (Clients)" }o--|| "Party role" : "party ID, role"
  "Client research (Clients)" }o--|| "Party role" : "party ID, role"
  "Client vertical (Clients)" }o--|| "Party role" : "party ID, role"
  "Deal party (Deals)" }o--o| "Party role" : "party ID, client role"
  "Deal party (Deals)" }o--|| "Role" : "role"
  "Doc judgment destination (Doc)" }o--o| "Party role" : "vendor ID, vendor role"
  "How found" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "How found" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "How found" }o--o| "Job (Users and jobs)" : "changed by job"
  "Imported deal party (Imported deals)" }o--|| "Role" : "role"
  "Introduction" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Introduction" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Introduction" }o--o| "App user (Users and jobs)" : "introduced by user ID"
  "Introduction" }o--o| "Deal (Deals)" : "deal ID"
  "Introduction" }o--o| "Deal party (Deals)" : "deal ID, introduced party ID, maker client role"
  "Introduction" }o--o| "Doc judgment job (Doc)" : "source job ID"
  "Introduction" }o--o| "Job (Users and jobs)" : "changed by job"
  "Introduction" }o--|| "Party (People)" : "introduced party ID"
  "Introduction" }o--|| "Party role" : "vendor ID, vendor role"
  "Lead contact draft (Leads)" }o--|| "Party role" : "party ID, role"
  "Lead email source (Leads)" }o--o| "Party role" : "party ID, lead role"
  "Lead stage move (Leads)" }o--|| "Party role" : "party ID, role"
  "National account (Clients)" }o--|| "Party role" : "party ID, role"
  "Offer claim (Offers)" }o--|| "Claim type" : "claim type"
  "Party (People)" }o--o| "How found" : "how found"
  "Party link" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Party link" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Party link" }o--o| "Job (Users and jobs)" : "changed by job"
  "Party link" }o--|| "Party (People)" : "other party ID"
  "Party link" }o--|| "Party (People)" : "party ID"
  "Party role" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Party role" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Party role" }o--o| "App user (Users and jobs)" : "owner user ID"
  "Party role" }o--o| "Client (Clients)" : "lead client ID"
  "Party role" }o--o| "Job (Users and jobs)" : "changed by job"
  "Party role" }o--o| "Lead lane (Leads)" : "lane"
  "Party role" }o--|| "Party (People)" : "party ID"
  "Party role" }o--o| "Relationship level" : "relationship level"
  "Party role" }o--|| "Role" : "role"
  "Party role" }o--o| "Stage (Deals)" : "role, stage"
  "Party specialty" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Party specialty" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Party specialty" }o--o| "Job (Users and jobs)" : "changed by job"
  "Party specialty" }o--|| "Party (People)" : "person ID, person kind"
  "Party specialty" }o--|| "Specialty" : "specialty"
  "Proposal (Offers)" }o--o| "How found" : "how found"
  "Role" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Role" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Role" }o--o| "Job (Users and jobs)" : "changed by job"
  "Space need (Property)" }o--o| "Party role" : "vendor ID, vendor role"
  "Specialty" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Specialty" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Specialty" }o--o| "Job (Users and jobs)" : "changed by job"
  "Stage (Deals)" }o--|| "Role" : "role"
  "Vendor loan program (Vendors and territories)" }o--|| "Party role" : "party ID, role"
  "Vendor vertical (Vendors and territories)" }o--|| "Party role" : "party ID, role"
  "Weekly review (Home and calendar)" }o--o| "Party role" : "party ID, lead role"
```

## Connects to

Numbers count foreign keys between the two areas.

[Clients](viewpoint-clients.md) (5) · [Deals](viewpoint-deals.md) (6) · [Doc](viewpoint-doc.md) (2) · [Home and calendar](viewpoint-home-calendar.md) (1) · [Imported deals](viewpoint-imported-deals.md) (1) · [Leads](viewpoint-leads.md) (5) · [Offers](viewpoint-offers.md) (2) · [People](viewpoint-people.md) (6) · [Property](viewpoint-property.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (26) · [Vendors and territories](viewpoint-vendors-territories.md) (2)

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
