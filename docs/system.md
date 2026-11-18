# The system

Read this page first. It names the parts, how they connect today and after the switch, who owns which records, and where every topic is written down. Detail lives in the files the last table points to; this page never repeats it.

## The parts

| Part         | Where                                                              | What it does                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App          | `jbookout/doctorcre-app`, a Cloudflare Worker at app.doctorcre.com | The partners' screens. Its Worker sends each call to the old system or the engine (`src/worker.js`).                                                                                               |
| Engine       | `src/` here, the Worker `doctorcre-engine`                         | Serves the partners' records to the app, the old system's programs and the assistant. Partner calls use `/api/engine/...`; Studio jobs use `/jobs/...` and `/intake/...` behind one service token. |
| New database | `schema/next.sql`, filled by `schema/copy-*.sql`                   | The database the engine moves to: every record once, with its rules in constraints. Specified in `docs/new-database.md`.                                                                           |
| Old database | Neon, snapshot in `schema/business.sql`                            | Today's records. The old system owns its tables; the engine reads them and makes a few saves.                                                                                                      |
| Old system   | `DoctorCRE/carr-system`                                            | Being replaced. Its API Worker (`mcp-server`) answers the app and the assistant; its programs on the Studio Mac do mail and calls.                                                                 |

The old system's programs that touch the three features' records:

| Program                                                                                                   | Runs                                 | Moves to the engine through                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| Mail intake                                                                                               | Every 30 minutes                     | Doors 19 and 20; the calendar agenda through door 25     |
| Email router                                                                                              | After each intake run                | Door 21                                                  |
| Reply outbox                                                                                              | Every minute                         | Door 22                                                  |
| Nightly jobs: next-step cadence, deal checklist reminders, lead stages and invoice closes, deal room page | Nightly                              | Door 18 for cadence; invoice application for lead stages |
| Call capture                                                                                              | After each recorded call             | Doors 16, 18, 19 and 21                                  |
| The assistant                                                                                             | Claude sessions through `mcp-server` | Doors 18 and 19, and the deal saves                      |

The full program list, with file and line, is in `docs/new-database.md` § "Who reads and writes the three features' records".

## How they connect

Today:

```text
partner ─▶ app ─┬─▶ old API (mcp-server) ─▶ old database        every save, most reads
                └─▶ engine ─▶ old database                       reads whose app switch is on
Studio programs ─▶ old API ─▶ old database                       mail, calls, nightly jobs
Studio programs ─▶ engine /jobs ─▶ old database                  only where its Studio switch is on
```

After the switch:

```text
partner ─▶ app ─▶ engine ─▶ new database
Studio programs and the assistant ─▶ engine (/jobs, /api/engine) ─▶ new database
```

Outlook stays the source of mail and calendar; the Studio programs read it and hand each email, file and meeting to the engine once.

## Switches

Each switch moves one path and turns back by setting it off. None of them builds anything.

