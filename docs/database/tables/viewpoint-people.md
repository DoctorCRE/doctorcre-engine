# People

```mermaid
---
title: "\u00a0"
config:
  layout: elk
  er:
    titleTopMargin: 56
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Do not contact"
  "Merged party"
  "Outside ID"
  "Party"
  "Party company"
  "Party email"
  "Party phone"
  "Activity (Activity)" }o--o| "Party" : "from party ID"
  "Activity about (Activity)" }o--o| "Party" : "party ID"
  "App user (Users and jobs)" }o--|| "Party" : "ID, kind"
  "Building ownership (Property)" }o--|| "Party" : "party ID"
  "Candidate (Leads)" }o--o| "Party" : "promoted party ID"
  "Change (Changes and preferences)" }o--o| "Merged party" : "merge of"
  "Client brand (Clients)" }o--o| "Party" : "brand ID, brand kind"
  "Commission share (Commissions)" }o--|| "Party" : "party ID"
  "Deal client website (Client websites)" }o--|| "Party" : "client party ID"
  "Deal party (Deals)" }o--|| "Party" : "party ID"
  "Do not contact" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Do not contact" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Do not contact" }o--o| "Job (Users and jobs)" : "changed by job"
  "Do not contact" |o--|| "Party" : "party ID"
  "Doc judgment destination (Doc)" }o--o| "Party" : "vendor ID"
  "Home mark (Home and calendar)" }o--o| "Party" : "waiting on party ID"
  "Imported deal party (Imported deals)" }o--|| "Party" : "party ID"
  "Introduction (Relationships)" }o--|| "Party" : "introduced party ID"
  "Lead contact draft (Leads)" |o--|| "Party" : "party ID"
  "Lead email attention (Leads)" |o--|| "Party" : "party ID"
  "Lead email source (Leads)" }o--|| "Party" : "party ID"
  "Lead stage move (Leads)" }o--|| "Party" : "party ID"
  "Lease (Leases)" }o--|| "Party" : "party ID"
  "Merged party" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Merged party" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Merged party" }o--o| "Job (Users and jobs)" : "changed by job"
  "Merged party" }o--|| "Party" : "survivor ID"
  "National account (Clients)" }o--o| "Party" : "party ID, kind"
  "Next step (Activity)" }o--o| "Party" : "call contact party ID"
  "Next step (Activity)" }o--o| "Party" : "owner party ID"
  "Next step (Activity)" }o--o| "Party" : "party ID"
  "Outside ID" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Outside ID" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Outside ID" }o--o| "Deal (Deals)" : "deal ID"
  "Outside ID" }o--o| "Email (Email)" : "email activity ID"
  "Outside ID" }o--o| "Job (Users and jobs)" : "changed by job"
  "Outside ID" }o--o| "Party" : "party ID"
  "Party" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Party" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Party" }o--o| "How found (Relationships)" : "how found"
  "Party" }o--o| "Job (Users and jobs)" : "changed by job"
  "Party company" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Party company" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Party company" }o--o| "Job (Users and jobs)" : "changed by job"
  "Party company" }o--|| "Party" : "company ID, company kind"
  "Party company" }o--|| "Party" : "person ID, person kind"
  "Party document (Documents)" }o--|| "Party" : "party ID"
  "Party email" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Party email" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Party email" }o--o| "Job (Users and jobs)" : "changed by job"
  "Party email" }o--|| "Party" : "party ID"
  "Party link (Relationships)" }o--|| "Party" : "other party ID"
  "Party link (Relationships)" }o--|| "Party" : "party ID"
  "Party phone" }o--o| "App user (Users and jobs)" : "changed by user ID"
  "Party phone" }o--o| "App user (Users and jobs)" : "changed for user ID"
  "Party phone" }o--o| "Job (Users and jobs)" : "changed by job"
  "Party phone" }o--|| "Party" : "party ID"
  "Party role (Relationships)" }o--|| "Party" : "party ID"
  "Party specialty (Relationships)" }o--|| "Party" : "person ID, person kind"
  "Party territory (Vendors and territories)" }o--|| "Party" : "party ID"
  "Proposal (Offers)" }o--o| "Party" : "filed vendor ID"
  "Proposal (Offers)" }o--o| "Party" : "owner party ID"
  "Proposal (Offers)" }o--o| "Party" : "party ID"
  "Social account (Social accounts)" }o--|| "Party" : "owner party ID"
```

## Connects to

Numbers count foreign keys between the two areas.

[Activity](viewpoint-activity.md) (5) · [Changes and preferences](viewpoint-changes-preferences.md) (1) · [Client websites](viewpoint-website.md) (1) · [Clients](viewpoint-clients.md) (2) · [Commissions](viewpoint-commissions.md) (1) · [Deals](viewpoint-deals.md) (2) · [Doc](viewpoint-doc.md) (1) · [Documents](viewpoint-documents.md) (1) · [Email](viewpoint-email.md) (1) · [Home and calendar](viewpoint-home-calendar.md) (1) · [Imported deals](viewpoint-imported-deals.md) (1) · [Leads](viewpoint-leads.md) (5) · [Leases](viewpoint-leases.md) (1) · [Offers](viewpoint-offers.md) (3) · [Property](viewpoint-property.md) (1) · [Relationships](viewpoint-relationships.md) (6) · [Social accounts](viewpoint-social-accounts.md) (1) · [Users and jobs](viewpoint-users-jobs.md) (22) · [Vendors and territories](viewpoint-vendors-territories.md) (1)

## Tables

- [Do not contact](next.do_not_contact.md)
- [Merged party](next.merged_party.md)
- [Outside ID](next.outside_id.md)
- [Party](next.party.md)
- [Party company](next.party_company.md)
- [Party email](next.party_email.md)
- [Party phone](next.party_phone.md)

See each table for its columns and links to other areas.
