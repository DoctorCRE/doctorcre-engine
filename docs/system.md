# The system

Read this page first. It names the parts, how they connect today and after the switch, who owns which records, and where every topic is written down. Detail lives in the files the last table points to; this page links to it and does not repeat it.

## The parts

| Part         | Where                                                                                         | What it does                                                                                                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App          | `jbookout/doctorcre-app`, a Cloudflare Worker at app.doctorcre.com                            | The partners' screens. Its Worker currently checks page sign-in with the old API. After the [sign-in switch](sign-in.md), it checks with the engine (`src/worker.js`).                                                                                                                                           |
| Engine       | `src/` here, the Worker `doctorcre-engine`                                                    | Partners use `/api/engine/...`. The engine checks sessions with CARR until the [sign-in switch](sign-in.md) moves that check and `/auth/*` to the engine. Studio programs and the assistant use `/jobs/...`. The Friday batch uses `/intake/...`. Those two entrances have separate Cloudflare Access audiences. |
| New database | The `next` schema in the same Neon database: `schema/next.sql`, filled by `schema/copy-*.sql` | Every record once, with its rules in constraints. Specified in `docs/new-database.md`.                                                                                                                                                                                                                           |
| Old database | The old tables in that database, snapshot in `schema/business.sql`                            | Today's records. The old system owns them.                                                                                                                                                                                                                                                                       |
| Files        | Cloudflare R2 bucket `carr-documents`, engine binding `DEAL_DOCUMENTS`                        | File bytes. The new database keeps each file's name, type and key, never the bytes.                                                                                                                                                                                                                              |
| Old system   | `DoctorCRE/carr-system`                                                                       | Being replaced. Its API Worker (`mcp-server`) signs partners in, answers the app and serves the assistant. Its programs on the Studio Mac do mail, calls and nightly jobs.                                                                                                                                       |

The engine reads through its `DATABASE` binding and saves through `DATABASE_WRITER`. Production and staging each bind their own writer Hyperdrive in `wrangler.jsonc`. The production writer connects as `engine_business_writer`, separate from the reader login.

Which old program reads and writes what, with file and line: `docs/new-database.md` § "Who reads and writes the three features' records".

## How they connect

Today:

```text
partner ─▶ app ─┬─▶ old API (mcp-server) ─▶ old tables     sign-in, page checks, most reads and saves
                └─▶ engine /api/engine ─┬─▶ old tables      reads, deal saves with the app switch on, key_reuse replays with it off
                                        └─▶ next schema     Deals and invoice tracker reads, with their engine switches
                                                            Mark paid with invoices-from-engine on
signed-in partner ─▶ engine /api/engine ─▶ old tables        own calls with CSRF to patch-deal-field, update-deal, add-deal-note,
                                                            set-next-step, and presence
engine ─▶ old API /auth/session                             every partner call's sign-in check
Studio programs ─▶ old API ─▶ old tables                    every program whose switch is off
Studio programs, assistant ─▶ engine /jobs ─▶ next schema   only where a switch below is on
engine ─▶ R2                                                file bytes
```

After the switch:

```text
partner ─▶ app ─▶ engine /api/engine ─▶ next schema
Studio programs, assistant ─▶ engine /jobs ─▶ next schema
client website ─▶ share Worker ─▶ engine ClientWebsiteAccess ─▶ next schema
```

