# Database drawings

Each overview drawing shows an area and its links to areas listed later, so every connected pair appears once. The number on each line counts foreign keys. Each area page shows connections in small drawings and lists their exact tables and columns below.

<!-- Begin master drawing -->
### People

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-people["People"]
  a-relationships["Relationships"]
  a-people ---|6| a-relationships
  a-clients["Clients"]
  a-people ---|2| a-clients
  a-vendors-territories["Vendors and territories"]
  a-people ---|1| a-vendors-territories
  a-deals["Deals"]
  a-people ---|2| a-deals
  a-imported-deals["Imported deals"]
  a-people ---|1| a-imported-deals
  a-property["Property"]
  a-people ---|1| a-property
  a-leases["Leases"]
  a-people ---|1| a-leases
  a-offers["Offers"]
  a-people ---|3| a-offers
  a-commissions["Commissions"]
  a-people ---|1| a-commissions
  a-documents["Documents"]
  a-people ---|1| a-documents
  a-email["Email"]
  a-people ---|1| a-email
  a-leads["Leads"]
  a-people ---|5| a-leads
  a-activity["Activity"]
  a-people ---|5| a-activity
  a-home-calendar["Home and calendar"]
  a-people ---|1| a-home-calendar
  a-doc["Doc"]
  a-people ---|1| a-doc
  a-social-accounts["Social accounts"]
  a-people ---|1| a-social-accounts
  a-website["Client websites"]
  a-people ---|1| a-website
  a-users-jobs["Users and jobs"]
  a-people ---|22| a-users-jobs
  a-changes-preferences["Changes and preferences"]
  a-people ---|1| a-changes-preferences
  click a-people href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-people.md"
  click a-relationships href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-relationships.md"
  click a-clients href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-clients.md"
  click a-vendors-territories href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-vendors-territories.md"
  click a-deals href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-deals.md"
  click a-imported-deals href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-imported-deals.md"
  click a-property href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-property.md"
  click a-leases href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-leases.md"
  click a-offers href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-offers.md"
  click a-commissions href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-commissions.md"
  click a-documents href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-documents.md"
  click a-email href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-email.md"
  click a-leads href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-leads.md"
  click a-activity href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-activity.md"
  click a-home-calendar href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-home-calendar.md"
  click a-doc href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-doc.md"
  click a-social-accounts href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-social-accounts.md"
  click a-website href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-website.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
  click a-changes-preferences href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-changes-preferences.md"
