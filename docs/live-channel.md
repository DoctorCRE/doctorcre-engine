# Live channel

A partner's screen changes the moment the other partner's save lands, and Doc's Mac starts on a question the moment it is asked. Today the app re-reads each open page once a minute, each Mac asks the engine for Doc work every 2 seconds, a cron checks for waiting Doc work every minute, and Ask Doc re-reads a waiting answer every 5 to 120 seconds. The live channel replaces those reads with one pushed notice per change. This page is the design. None of it is built yet. Decision 222 records the choice.

## What it replaces

| Today                                                                                                         | With the live channel                                            |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Home tiles and about 18 pages re-read every 60 s while visible (`refetchInterval`, `mountAutoRefresh`)        | The page reads once, then re-reads only the views a notice names |
| The Deals board's change feed, off on the engine path, so a partner's edit waits for the page to regain focus | Deal notices refresh the board and the open deal                 |
| Ask Doc re-reads a waiting turn every 5 s, then 30 s or 120 s                                                 | `doc_turn` notices on each turn change, progress included        |
| Call mode asks for its report every 1.6 s; phone transfer asks every 30 to 120 s                              | The saved report or transfer state sends a notice                |
| The Mac's Doc link asks `POST /api/engine/doc/link/claim` every 2 s, all day                                  | The Mac holds one socket and claims when told                    |
| A Cron Trigger every minute looks for Doc work queued two minutes ago                                         | A timer per waiting item fires once, at its due time             |

The page clocks go only where every writer of the page's records sends notices. See [Until every writer notifies](#until-every-writer-notifies).

## One Durable Object

The engine Worker gains one Durable Object class, `LiveChannel`, and uses one instance of it, named `partners`. Every app tab, every Doc link and every Studio program that waits on the engine connects to it over a WebSocket accepted with the [Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/). While no notice is moving, the object is out of memory and costs nothing, and the sockets stay open. Duration is not billed while an object can hibernate, and outgoing messages are free ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)).

