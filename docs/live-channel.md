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

## One Durable Object

The engine Worker gains one Durable Object class, `LiveChannel`, and uses one instance of it, named `partners`. Every app tab and every Doc link connects to it over a WebSocket accepted with the [Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/). While no notice is moving, the object is out of memory and costs nothing, and the sockets stay open. Duration is not billed while an object can hibernate, and outgoing messages are free ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)).

One instance, not one per partner. The two partners see the same business records (decision 210), so most notices go to every tab. One instance gives every notice one order and one sequence number. Private notices reach only their partner through socket tags: each socket carries up to 10 tags and `getWebSockets(tag)` returns the sockets with one ([state API](https://developers.cloudflare.com/durable-objects/api/state/)). The limit of 32,768 sockets per object is far above two partners' tabs and Macs.

| Socket   | Tags                                              | Attachment              |
| -------- | ------------------------------------------------- | ----------------------- |
| App tab  | `tab`, `user:<user id>`, `session:<session hash>` | user id, session expiry |
| Doc link | `mac`, `user:<user id>`, `link:<credential id>`   | user id, readiness      |

The Durable Object never reads the database. It keeps its own small store in its SQLite storage: recent notices and the timers below.

## What a notice carries

A notice is `{ seq, topic, id, version }`. `topic` is a record kind from one table in the engine, such as `deal`, `lead`, `party`, `activity`, `next_step`, `email`, `meeting`, `critical_date` or `home_mark`. `id` is the record's key. `version` is the id of the latest `change` row behind it, so a tab that already read that version skips the re-read. A notice never carries record text, names or values; a tab re-reads through the usual signed-in doors, which apply every read rule as today.

Three topics are not records:

- `doc_turn`, sent only to the turn owner's tabs, when a turn is queued, claimed, progresses, is answered, fails or is cancelled.
- `doc_work`, sent only to the owner's Mac, when a turn or a mail judgment job is ready to claim.
- `day`, sent to every tab at midnight Central, so views that depend on today's date re-read.

The app maps each topic to the query keys it invalidates. The Durable Object sends at most one notice per topic and id each second, so Ask Doc's once-a-second progress does not flood a tab.

## Where notices come from

Record notices come from change history, not from each save door. Every stamped row's insert, update and delete already writes a `change` row ([Change history](new-database.md#change-history)), and every save to the new database runs inside `nextTransaction` in `save` mode, except the Friday post intake (`src/post-intake.ts`), which opens its own connection and is moved onto it first. That one function reads the largest `change` id when the transaction opens. Just before commit, it reads the rows above it written by its own transaction (`xmin` equal to the current transaction id) and maps their tables and keys to notices. No door has to remember to announce itself, and a door added later announces itself too.

After commit, the save sends the notices to the Durable Object before it answers. A failed send is retried twice within the request, then logged as `live_publish_failed`; the save itself stands. If the Durable Object is unreachable, the tabs' sockets to it break too, and each tab reconnects and re-reads. The only notice that can be lost for good is one whose Worker stopped between commit and send. That tab catches up when it next becomes visible or reconnects.

Doc tables keep no change history, because conversations are private. The Doc queue code sends `doc_turn` and `doc_work` itself, at the same points it changes a turn's or job's state.

Saves that skip the engine send no notice. After the switch, every app save, Studio program and assistant saves through the engine. A repair applied by hand on the database is seen at the next reconnect or day.

## Missed notices

The Durable Object numbers notices with `seq` and keeps the last 24 hours, up to 2,000, in its storage, under an `epoch` it chose when its storage was first written. A tab reconnects with `after=<epoch>:<seq>`. The Durable Object then sends the newer notices, one per topic and id, or `reset` when the epoch differs or the cursor is older than what it kept. On `reset` the tab re-reads every view it shows, once.

The cursor is the Durable Object's `seq`, not a `change` id. Identity values are handed out when a row is written, not when its transaction commits, so a later id can commit first and a cursor on ids could skip a change. Reading change history on every reconnect would also wake the database. `version` still names the change, for de-duplication.

## Limits kept from the app's polling ban

The app banned `EventSource` and `WebSocket` on 2026-10-31 and 2026-11-01 (app #565 and #581) so that tabs nobody watches stop reading. These rules keep that promise.

- Each tab opens at most one socket, through one shared app module. No other app code may open a socket.
- A tab closes its socket when it is hidden or after 30 minutes without input. When it is shown or used again, it reconnects with its cursor and re-reads only what it missed.
- A tab's first connection, and any `reset`, reads each shown view once. Nothing else reads on a clock.
- Reconnects wait 1, 2, 4 and up to 60 seconds, with jitter, and stop after 8 failures. The next focus, visibility change or return online starts again.
- A tab sends `ping` every 30 seconds while open. `setWebSocketAutoResponse` answers it without waking the Durable Object, and those replies are not billed as duration.
- No notice reads the database by itself, and idle sockets make no requests to it. Opening a socket checks the session once. With no partner active, the database sleeps.

## Who may connect

A tab connects to `GET /api/engine/live` with an upgrade, through the app Worker's `ENGINE` binding like every engine call. The engine applies the usual partner session check and also requires `Origin` to be `PARTNER_APP_ORIGIN`, because a browser sends a WebSocket request cross-site without a preflight. The Durable Object closes a tab's socket when its session expires. Sign-out closes the sockets tagged with that session.

A Doc link connects to `GET /api/engine/doc/link/live` with `Authorization: Bearer <credential>` and no cookies, under the same rules as a claim. Revoking or replacing the credential closes the sockets tagged with it.

## The Doc link

The Mac keeps its socket open all day, sends a WebSocket ping every 30 seconds, and reconnects after 1, 2, 4 and up to 60 seconds, without a cap, because it has no one to wake it. On connect and on each `doc_work`, it claims over HTTPS as today until the claim answers `204`. The claim, lease, 10-second heartbeat, progress and result requests are unchanged.

The Mac sends its readiness (`ready`, `signed_out` or `plan_limited`) as a socket message when it changes. The Durable Object keeps it in the socket's attachment. `GET /api/engine/doc/link` asks the Durable Object for the Mac's state, so presence is the open socket, and the poll-time presence write to the database goes away.

## Timers instead of the minute cron

When a turn is queued or requeued, or a mail judgment job is created, the engine asks the Durable Object for a timer at the time the backup may take it (decision 204), before the transaction commits. A failed timer request fails the save, so no work commits without a timer. A timer for work that rolled back finds nothing and stops. The Durable Object stores due times and keeps its one alarm at the earliest ([alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)). When it fires, it runs the backup dispatcher for that partner. The handler catches its own errors and sets the next alarm itself, because the platform retries a failing alarm only six times.

- A claim sets a timer at its `claim_until`, so a Mac that stops mid-turn has its work taken back on time.
- When the Mac's socket closes or its readiness turns unready while work waits, the dispatcher runs at once.
- While prepaid credits are exhausted and work waits, the dispatcher tries one request a minute, as decision 204 allows today. It stops when no work waits.
- The `* * * * *` Cron Trigger is removed.

## What stays scheduled

Only work whose cause is the clock keeps a clock: the `day` notice at midnight Central, claim expiry, the backup's grace period, the credit retry above, nightly and weekly jobs, and the old system's `launchd` jobs that have no event to wait on. The build units name each one.

## Testing

Tests stay hermetic.

- The Durable Object's logic is plain functions in `src/live/`: routing by tag, the once-a-second merge, `seq`, `epoch`, replay and `reset`, and the due-time table that picks the next alarm. Tests give them fake sockets and a fake clock. The class itself only adapts them to the runtime, and `npm run build` checks its binding and migration.
- A database test saves a deal and checks the notices listed, and checks that another transaction's rows are left out.
- The Doc link's reconnect schedule and claim-on-notice are tested with a fake socket and a fake clock.
- The app's live module is tested with a fake socket and a fake page visibility.

## Build units

The units, in order, with their checks, live in the private plans repo under `wip/live-channel-2026-11-26/units.md`. Each is one pull request.