```

### Relationships

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-relationships["Relationships"]
  a-clients["Clients"]
  a-relationships ---|5| a-clients
  a-vendors-territories["Vendors and territories"]
  a-relationships ---|2| a-vendors-territories
  a-deals["Deals"]
  a-relationships ---|6| a-deals
  a-imported-deals["Imported deals"]
  a-relationships ---|1| a-imported-deals
  a-property["Property"]
  a-relationships ---|1| a-property
  a-offers["Offers"]
  a-relationships ---|2| a-offers
  a-leads["Leads"]
  a-relationships ---|5| a-leads
  a-home-calendar["Home and calendar"]
  a-relationships ---|1| a-home-calendar
  a-doc["Doc"]
  a-relationships ---|2| a-doc
  a-users-jobs["Users and jobs"]
  a-relationships ---|26| a-users-jobs
  click a-relationships href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-relationships.md"
  click a-clients href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-clients.md"
  click a-vendors-territories href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-vendors-territories.md"
  click a-deals href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-deals.md"
  click a-imported-deals href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-imported-deals.md"
  click a-property href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-property.md"
  click a-offers href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-offers.md"
  click a-leads href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-leads.md"
  click a-home-calendar href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-home-calendar.md"
  click a-doc href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-doc.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Clients

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-clients["Clients"]
  a-users-jobs["Users and jobs"]
  a-clients ---|26| a-users-jobs
  click a-clients href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-clients.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Vendors and territories

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-vendors-territories["Vendors and territories"]
  a-deals["Deals"]
  a-vendors-territories ---|1| a-deals
  a-property["Property"]
  a-vendors-territories ---|1| a-property
  a-users-jobs["Users and jobs"]
  a-vendors-territories ---|30| a-users-jobs
  click a-vendors-territories href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-vendors-territories.md"
  click a-deals href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-deals.md"
  click a-property href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-property.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Deals

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-deals["Deals"]
  a-imported-deals["Imported deals"]
  a-deals ---|9| a-imported-deals
  a-property["Property"]
  a-deals ---|2| a-property
  a-leases["Leases"]
  a-deals ---|4| a-leases
  a-offers["Offers"]
  a-deals ---|7| a-offers
  a-commissions["Commissions"]
  a-deals ---|1| a-commissions
  a-documents["Documents"]
  a-deals ---|1| a-documents
  a-leads["Leads"]
  a-deals ---|2| a-leads
  a-activity["Activity"]
  a-deals ---|5| a-activity
  a-home-calendar["Home and calendar"]
  a-deals ---|2| a-home-calendar
  a-doc["Doc"]
  a-deals ---|1| a-doc
  a-invoices["Invoices"]
  a-deals ---|3| a-invoices
  a-tours["Tours"]
  a-deals ---|1| a-tours
  a-website["Client websites"]
  a-deals ---|1| a-website
  a-users-jobs["Users and jobs"]
  a-deals ---|29| a-users-jobs
  click a-deals href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-deals.md"
  click a-imported-deals href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-imported-deals.md"
  click a-property href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-property.md"
  click a-leases href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-leases.md"
  click a-offers href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-offers.md"
  click a-commissions href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-commissions.md"
  click a-documents href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-documents.md"
  click a-leads href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-leads.md"
  click a-activity href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-activity.md"
  click a-home-calendar href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-home-calendar.md"
  click a-doc href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-doc.md"
  click a-invoices href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-invoices.md"
  click a-tours href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-tours.md"
  click a-website href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-website.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Imported deals

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-imported-deals["Imported deals"]
  a-users-jobs["Users and jobs"]
  a-imported-deals ---|15| a-users-jobs
  click a-imported-deals href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-imported-deals.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Property

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-property["Property"]
  a-leases["Leases"]
  a-property ---|3| a-leases
  a-offers["Offers"]
  a-property ---|2| a-offers
  a-activity["Activity"]
  a-property ---|2| a-activity
  a-home-calendar["Home and calendar"]
  a-property ---|1| a-home-calendar
  a-marketing-posts["Marketing posts"]
  a-property ---|1| a-marketing-posts
  a-marketing-review["Marketing review"]
  a-property ---|1| a-marketing-review
  a-tours["Tours"]
  a-property ---|1| a-tours
  a-users-jobs["Users and jobs"]
  a-property ---|18| a-users-jobs
  click a-property href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-property.md"
  click a-leases href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-leases.md"
  click a-offers href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-offers.md"
  click a-activity href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-activity.md"
  click a-home-calendar href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-home-calendar.md"
  click a-marketing-posts href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-marketing-posts.md"
  click a-marketing-review href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-marketing-review.md"
  click a-tours href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-tours.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Leases

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-leases["Leases"]
  a-offers["Offers"]
  a-leases ---|2| a-offers
  a-documents["Documents"]
  a-leases ---|2| a-documents
  a-users-jobs["Users and jobs"]
  a-leases ---|17| a-users-jobs
  click a-leases href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-leases.md"
  click a-offers href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-offers.md"
  click a-documents href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-documents.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Offers

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-offers["Offers"]
  a-documents["Documents"]
  a-offers ---|1| a-documents
  a-leads["Leads"]
  a-offers ---|1| a-leads
  a-activity["Activity"]
  a-offers ---|6| a-activity
  a-home-calendar["Home and calendar"]
  a-offers ---|1| a-home-calendar
  a-users-jobs["Users and jobs"]
  a-offers ---|14| a-users-jobs
  click a-offers href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-offers.md"
  click a-documents href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-documents.md"
  click a-leads href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-leads.md"
  click a-activity href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-activity.md"
  click a-home-calendar href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-home-calendar.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Commissions

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-commissions["Commissions"]
  a-invoices["Invoices"]
  a-commissions ---|1| a-invoices
  a-users-jobs["Users and jobs"]
  a-commissions ---|14| a-users-jobs
  click a-commissions href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-commissions.md"
  click a-invoices href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-invoices.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Documents

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-documents["Documents"]
  a-email["Email"]
  a-documents ---|2| a-email
  a-marketing-posts["Marketing posts"]
  a-documents ---|1| a-marketing-posts
  a-users-jobs["Users and jobs"]
  a-documents ---|12| a-users-jobs
  click a-documents href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-documents.md"
  click a-email href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-email.md"
  click a-marketing-posts href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-marketing-posts.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Email

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-email["Email"]
  a-leads["Leads"]
  a-email ---|1| a-leads
  a-activity["Activity"]
  a-email ---|1| a-activity
  a-home-calendar["Home and calendar"]
  a-email ---|1| a-home-calendar
  a-doc["Doc"]
  a-email ---|2| a-doc
  a-users-jobs["Users and jobs"]
  a-email ---|21| a-users-jobs
  click a-email href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-email.md"
  click a-leads href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-leads.md"
  click a-activity href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-activity.md"
  click a-home-calendar href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-home-calendar.md"
  click a-doc href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-doc.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Leads

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-leads["Leads"]
  a-activity["Activity"]
  a-leads ---|3| a-activity
  a-users-jobs["Users and jobs"]
  a-leads ---|15| a-users-jobs
  click a-leads href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-leads.md"
  click a-activity href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-activity.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Activity

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-activity["Activity"]
  a-home-calendar["Home and calendar"]
  a-activity ---|2| a-home-calendar
  a-tours["Tours"]
  a-activity ---|2| a-tours
  a-users-jobs["Users and jobs"]
  a-activity ---|12| a-users-jobs
  click a-activity href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-activity.md"
  click a-home-calendar href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-home-calendar.md"
  click a-tours href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-tours.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Home and calendar

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-home-calendar["Home and calendar"]
  a-users-jobs["Users and jobs"]
  a-home-calendar ---|20| a-users-jobs
  click a-home-calendar href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-home-calendar.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Doc

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-doc["Doc"]
  a-users-jobs["Users and jobs"]
  a-doc ---|3| a-users-jobs
  a-changes-preferences["Changes and preferences"]
  a-doc ---|1| a-changes-preferences
  click a-doc href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-doc.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
  click a-changes-preferences href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-changes-preferences.md"
```