One instance, not one per partner. The two partners see the same business records (decision 210), so most notices go to every tab. One instance gives every notice one order and one sequence number. Notices for one partner or one program reach only their sockets through socket tags: each socket carries up to 10 tags and `getWebSockets(tag)` returns the sockets with one ([state API](https://developers.cloudflare.com/durable-objects/api/state/)). The limit of 32,768 sockets per object is far above two partners' tabs and Macs.

| Socket         | Door                            | Tags                                              | Attachment              |
| -------------- | ------------------------------- | ------------------------------------------------- | ----------------------- |
| App tab        | `GET /api/engine/live`          | `tab`, `user:<user id>`, `session:<session hash>` | user id, session expiry |
| Doc link       | `GET /api/engine/doc/link/live` | `mac`, `user:<user id>`, `link:<credential id>`   | user id, readiness      |
| Studio program | `GET /jobs/live`                | `job`, `job:<job slug>`                           | job slug                |

The object never reads the database and never calls another service. Its storage holds recent notices and its due-time table. When something must happen in the database or outside the engine, the object calls back into the engine Worker through one door, `LiveDoor`, a named [RPC entrypoint](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/) of the engine Worker reached by a service binding to itself. A named entrypoint has no public URL, so only the object can call it. The class gets its SQLite storage and the `LIVE_DOOR` binding and nothing else; its code is typed against an environment with only that binding. Because the database work runs in the Worker, the Worker's placement (decision 207) covers it, and the object needs no placement of its own.

`LiveDoor` has three methods:

- `due(items)` runs what the due-time table says is due: the backup dispatcher for a partner, a retaken claim, the credit retry. The Worker reads the database and calls Claude as it does today.
- `dealWatch(ids)` passes changed deal ids to the old system's watch settings (unit U11).
- `macGone(userId)` runs the backup dispatcher for that partner at once when the Mac's socket closes or turns unready while work waits.

## What a notice carries

A notice is `{ seq, topic, id, version }`. `topic` is a record kind or one of the event topics below. `id` is the record's key. `version` is the id of the latest `change` row behind it, so a tab that already read that version skips the re-read. A notice never carries record text, names or values; a tab or program re-reads through its usual door, which applies every read rule as today.

The engine keeps one table, `src/live/topics.ts`, mapping each stamped table to its topic and audience. A test fails when a stamped table in `schema/next.sql` is missing from it, so a new table cannot go silent.

| Topic                                                                                                                                     | Source                                                        | Goes to                    |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------- |
| Record topics: `deal`, `lead`, `party`, `activity`, `next_step`, `email`, `meeting`, `critical_date`, `invoice` and the rest of the table | `change` rows of shared records                               | `tab` (both partners)      |
| `home_mark`, `user_preference`                                                                                                            | `change` rows of rows keyed to one partner                    | `user:<that partner>` tabs |
| `doc_turn`                                                                                                                                | Doc queue code, at each turn state change                     | `user:<turn owner>` tabs   |
| `doc_work`                                                                                                                                | Doc queue code, when a turn or judgment job is ready to claim | `user:<owner>` Mac         |
| `partner_ping`                                                                                                                            | A save that creates work for the other partner (row C1)       | `user:<that partner>` Mac  |
| `reply_delivery`                                                                                                                          | `change` rows of an approved `reply_draft`                    | `job:outlook-outbox`       |
| `meeting_record`                                                                                                                          | `change` rows of a stored meeting recording                   | `job:capture`              |
| `day`                                                                                                                                     | The due-time table, at midnight Central                       | `tab` (both partners)      |

A record notice may go to more than one audience: an approved reply is both a `reply_draft` record notice to the tabs and a `reply_delivery` notice to the outbox.

The object sends at most one notice per topic and id each second, so Ask Doc's once-a-second progress does not flood a tab. The first notice in a second goes out at once. Later ones in that second are held, and the object puts a flush time in its due-time table for the end of the second, so the last notice is always delivered, even if the object is evicted in between.

## Where notices come from

Record notices come from change history, not from each save door. Every stamped row's insert, update and delete already writes a `change` row ([Change history](new-database.md#change-history)), and every save to the new database runs inside `nextTransaction` in `save` mode, except the Friday post intake (`src/post-intake.ts`), which opens its own connection and is moved onto it first. No door has to remember to announce itself, and a door added later announces itself too.

Each `change` row gains a column, `saved_in xid8`, set by `record_change()` to `pg_current_xact_id()`. That function returns the top-level transaction id even inside a savepoint, so rows written inside a savepoint carry the same value as the rest of the transaction. Matching a row's `xmin` instead would miss them, because a row written inside a savepoint carries the subtransaction's id, and the engine uses savepoints (`src/open-step.ts`). Rows of a savepoint that was rolled back are gone and send nothing. The column is added without a default, so the existing history is not rewritten, and old rows stay empty.

`nextTransaction` reads the largest `change` id when the transaction opens. Just before commit, it reads the rows above that id whose `saved_in` is the current transaction, and maps their tables and keys to notices. The opening read stays because it bounds the closing read to the primary key's newest rows; without it the closing read would need a new index on `saved_in` that every save pays to maintain. A row with a smaller id than the opening read cannot belong to this transaction, because its id was handed out before the transaction wrote anything.

After commit, the save sends the notices to the object before it answers. A failed send is retried twice within the request, then logged as `live_publish_failed`; the save itself stands. If the object is unreachable, the tabs' sockets to it break too, and each tab reconnects and re-reads. The only notice that can be lost for good is one whose Worker stopped between commit and send. That tab catches up when it next becomes visible or reconnects.

Doc tables keep no change history, because conversations are private. The Doc queue code sends `doc_turn` and `doc_work` itself, at the same points it changes a turn's or job's state.

Saves that skip the engine send no notice. That covers every save the old system makes to its own tables, every engine save routed into the old tables before the switch (those tables keep no `change` rows), and a repair applied by hand on the database, which is seen at the next reconnect or `day`.

## Until every writer notifies

The old system still saves to the same database, and its saves send no notice. A page that dropped its clock today would go stale whenever the old system saved one of its records. So each page keeps its minute clock until every writer of the records it shows saves through the new database, and it gains notice refreshes in the meantime. The clock is deleted page by page, in unit U18, when the page's gate opens.

| Page or view                                                                                           | Records it shows                                      | Writers outside the engine today                 | Clock removed when                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Home tiles                                                                                             | next steps, mail, suggestions, meetings, deals, leads | Old API saves, Studio mail intake and automation | The switch moves every save to the new database                                                            |
| Deals board, pipeline, deal page                                                                       | deals, phases, next steps, critical dates             | Old API deal saves and automatic phase moves     | The switch                                                                                                 |
| Calendar                                                                                               | next steps, meetings, tours, critical dates           | Old API saves, Studio calendar intake            | The switch                                                                                                 |
| Leads, Vendors, Clients, search, relationship network, contact reasons                                 | parties, leads, introductions                         | Old API directory saves, Studio automation       | The switch                                                                                                 |
| Conversations, notifications, status, charts, command-center and business workspaces, shell and layout | old tables only                                       | The old system                                   | The page reads the new database and the switch is done; until then it keeps its clock and gains nothing    |
| Invoice tracker                                                                                        | invoices, commission payments                         | Old API invoice saves                            | The switch                                                                                                 |
| Ask Doc                                                                                                | Doc turns                                             | None: only the engine writes Doc tables          | Unit U16, as soon as U5 is live                                                                            |
| Call mode report, phone transfer                                                                       | call reports, transfer state                          | Unit U17 confirms first                          | U17, when both saves go through the engine; otherwise the transfer's upload answer carries the final state |

The switch is the day the app and program switches send every save to the new database ([the switch plan](system.md#the-switch-plan)). A page whose writers move earlier through their own switches may lose its clock earlier; U18 checks each page's writers before removing its clock.

## Missed notices

The object numbers notices with `seq` and keeps the last 24 hours, up to 2,000, in its storage, under an `epoch` it chose when its storage was first written. A tab reconnects with `after=<epoch>:<seq>`. The object then sends the newer notices, one per topic and id, or `reset` when the epoch differs or the cursor is older than what it kept. On `reset` the tab re-reads every view it shows, once.

The cursor is the object's `seq`, not a `change` id. Identity values are handed out when a row is written, not when its transaction commits, so a later id can commit first and a cursor on ids could skip a change. Reading change history on every reconnect would also wake the database. `version` still names the change, for de-duplication.

## Limits kept from the app's polling ban

The app banned `EventSource` and `WebSocket` on 2026-10-31 and 2026-11-01 (app #565 and #581) so that tabs nobody watches stop reading. These rules keep that promise.

- Each tab opens at most one socket, through one shared app module. No other app code may open a socket.
- A tab closes its socket when it is hidden or after 30 minutes without input. When it is shown or used again, it reconnects with its cursor and re-reads only what it missed.
- A tab's first connection, and any `reset`, reads each shown view once. Nothing else reads on a clock, except the page clocks kept [until every writer notifies](#until-every-writer-notifies).
- Reconnects wait 1, 2, 4 and up to 60 seconds, with jitter, and stop after 8 failures. When the tab gives up, it re-reads each shown view once and shows "Not live" in the top bar, with the hint "Changes show when you come back to this tab or reload". The next focus, visibility change or return online clears the mark and starts reconnecting again.
- A tab sends `ping` every 30 seconds while open. `setWebSocketAutoResponse` answers it without waking the object, and those replies are not billed as duration.
- No notice reads the database by itself, and idle sockets make no requests to it. Opening a socket checks the session once. With no partner active, the database sleeps.

## Who may connect

A tab connects to `GET /api/engine/live` with an upgrade, through the app Worker's `ENGINE` binding like every engine call. The engine applies the usual partner session check and also requires `Origin` to be `PARTNER_APP_ORIGIN`, because a browser sends a WebSocket request cross-site without a preflight. The object closes a tab's socket when its session expires. Sign-out closes the sockets tagged with that session.

A Doc link connects to `GET /api/engine/doc/link/live` with `Authorization: Bearer <credential>` and no cookies, under the same rules as a claim. Revoking or replacing the credential closes the sockets tagged with it.

A Studio program connects to `GET /jobs/live` behind the `/jobs` Cloudflare Access audience, with the same service token as its job calls. The engine tags the socket with the job slug the token is registered for.

## The Doc link

The Mac keeps its socket open all day, sends a WebSocket ping every 30 seconds, and reconnects after 1, 2, 4 and up to 60 seconds, without a cap, because it has no one to wake it. On connect and on each `doc_work`, it claims over HTTPS as today until the claim answers `204`. The claim, lease, 10-second heartbeat, progress and result requests are unchanged.

The Mac sends its readiness (`ready`, `signed_out` or `plan_limited`) as a socket message when it changes. The object keeps it in the socket's attachment.

The move from polling to the socket happens in this order, so a Mac is never shown as off while it still polls:

1. Unit U6 adds the socket door. `GET /api/engine/doc/link` counts a Mac as present when its socket is open or its last claim is recent, as today.
2. Unit U7 adds the timers and `LiveDoor`. The minute cron stays, and the dispatcher does not yet run on a socket close.
3. Unit U8 moves the Doc link onto the socket. It is installed on every Mac that holds a Doc link credential.
4. Unit U9, once U8 runs on every such Mac, makes the socket the only presence, removes the poll-time presence write, runs the dispatcher on socket close or unready readiness through `LiveDoor.macGone`, and removes the cron.

## Timers instead of the minute cron

When a turn is queued or requeued, or a mail judgment job is created, the engine asks the object for a timer at the time the backup may take it (decision 204), before the transaction commits. A failed timer request fails the save, so no work commits without a timer. A timer for work that rolled back finds nothing and stops. The object stores due times and keeps its one alarm at the earliest ([alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)). When it fires, it calls `LiveDoor.due` with what is due and the Worker runs the backup dispatcher for that partner. The handler catches its own errors and sets the next alarm itself, because the platform retries a failing alarm only six times.

- A claim sets a timer at its `claim_until`, so a Mac that stops mid-turn has its work taken back on time.
- When the Mac's socket closes or its readiness turns unready while work waits, the object calls `LiveDoor.macGone` at once (from unit U9).
- While prepaid credits are exhausted and work waits, the dispatcher tries one request a minute, as decision 204 allows today. It stops when no work waits.
- The once-a-second flush and the `day` notice share the same table.
- The `* * * * *` Cron Trigger is removed in unit U9.

## What stays scheduled

Only work whose cause is the clock keeps a clock: the `day` notice at midnight Central, claim expiry, the backup's grace period, the credit retry above, nightly and weekly jobs, the page clocks kept until every writer notifies, and the old system's `launchd` jobs that have no event to wait on. The build units name each one.

## Testing

Tests stay hermetic.

- The object's logic is plain functions in `src/live/`: routing by tag, the once-a-second merge and its flush, `seq`, `epoch`, replay and `reset`, and the due-time table that picks the next alarm. Tests give them fake sockets and a fake clock. The class itself only adapts them to the runtime, and `npm run build` checks its binding and migration.
- `LiveDoor` is tested by calling its methods with a fake dispatcher.
- A database test saves a deal and checks the notices listed. It also writes a row inside a released savepoint and checks its notice is listed, writes one inside a rolled-back savepoint and checks it is not, and checks that another transaction's rows are left out.
- The topic table test fails on a stamped table with no topic.
- The Doc link's reconnect schedule and claim-on-notice are tested with a fake socket and a fake clock.
- The app's live module is tested with a fake socket, a fake page visibility and a fake clock, including the "Not live" state and the one re-read when it gives up.

## Build units

The units, in order, with their checks, live in the private plans repo under `wip/live-channel-2026-11-26/units.md`. Each is one pull request. Units are numbered U1 to U19 so their names never match the audit's rows.
