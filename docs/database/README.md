# Database drawings

These drawings show the tables and foreign keys in `schema/next.sql`. Each area diagram shows foreign keys between tables in that area. Lines carry the foreign key definitions. For links to tables in other areas, open a table from the diagram’s table list and see its columns and constraints. The [table index](tables/README.md) lists all tables and views. The drawings do not show every database rule. See [the schema](../../schema/next.sql) for those rules.

- [People](tables/viewpoint-people.md) and [relationships](tables/viewpoint-relationships.md)
- [Clients](tables/viewpoint-clients.md) and [vendors and territories](tables/viewpoint-vendors-territories.md)
- [Deals](tables/viewpoint-deals.md) and [imported deals](tables/viewpoint-imported-deals.md)
- [Property](tables/viewpoint-property.md), [leases](tables/viewpoint-leases.md), and [offers](tables/viewpoint-offers.md)
- [Commissions](tables/viewpoint-commissions.md) and [invoices](tables/viewpoint-invoices.md)
- [Documents](tables/viewpoint-documents.md) and [email](tables/viewpoint-email.md)
- [Leads](tables/viewpoint-leads.md), [activity and next steps](tables/viewpoint-activity.md), and [Home and calendar](tables/viewpoint-home-calendar.md)
- [Doc](tables/viewpoint-doc.md), [marketing posts](tables/viewpoint-marketing-posts.md), [marketing categories](tables/viewpoint-marketing-categories.md), [marketing review](tables/viewpoint-marketing-review.md), [social accounts](tables/viewpoint-social-accounts.md), [tours](tables/viewpoint-tours.md), and [client websites](tables/viewpoint-website.md)
- [Users and jobs](tables/viewpoint-users-jobs.md), and [changes and preferences](tables/viewpoint-changes-preferences.md)

## Regenerate

Install Node.js and Docker, start the Docker daemon, and run `npm ci`. From the repository root, run:

```sh
./docs/database/generate.sh
```

The command loads the schema into a disposable PostgreSQL 18 container and uses the pinned tbls image to generate the Mermaid drawings. It stops the database container on exit. Schema pull requests must rerun the command and commit the drawings. When adding a table or foreign key, update the relevant viewpoints in [.tbls.yml](.tbls.yml): add the table to its area. The table pages include cross-area references automatically. Split a viewpoint if its drawing becomes difficult to read.
