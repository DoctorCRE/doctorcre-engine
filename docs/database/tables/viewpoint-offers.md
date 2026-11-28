# Offers

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Offer"
  "Offer claim"
  "Offer document"
  "Proposal"
  "Critical date (Leases)" }o--o| "Offer" : "offer ID, deal ID"
  "Home mark (Home and calendar)" }o--o| "Proposal" : "proposal ID"
  "Lease version (Leases)" }o--o| "Offer" : "offer ID"
  "Offer" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Offer" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Offer" }o--|| "Deal party (Deals)" : "deal ID, from party ID, from role"
  "Offer" }o--|| "Deal property (Property)" : "deal ID, property ID"
  "Offer" }o--o| "Job (Users and jobs)" : "changed by job"
  "Offer" }o--o| "Offer" : "deal ID, answers round#160;#160;#160;#160;"
  "Offer claim" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Offer claim" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Offer claim" }o--|| "Claim type (Relationships)" : "claim type"
  "Offer claim" }o--o| "Job (Users and jobs)" : "changed by job"
  "Offer claim" }o--|| "Offer" : "offer ID"
  "Offer document" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Offer document" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Offer document" }o--|| "Document (Documents)" : "document ID"
  "Offer document" }o--o| "Job (Users and jobs)" : "changed by job"
  "Offer document" }o--|| "Offer" : "offer ID"
  "Proposal" }o--o| "Activity (Activity)" : "activity ID, activity kind"
  "Proposal" }o--o| "Activity about (Activity)" : "activity ID, call deal ID"
  "Proposal" }o--o| "Activity about (Activity)" : "activity ID, held deal ID"
  "Proposal" }o--o| "Activity about (Activity)" : "activity ID, party ID"
  "Proposal" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Proposal" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Proposal" }o--o| "App user (Users and jobs)" : "decided by user ID"
  "Proposal" |o--o| "Candidate (Leads)" : "candidate ID"
  "Proposal" }o--o| "Deal (Deals)" : "deal ID"
  "Proposal" }o--o| "Deal (Deals)" : "filed deal ID"
  "Proposal" }o--o| "How found (Relationships)" : "how found"
  "Proposal" }o--o| "Job (Users and jobs)" : "changed by job"
  "Proposal" }o--|| "Job (Users and jobs)" : "proposed by job"
  "Proposal" }o--o| "Next step (Activity)" : "merged step ID"
  "Proposal" }o--o| "Next step (Activity)" : "next step ID, deal ID"
  "Proposal" }o--o| "Party (People)" : "filed vendor ID"
  "Proposal" }o--o| "Party (People)" : "owner party ID"
  "Proposal" }o--o| "Party (People)" : "party ID"
  "Proposal" }o--o| "Phase (Deals)" : "from phase"
  "Proposal" }o--o| "Phase (Deals)" : "to phase"
  "Proposal" }o--o| "Property (Property)" : "property ID"
  "Proposal" }o--o| "Stage (Deals)" : "lead role, from stage"
  "Proposal" }o--o| "Stage (Deals)" : "lead role, to stage"
```

## Connects to

Numbers count foreign keys between the two areas.

[Activity](viewpoint-activity.md) (6) · [Deals](viewpoint-deals.md) (7) · [Documents](viewpoint-documents.md) (1) · [Home and calendar](viewpoint-home-calendar.md) (1) · [Leads](viewpoint-leads.md) (1) · [Leases](viewpoint-leases.md) (2) · [People](viewpoint-people.md) (3) · [Property](viewpoint-property.md) (2) · [Relationships](viewpoint-relationships.md) (2) · [Users and jobs](viewpoint-users-jobs.md) (14)

## Tables

- [Offer](next.offer.md)
- [Offer claim](next.offer_claim.md)
- [Offer document](next.offer_document.md)
- [Proposal](next.proposal.md)

See each table for its columns and links to other areas.