### Invoices

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-invoices["Invoices"]
  a-users-jobs["Users and jobs"]
  a-invoices ---|6| a-users-jobs
  a-changes-preferences["Changes and preferences"]
  a-invoices ---|1| a-changes-preferences
  click a-invoices href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-invoices.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
  click a-changes-preferences href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-changes-preferences.md"
```

### Marketing posts

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-marketing-posts["Marketing posts"]
  a-marketing-categories["Marketing categories"]
  a-marketing-posts ---|3| a-marketing-categories
  a-marketing-review["Marketing review"]
  a-marketing-posts ---|2| a-marketing-review
  a-social-accounts["Social accounts"]
  a-marketing-posts ---|1| a-social-accounts
  a-users-jobs["Users and jobs"]
  a-marketing-posts ---|6| a-users-jobs
  click a-marketing-posts href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-marketing-posts.md"
  click a-marketing-categories href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-marketing-categories.md"
  click a-marketing-review href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-marketing-review.md"
  click a-social-accounts href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-social-accounts.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Marketing categories

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-marketing-categories["Marketing categories"]
  a-users-jobs["Users and jobs"]
  a-marketing-categories ---|6| a-users-jobs
  click a-marketing-categories href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-marketing-categories.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Marketing review

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-marketing-review["Marketing review"]
  a-users-jobs["Users and jobs"]
  a-marketing-review ---|6| a-users-jobs
  click a-marketing-review href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-marketing-review.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Social accounts

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-social-accounts["Social accounts"]
  a-users-jobs["Users and jobs"]
  a-social-accounts ---|4| a-users-jobs
  click a-social-accounts href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-social-accounts.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Tours

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-tours["Tours"]
  a-users-jobs["Users and jobs"]
  a-tours ---|6| a-users-jobs
  click a-tours href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-tours.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Client websites

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-website["Client websites"]
  a-users-jobs["Users and jobs"]
  a-website ---|4| a-users-jobs
  click a-website href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-website.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
```

### Users and jobs

```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
---
flowchart LR
  a-users-jobs["Users and jobs"]
  a-changes-preferences["Changes and preferences"]
  a-users-jobs ---|10| a-changes-preferences
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
  click a-changes-preferences href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-changes-preferences.md"
```

<!-- End master drawing -->

Select a box to open its drawing on the main branch, or use the [area and table index](tables/README.md) to browse this version. Each area drawing labels its lines with the columns that link the tables. For columns, cross-area references, and constraints, open a table page or see [the schema](../../schema/next.sql).

## Regenerate

Install Node.js and Docker, start the Docker daemon, and run `npm ci`. From the repository root, run:

```sh
./docs/database/generate.sh
```

The command loads the schema into a disposable PostgreSQL 18 container. The pinned tbls image writes the table pages and exports the schema for the Mermaid drawings. The command stops the database container on exit.

Assign each new table to one area in [.tbls.yml](.tbls.yml). Rerun the command after schema changes and commit the generated pages. Split an area if its drawing becomes difficult to read.