| Switch                            | Where it is set                                                      | What it moves                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ENGINE_ROUTING` keys, value `on` | App Worker KV                                                        | App reads to the engine: `deals-from-engine` (board and deal page), `leads-from-engine`, `invoices-from-engine`, `charts-from-engine` (client fit), `national-deals-from-engine` (capture queue), `search-from-engine`, `clients-vendors-from-engine`, `relationships-from-engine`, `frame-from-engine` (Today and meeting prep). No app save has a key yet. |
| `DEALS_READ_SCHEMA=next`          | Engine Worker variable                                               | The engine's Deals reads move from the old views to the new database. Set it before `deals-from-engine` (`docs/new-database.md` § "Deals reads for the app").                                                                                                                                                                                                |
| `engine_mail`                     | Studio, `~/.config/carr/outlook.json`                                | Mail intake sends emails and attachments to doors 19 and 20 instead of the old API.                                                                                                                                                                                                                                                                          |
| `engine_router`                   | Same file                                                            | The router stores suggestions through door 21.                                                                                                                                                                                                                                                                                                               |
| `engine_outbox`                   | Same file; needs `engine_mail`                                       | The outbox reads approved replies and records delivery through door 22.                                                                                                                                                                                                                                                                                      |
| `engine_cadence`                  | Same file                                                            | The nightly cadence saves its steps through door 18.                                                                                                                                                                                                                                                                                                         |
| `engine_lead_stage`               | Same file                                                            | The nightly lead stages apply invoice closes through the engine.                                                                                                                                                                                                                                                                                             |
| `engine_calls`                    | Studio call capture config                                           | Call capture sends calls, suggestions and automatic changes to doors 16, 18, 19 and 21.                                                                                                                                                                                                                                                                      |
| `ENGINE_ASSISTANT="true"`         | Old API Worker, `mcp-server/wrangler.toml` (checked in as `"false"`) | The assistant's supported deal and step saves go to the engine.                                                                                                                                                                                                                                                                                              |

No switch exists yet for: the calendar agenda (intake still publishes it to the old API), the nightly checklist reminders, the deal room page, and the app's saves on Deals, Home, email and calendar (slices 29 and 30).

## Who owns which records

- Until the switch, the old system owns every table in the old database. The engine saves deal fields, notes, next steps, overdue holds and closings into those tables through its write login, and changes no schema there (decision 1).
- After the switch, the engine owns every record in the new database. The app, the Studio programs and the assistant change records only through engine doors, and each save is stamped with its partner or job (decision 100).
- Which old kind goes to which new table, and what is left behind: `docs/new-database.md` § "Where each populated kind goes" and § "Kinds not moved or empty".
- Mail and calendar stay in Outlook. The database keeps what intake records: each email once by Message-ID, its links, files and suggestions.

## The switch plan

The owner's rulings of 2026-11-17:

- The switch happens by 2026-11-30.
- The practice run is Wed 2026-11-25: the whole move on a fresh copy of production (slice 32), with the copies in the order of `docs/new-database.md` § "Running the copies". Until then, the practice move reruns on a fresh copy after each merge that changes a copy or a read.
- Switch day is Sat 2026-11-28. Thu 2026-11-26 is allowed only if the practice run is clean; the coordinator tells the owner which day by Wednesday evening.
- On switch day, mail intake and saving pause briefly for the move, then the switches above flip. Switch day builds nothing: every old-system and app change ships before it, switched off.

Not yet written down: the order of the switches after the Deals pair, and how long the pause lasts. A brief that needs either reports the gap; it does not decide it.

## Open decisions

The owner's open questions live on one list, "What we need from you" on the roadmap in the private plans repo. A brief or pull request never answers one. It reports the question to the coordinator, who adds it there.

## Where to find it

| Topic                                                    | File § section                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Words to use on screens and in code                      | `docs/glossary.md`                                                                             |
| Lasting decisions, numbered                              | `docs/decisions.md`                                                                            |
| Running the check, local database, comparing old and new | `README.md`                                                                                    |
| The new database's tables, one line each                 | `docs/new-database.md` § "Records"                                                             |
| Users, jobs and save stamps                              | § "Users, jobs and who changed what"; § "Change history"                                       |
| Rules the database enforces                              | § "Rules the database enforces"; `schema/next.sql`                                             |
| Who may change what                                      | § "Who may change what"                                                                        |
| People, companies, emails and phone numbers              | § "Emails and phone numbers"; § "Do not contact, NPIs and outside ids"; § "Merging duplicates" |
| Clients, national accounts, leads                        | § "Clients, brands and national accounts"; § "Leads and clients"                               |
| Deals, phases, parking                                   | § "Deals"; § "When a deal falls apart"                                                         |
| Markets and territories                                  | § "Markets and territories"                                                                    |
| Vendors and introductions                                | § "Vendors"; § "Who knows whom"                                                                |
| Leases, critical dates, offers                           | § "Leases and options"; § "Critical dates"; § "Offer rounds"                                   |
| Buildings, suites, space needs                           | § "Space needs, suites and building owners"                                                    |
| Deal and client files                                    | § "Deal files and extracted text"; § "Client files"                                            |
| Activity, emails, next steps                             | § "Activity, emails and next steps"; § "Worked example: an LOI response by email"              |
| Suggestions and reply drafts                             | § "Suggestions from mail, calls and meetings"; § "Reply drafts"                                |
| Home marks and preferences                               | § "Users' preferences and Home marks"                                                          |
| Tours and marketing                                      | § "Tours as meetings"; § "Marketing"                                                           |
| Commissions and invoices                                 | § "Commissions"; § "Invoices found in email"                                                   |
| The copy: order and reruns                               | § "Running the copies"                                                                         |
| The copy of one kind                                     | § "Copying today's ..." for that kind                                                          |
| Which program reads and writes what                      | § "Who reads and writes the three features' records" and its tables                            |
| Slice numbers                                            | § "Slices named above"                                                                         |
| Doors: shared rules                                      | § "What every door shares"                                                                     |
| Door 19, 20, 21, 22, 25, 16, 18                          | § "Doors the old system calls", the heading with that number                                   |
| Invoice capture and application                          | § "Invoice email capture and list"; § "Invoice application"                                    |
| Deals reads and their switch                             | § "Deals reads for the app"                                                                    |
| Owner decisions the doors raised                         | § "Owner decisions"                                                                            |
| Home screen                                              | `docs/screens/home-inbox.md`                                                                   |

Every `§` without a file is in `docs/new-database.md`.
