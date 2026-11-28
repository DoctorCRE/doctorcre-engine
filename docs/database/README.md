# Database drawings

These drawings show the tables and foreign keys in `schema/next.sql`. Each area includes the tables it owns and the tables they reference, including references across areas. A table can appear in more than one drawing. Lines show foreign keys; the list below each drawing names the columns and database constraint. The drawings do not show every database rule. See [the schema](../../schema/next.sql) for those rules.

- [People](people.md) and [relationships](relationships.md)
- [Clients](clients.md) and [vendors and territories](vendors-territories.md)
- [Deals](deals.md) and [imported deals](imported-deals.md)
- [Property](property.md), [leases](leases.md), and [offers](offers.md)
- [Commissions](commissions.md) and [invoices](invoices.md)
- [Documents](documents.md) and [email](email.md)
- [Leads](leads.md), [activity and next steps](activity.md), and [Home and calendar](home-calendar.md)
- [Doc](doc.md), [marketing](marketing.md), and [client websites](website.md)
- [System records](system.md)

## Regenerate

Install Python 3 and Docker, and start the Docker daemon. From the repository root, run:

```sh
./docs/database/generate.sh
```

The command loads the schema into a disposable PostgreSQL 18 container and uses the pinned tbls image to generate the Mermaid drawings. It stops the database container on exit. Schema pull requests must rerun the command and commit the drawings. When adding a table or foreign key, update the relevant viewpoints in [.tbls.yml](.tbls.yml): mark the table with `# area` in its area and include each referenced table, even when it belongs to another area. Split a viewpoint if its drawing becomes difficult to read.
