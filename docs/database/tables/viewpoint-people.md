# People

```mermaid
---
config:
  layout: elk
  er:
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
  "Do not contact" |o--|| "Party" : "party ID"
  "Merged party" }o--|| "Party" : "survivor ID"
  "Outside ID" }o--o| "Party" : "party ID"
  "Party company" }o--|| "Party" : "company ID, company kind"
  "Party company" }o--|| "Party" : "person ID, person kind"
  "Party email" }o--|| "Party" : "party ID"
  "Party phone" }o--|| "Party" : "party ID"
```

## Tables

- [Do not contact](next.do_not_contact.md)
- [Merged party](next.merged_party.md)
- [Outside ID](next.outside_id.md)
- [Party](next.party.md)
- [Party company](next.party_company.md)
- [Party email](next.party_email.md)
- [Party phone](next.party_phone.md)

See each table for its columns and links to other areas.
