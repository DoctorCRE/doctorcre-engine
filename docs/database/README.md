# Database drawings

Each box is an area of the database. The number on each line counts the foreign keys between the two areas. The drawing leaves out lines to areas that connect to more than half of the other areas.

<!-- Begin master drawing -->
```mermaid
---
config:
  layout: elk
  flowchart:
    htmlLabels: false
    diagramPadding: 8
    nodeSpacing: 25
    rankSpacing: 35
---
flowchart TB
  subgraph group0["People and clients"]
    a-people["People"]
    a-relationships["Relationships"]
    a-clients["Clients"]
    a-vendors-territories["Vendors and territories"]
    a-leads["Leads"]
  end
  subgraph group1["Deals and property"]
    a-deals["Deals"]
    a-imported-deals["Imported deals"]
    a-property["Property"]
    a-leases["Leases"]
    a-offers["Offers"]
    a-tours["Tours"]
    a-website["Client websites"]
  end
  subgraph group2["Mail and activity"]
    a-email["Email"]
    a-documents["Documents"]
    a-activity["Activity"]
    a-home-calendar["Home and calendar"]
    a-doc["Doc"]
  end
  subgraph group3["Marketing and billing"]
    a-marketing-posts["Marketing posts"]
    a-marketing-categories["Marketing categories"]
    a-marketing-review["Marketing review"]
    a-social-accounts["Social accounts"]
    a-invoices["Invoices"]
    a-commissions["Commissions"]
  end
  subgraph group4["Users and records"]
    a-users-jobs["Users and jobs"]
    a-changes-preferences["Changes and preferences"]
  end
  a-relationships ---|5| a-clients
  a-relationships ---|2| a-vendors-territories
  a-relationships ---|5| a-leads
  a-relationships ---|1| a-imported-deals
  a-relationships ---|1| a-property
  a-relationships ---|2| a-offers
  a-relationships ---|1| a-home-calendar
  a-relationships ---|2| a-doc
  a-vendors-territories ---|1| a-property
  a-leads ---|1| a-offers
  a-leads ---|1| a-email
  a-leads ---|3| a-activity
  a-property ---|3| a-leases
  a-property ---|2| a-offers
  a-property ---|1| a-tours
  a-property ---|2| a-activity
  a-property ---|1| a-home-calendar
  a-property ---|1| a-marketing-posts
  a-property ---|1| a-marketing-review
  a-leases ---|2| a-offers
  a-leases ---|2| a-documents
  a-offers ---|1| a-documents
  a-offers ---|6| a-activity
  a-offers ---|1| a-home-calendar
  a-tours ---|2| a-activity
  a-email ---|2| a-documents
  a-email ---|1| a-activity
  a-email ---|1| a-home-calendar
  a-email ---|2| a-doc
  a-documents ---|1| a-marketing-posts
  a-activity ---|2| a-home-calendar
  a-doc ---|1| a-changes-preferences
  a-marketing-posts ---|3| a-marketing-categories
  a-marketing-posts ---|2| a-marketing-review
  a-marketing-posts ---|1| a-social-accounts
  a-invoices ---|1| a-commissions
  a-invoices ---|1| a-changes-preferences
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
  click a-invoices href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-invoices.md"
  click a-marketing-posts href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-marketing-posts.md"
  click a-marketing-categories href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-marketing-categories.md"
  click a-marketing-review href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-marketing-review.md"
  click a-social-accounts href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-social-accounts.md"
  click a-tours href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-tours.md"
  click a-website href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-website.md"
  click a-users-jobs href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-users-jobs.md"
  click a-changes-preferences href "https://github.com/DoctorCRE/doctorcre-engine/blob/main/docs/database/tables/viewpoint-changes-preferences.md"
```

Almost every area records who made each row (Users and jobs).

The same rule omits lines to People and Deals.
<!-- End master drawing -->

Select a box to open its drawing on the main branch, or use the [area and table index](tables/README.md) to browse this version. Each area drawing labels its lines with the columns that link the tables. For columns, cross-area references, and constraints, open a table page or see [the schema](../../schema/next.sql).

## Regenerate

Install Node.js and Docker, start the Docker daemon, and run `npm ci`. From the repository root, run:

```sh
./docs/database/generate.sh
```

The command loads the schema into a disposable PostgreSQL 18 container. The pinned tbls image writes the table pages and exports the schema for the Mermaid drawings. The command stops the database container on exit.

Assign each new table to one area in [.tbls.yml](.tbls.yml). Rerun the command after schema changes and commit the generated pages. Split an area if its drawing becomes difficult to read.