Partner sign-in follows a separate [after-hours switch](sign-in.md#switch-after-hours-with-advance-notice). The app then uses the engine for sign-in, page gates, and partner calls.

Outlook stays the source of mail and calendar. Which mail the database keeps, and how older mail without a Message-ID is matched: `docs/new-database.md` § "Activity, emails and next steps" and § "Copying today's emails". The agenda is one snapshot per partner, replaced whole (§ "25. Calendar agenda, review dismissals and meeting confirmations").

## Switches

Each switch moves where requests go. None of them builds anything, and none moves records back (see "Going back").

| Switch                                 | Where it is set                                                                       | What it moves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENGINE_ROUTING` read keys, value `on` | App Worker KV                                                                         | App reads to the engine: `deals-from-engine` (board and deal page), `leads-from-engine`, `invoices-from-engine`, `charts-from-engine` (client fit), `national-deals-from-engine` (capture queue), `search-from-engine`, `clients-vendors-from-engine`, `relationships-from-engine`, `home-from-engine` (Home inbox, mail priorities and Today), `frame-from-engine` (Today and meeting prep).                                                                                                                                             |
| `deal-saves-to-engine`, value `on`     | App Worker KV                                                                         | Not used after the switch. The engine writer has no write grants on the old tables, which freeze once saves move to the new schema.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `deals-saves-from-engine`              | App Worker KV                                                                         | Deals saves to the new schema: creation, phase, owner, attention, parking, next steps, deal items, notes, closing, participant changes and critical dates. Needs `deals-from-engine` on. It also enables the Prospects lane and Monday review.                                                                                                                                                                                                                                                                                            |
| `DEALS_READ_SCHEMA=next`               | Engine production vars in `wrangler.jsonc`                                            | Moves the Deals board and deal page reads to the new schema. The deal page read includes every filed document and pending email follow-ups for both partners. See § "Deals reads for the app" for switch order and cutover needs.                                                                                                                                                                                                                                                                                                         |
| `HOME_INBOX_READ_SCHEMA=next`          | Engine production vars in `wrangler.jsonc`                                            | Enables the Home read for next steps, call follow-ups, marks, reply drafts, pending suggestions (including possible leads from new senders), overdue completion reviews, and updates. Also enables `GET /api/engine/home/mail-priorities` and `GET /api/engine/home/today`. The app routes to these reads when `home-from-engine` is on. See § "Home inbox reads for the app", [Mail priorities](new-database.md#mail-priorities), and [Today panel](new-database.md#today-panel).                                                        |
| `LEADS_READ_SCHEMA=next`               | Engine production vars in `wrangler.jsonc`                                            | Moves the Leads board and drawer to the new database when `leads-from-engine` routes their calls to the engine. See [Leads reads for the app](new-database.md#leads-reads-for-the-app).                                                                                                                                                                                                                                                                                                                                                   |
| `DIRECTORY_READ_SCHEMA=next`           | Engine production vars in `wrangler.jsonc`                                            | Moves the Clients and Vendors directories and drawers to the new schema when `clients-vendors-from-engine` routes them to the engine. See § "Clients directory and drawer" and § "Vendors directory reads for the app".                                                                                                                                                                                                                                                                                                                   |
| `INVOICES_READ_SCHEMA=next`            | Engine production vars in `wrangler.jsonc`                                            | Home and Invoices read the tracker from the new schema when `invoices-from-engine` routes their calls to the engine. The same app switch routes Mark paid to `POST /api/engine/invoices/mark-paid`. See § "Invoice tracker reads for the app".                                                                                                                                                                                                                                                                                            |
| `SEARCH_READ_SCHEMA=next`              | Engine production vars in `wrangler.jsonc`                                            | Global Search reads the new database when `search-from-engine` routes it to the engine.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ACTIVITY_READ_SCHEMA=next`            | Engine production vars in `wrangler.jsonc`                                            | Recent Activity reads the new database when `clients-vendors-from-engine` routes it to the engine.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `RELATIONSHIPS_READ_SCHEMA=next`       | Engine production vars in `wrangler.jsonc`                                            | Reads the Relationships network from the new schema when `relationships-from-engine` routes the app to the engine. Home links to people and companies use the same party IDs. See § "Relationships read for the app".                                                                                                                                                                                                                                                                                                                     |
| `home-from-engine`, value `on`         | App Worker KV                                                                         | Routes Home reads and saves, including marks, to the engine when `HOME_INBOX_READ_SCHEMA=next` is set. Enable after `RELATIONSHIPS_READ_SCHEMA=next` and `relationships-from-engine`, and before the Studio switches.                                                                                                                                                                                                                                                                                                                     |
| `engine_mail`                          | Studio, `~/.config/carr/outlook.json`                                                 | Mail intake sends email with its Outlook conversation ID when available, filed-email notes and attachments to doors 19 and 20, unknown-sender lead suggestions to door 21, and calendar agenda to door 25. The old calendar-agenda board goes stale when this switch is on.                                                                                                                                                                                                                                                               |
| `engine_router`                        | Same file                                                                             | The router reads its queue, stores suggestions and reply drafts, and files emails to their thread's deal through doors 19, 21 and 22, and writes nothing to the old tables.                                                                                                                                                                                                                                                                                                                                                               |
| `engine_outbox`                        | Same file; needs `engine_mail`                                                        | The outbox reads approved replies and records delivery through door 22.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `engine_cadence`                       | Same file                                                                             | The nightly cadence saves its steps through door 18.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `engine_lead_stage`                    | Same file                                                                             | The nightly lead stages send invoice captures from an evidence file to the engine, skip the old invoice closes, and apply invoice closes through the engine.                                                                                                                                                                                                                                                                                                                                                                              |
| `engine_calls`                         | Studio, `~/.config/carr-capture/config.json`, or the file `CARR_CAPTURE_CONFIG` names | Call capture sends calls, suggestions and automatic changes to doors 16, 18, 19 and 21.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `ENGINE_ASSISTANT="true"`              | Old API production vars in `mcp-server/wrangler.toml`                                 | Four assistant saves go to `/jobs` as the `agent` job: a call, meeting or note on a deal, a deal's next step, completing a deal's or party's step, and a deal note. The old API still finds the deal or party in the old tables first. Every other assistant save and every assistant read stays on the old API. Once carr-system #3246 merges (open today), it also sends invoice captures to the engine, skips the old invoice closes in `advance-leads` and refuses the old invoice undo, so it then needs `engine_lead_stage` on too. |

The share Worker's `CLIENT_WEBSITE_ENGINE_SLUG` selects the verified website whose password checks and grant exchanges use the engine. The share Worker still serves and decrypts the site's files. See [the switch plan](#the-switch-plan) for when to set it.

The app and engine use the same `CLIENT_WEBSITE_ORIGIN` for signed-in website links. In production it points to `carr-share` at `https://share.doctorcre.com`. In staging it points to `carr-share-staging`, which calls `doctorcre-engine-staging`.

Still on the old API with no switch yet:

- Deal watch settings and updates, nightly checklist reminders, and the deal room page.
- Email and calendar calls outside the Home routing above (slice 30), and Deals saves outside the two save switches above (slice 29).
- Sign-in.

The signed-in Prospects lane, detail, quick add and Monday review use the new schema directly. The app enables them when `deals-saves-from-engine` is on.

The deal page's checklist and progress use the new schema with `DEALS_READ_SCHEMA=next`. See § "Deals reads for the app".

## Who owns which records

- Until the switch, the old system owns every old table. The engine saves deal fields, notes, next steps, overdue holds and closings into them, and changes no schema there (decision 1).
- After the switch, the engine owns every record in the new database. The app, the Studio programs and the assistant change records only through engine doors. Who each save names: § "Users, jobs and who changed what".
- Which old kind goes to which new table, and what is left behind: § "Where each populated kind goes" and § "Kinds not moved or empty".

## The switch plan

The owner updated the switch plan on 2026-11-19.

- Rehearse the full move on a fresh copy of production on Friday evening, November 20, in the order under "Running the copies". Until then, rerun the practice move after each merge that changes a copy or a read.
- For Friday's practice, set `CLIENT_WEBSITE_ENGINE_SLUG` on the staging share Worker to the verified website name. On switch day, set it on the production share Worker. In each environment, open the website from a signed-in deal page and check that it opens without asking for a password.
- Switch on Saturday, November 21, after a clean rehearsal. If Friday's practice run finds problems, switch on Sunday, November 22.
- On switch day, mail intake and saving pause briefly for the move, then the switches above flip. Switch day builds nothing: every old-system and app change ships before it, switched off.
- Production's `next` schema holds no business records before the switch. On switch day, rebuild it from main's `schema/next.sql` before the final copy, then reapply the engine role grants and job registrations. Staging rehearsals always load a fresh schema.

Production's `next` schema, `engine` role and grants, and job registrations are set up. The app and program switches are off, so saves still go to the old system. Before routing saves to the new database, verify that the production writer can assume `engine` on the populated `next` schema.

Production releases preserve the eight Engine read switches in the production `vars` of `wrangler.jsonc`. The old API production release reads `ENGINE_ASSISTANT` from `mcp-server/wrangler.toml`.

The switch-day plan used this order:

1. Rebuild production `next` from main's `schema/next.sql`, then reapply the engine role grants and job registrations.
2. Pause mail intake and saving. Keep the pause until the copy and checks below pass; allow a two-hour window and extend it if needed.
3. Run the final copy in the order in [Running the copies](new-database.md#running-the-copies). Check the copy results and resolve outstanding corrections before proceeding.
4. Verify that the production writer can assume `engine` on the populated `next` schema.
5. Set `DEALS_READ_SCHEMA=next`, then turn `deals-from-engine` on. Check the Deals board and a deal page after each change.
6. Set `HOME_INBOX_READ_SCHEMA=next`, `LEADS_READ_SCHEMA=next`, `INVOICES_READ_SCHEMA=next`, `SEARCH_READ_SCHEMA=next`, `ACTIVITY_READ_SCHEMA=next`, and `RELATIONSHIPS_READ_SCHEMA=next`. Check each engine read after its change.
7. Set `DIRECTORY_READ_SCHEMA=next` and check the engine directory reads before enabling `clients-vendors-from-engine`. Turn on each remaining `ENGINE_ROUTING` read key in the order listed in [Switches](#switches). Check the corresponding screen after each key. For `leads-from-engine`, check corrected and unclaimed lead owners, an existing lead link and new correspondence in its drawer. For `clients-vendors-from-engine`, check both lists and open a copied record by its old link in each drawer. Turn on `home-from-engine` after `relationships-from-engine` and before the Studio switches. Check Home in the app. Open a person or company step from Home and confirm that Relationships opens its node. In rehearsal, check that an email from a new sender shows once as a possible lead, opens to the saved evidence and leaves after the mailbox partner decides it.
8. Build production `carr-share` from `src/index.js` in the private share-worker repository. This entry point uses the website access code rehearsed in staging and includes the production site routes. Upload a version with `keep_assets` to reuse the live encrypted assets. Bind `CLIENT_WEBSITE_ACCESS` to `doctorcre-engine#ClientWebsiteAccess`. Deploy with `CLIENT_WEBSITE_ENGINE_SLUG` unset and check that the password forms still appear and refuse a made-up wrong password. Then set the slug to the verified website name. Check that the form still appears for an anonymous visitor and that the website opens without a password from a signed-in deal page.
9. Turn off the nightly checklist reminder step in `carr-system/bin/nightly.sh`. Check that the nightly job no longer runs that step.
10. Turn on `deals-saves-from-engine` and check its route.
11. Turn on `engine_mail`, `engine_router`, `engine_outbox`, `engine_cadence`, and `engine_lead_stage` in that order. Check each program's engine route after its change.
12. Turn on `engine_calls` with `engine_credentials`. The production engine service token and `engine_credentials` must already be in place on the Studio. Check that call capture reaches the engine.
13. Set `ENGINE_ASSISTANT="true"`. Check an assistant save through the engine.
14. If a check fails before any new save lands, pause again and return that switch to its old setting. After new saves land, fix forward and do not route back. Routing back needs the owner's yes, after listing every save made since the switch, because switches do not copy saves back.
15. End the pause after all checks pass.

The coordinator deferred both moves on 2026-11-19 (#805). On switch day, turn off only the nightly deal checklist reminder step in `carr-system/bin/nightly.sh`. The old checklist freezes once saves move, so the job could remind a partner about an item they already finished. Deal watch settings and updates stay on the old tables, which only cover copied deals. [Deal watches and nightly checklist reminders](new-database.md#deal-watches-and-nightly-checklist-reminders).

## Going back

Turning a switch off sends requests back to the old side. It does not copy back what the new schema saved after the switch flipped, so those saves would be missing from the old side. Today only the Deals read pair has a written way back, before any new saves: § "Deals reads for the app".

## Open decisions

The owner's open questions live on one list, "What we need from you" on the roadmap in the private plans repo. A brief or pull request never answers one. It reports the question to the coordinator, who adds it there.

## Where to find it

| Topic                                                    | File § section                                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Words to use on screens and in code                      | `docs/glossary.md`                                                                                                                  |
| Partner sign-in, sessions, and page gates                | [Partner sign-in](sign-in.md)                                                                                                       |
| Lasting decisions, numbered                              | `docs/decisions.md`                                                                                                                 |
| Running the check, local database, comparing old and new | `README.md`                                                                                                                         |
| The new database's tables, one line each                 | `docs/new-database.md` § "Records"                                                                                                  |
| Users, jobs and save stamps                              | § "Users, jobs and who changed what"; § "Change history"                                                                            |
| Rules the database enforces                              | § "Rules the database enforces"; `schema/next.sql`                                                                                  |
| Who may change what                                      | § "Who may change what"                                                                                                             |
| People, companies, emails and phone numbers              | § "Emails and phone numbers"; § "Do not contact, NPIs and outside ids"; § "Merging duplicates"                                      |
| Clients, national accounts, leads                        | § "Clients, brands and national accounts"; § "Leads and clients"                                                                    |
| Deals, phases, parking                                   | § "Deals"; § "When a deal falls apart"                                                                                              |
| Markets and territories                                  | § "Markets and territories"                                                                                                         |
| Vendors and introductions                                | § "Vendors"; § "Who knows whom"                                                                                                     |
| Leases, critical dates, offers                           | § "Leases and options"; § "Critical dates"; § "Offer rounds"                                                                        |
| Buildings, suites, space needs                           | § "Space needs, suites and building owners"                                                                                         |
| Deal and client files                                    | § "Deal files and extracted text"; § "Client files"                                                                                 |
| Activity, emails, next steps                             | § "Activity, emails and next steps"; § "Worked example: an LOI response by email"                                                   |
| Suggestions and reply drafts                             | § "Suggestions from mail, calls and meetings"; § "Reply drafts"                                                                     |
| Home marks and preferences                               | § "Users' preferences and Home marks"; § "24. Home marks saved"                                                                     |
| Tours and marketing                                      | § "Tours as meetings"; § "Marketing"                                                                                                |
| Commissions and invoices                                 | § "Commissions"; § "Invoices found in email"                                                                                        |
| The copies: order, reruns and each copy's file           | § "Running the copies"                                                                                                              |
| The copy of the three features' records                  | § "Copying today's deals"; § "Copying today's activity"; § "Copying today's emails"; § "Copying today's deal and vendor next steps" |
| Which program reads and writes what                      | § "Who reads and writes the three features' records" and its tables                                                                 |
| Slice numbers                                            | § "Slices named above"                                                                                                              |
| Doors: shared rules                                      | § "What every door shares"                                                                                                          |
| Door 19, 20, 21, 22, 25, 16, 18                          | § "Doors the old system calls", the heading with that number                                                                        |
| What each old program can start on                       | § "What can start when this merges"                                                                                                 |
| Invoice capture, application and payment                 | § "Invoice email capture and list"; § "Invoice application"; § "Mark paid"                                                          |
| Deals reads, their switch and cutover needs              | § "Deals reads for the app"                                                                                                         |
| Deal page people and company search                      | § "People and company search for the deal page"                                                                                     |
| Owner decisions the doors raised                         | § "Owner decisions"                                                                                                                 |
| Home screen                                              | `docs/screens/home-inbox.md`                                                                                                        |
| Deals screen                                             | `docs/screens/deals.md`                                                                                                             |
| Calendar screen                                          | [Calendar](screens/calendar.md)                                                                                                     |
| Leads screen                                             | `docs/screens/leads.md`                                                                                                             |
| Invoices screen                                          | [Invoices](screens/invoices.md)                                                                                                     |
| Prospects lane and Monday review                         | `docs/screens/deals.md` § "Prospects" and § "Monday review"; § "Prospects and the Monday review"                                    |

Every `§` without a file is in `docs/new-database.md`.
