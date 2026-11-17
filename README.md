# doctorcre-engine

Engine for the DoctorCRE app. See `AGENTS.md` for how work happens here.

Run `npm ci` once, then `npm run check` before every push. CI runs the same command.

Database checks need a local, disposable PostgreSQL 18 server with `pgcrypto` and
`pg_trgm`. The test user needs permission to create databases and extensions.
When builders run checks concurrently, give each check its own server. Separate
databases on one server still share its connection limit (#322).

This block needs Docker. If `docker` is missing, the single shared-server check below still works.
Use an 8 GB Docker VM for concurrent checks, verified with five checks at once.
With Colima stopped, use
`colima start --cpu 6 --memory 8`. A 2 GB VM can OOM-kill PostgreSQL under this load.

With Docker running, paste this block from the worktree to run a check on its own
throwaway server. Docker chooses a free loopback port. The subshell stops only
its own container when the check exits, including on failure or interruption.

```sh
(
	set -eu
	postgres=$(docker run -d -p 127.0.0.1::5432 \
		-e POSTGRES_HOST_AUTH_METHOD=trust postgres:18 \
		-c max_locks_per_transaction=256)
	trap 'docker rm -f "$postgres" >/dev/null' EXIT
	trap 'exit 130' INT
	trap 'exit 143' TERM
	ready=false
	for attempt in $(seq 1 30); do
		if docker exec "$postgres" pg_isready -h 127.0.0.1 -U postgres >/dev/null; then
			ready=true
			break
		fi
		sleep 1
	done
	if [ "$ready" != true ]; then
		docker logs "$postgres"
		exit 1
	fi
	TEST_DATABASE_URL="postgres://postgres@$(docker port "$postgres" 5432/tcp)/postgres" npm run check
)
```

The readiness probe uses TCP because the image's initialization server accepts
only Unix sockets. PostgreSQL's default of 64 locks runs out at default test
parallelism on 18 cores; 256 also holds with every test file running at once (#420).
See Docker's [port publishing documentation](https://docs.docker.com/engine/network/port-publishing/).

For a single check on an existing local throwaway server, `TEST_DATABASE_URL`
defaults to `postgres://postgres@127.0.0.1:5432/postgres`.
The loader accepts only loopback hosts without URL query parameters, creates a
random database, and drops it in `finally`. Never point it at a server with
business data. A check opens roughly one connection per CPU core, plus sessions
for tests that exercise concurrent writes. More simultaneous checks need more
connections.

Each check restores `schema/business.sql` once, generates ignored `src/database.d.ts`
with `kysely-codegen`, and runs TypeScript and tests against that database.
A test that needs its own database copies that restore, because one restore
holds about 2,100 locks and many at once exhaust the server's lock table (#237).
Use `Kysely<DB>` with the generated `DB` for business queries. Raw SQL bypasses
query typing and is reserved here for catalog inspection, trigger controls and
test rows in `ops` tables, which the generated types leave out.
The snapshot contains 123 empty tables, 60 views, 7 sequences and 33 triggers.
Its reviewed literals use fictional partners, tenants and domains. SQL comments
and psql transport directives are removed, except comments inside function
bodies, which production stores and the drift command compares. Of the old process schema it keeps
only the four tables behind the client portal link and the document checklist,
the deal deliverables, page text and extraction jobs the deal-file copies read,
the Home marks and notification settings the preferences copy reads, and the
meetings and notes the meetings copy reads, without their triggers or a job's link to its fact batch. The rest of that schema, its triggers on public tables and two
dependent public views are excluded.

To compare a catalog outside CI, set `SCHEMA_DATABASE_URL` in the environment and
run `npm run schema:drift`. It also needs the local throwaway server above.
The target connection starts read-only, uses a read-only transaction, and queries
only PostgreSQL catalogs. It prints differing or missing object names, never
values or definitions. Exit codes are 0 for a match, 1 for drift and 2 for failure.
It compares public and ops columns, defaults, constraints, indexes, public-function
triggers, policies, views, sequences and functions belonging to the snapshot.
Unrelated extra relations and functions are outside this selected snapshot.
Definitions are compared exactly. A quoted SQL string literal is ignored only where
the snapshot holds one of the made-up values in `schema/made-up-literals.json` that
replaced a real one, so privacy scrubbing does not report drift and any other
changed value does. A value newly scrubbed in a later snapshot update must be added
to that file, or the command reports it. This command does not update the snapshot
or apply any schema change to its target.

To compare the old system's and the engine's Deals answers outside CI, set
`COMPARE_TARGET` to `staging` or `production`, `COMPARE_PARTNER` to `joe` or
`dell` and `COMPARE_ENGINE_URL` to the engine's https base URL, then run
`npm run compare`. Both systems are read as that partner through the engine's
`/compare/<partner>/` door, which Cloudflare Access opens only to the
comparison's service token. The script reads that token from the macOS login
keychain, service `doctorcre-compare-access`, accounts
`<target>-client-id` and `<target>-client-secret`. Production also needs
`COMPARE_CONFIRM_PRODUCTION=read-only`. It only reads and waits 1.5 seconds
between requests. It asks the engine before and after the old system and sets a
request aside as unsettled when the engine's two answers differ. Boards are asked
by workspace only, not by national account. Clients and vendors are asked as
the app asks them: the first page of each list, every record on it, and recent
activity for the first five records of each read with a name and ref. Vendor
markets and the Relationships map are asked once. Today's reminders are asked
with no input and for the partners, each following its next page up to five
pages, and meeting prep once for the signed-in partner. Suggested vendor
meetings are asked in their suggested and research views, each following its
next page up to five pages. The old system answers the lists, records and map
at its `/api/v1/business` paths. Their `observed_at`,
`valid_until` and `correlation_id` may differ in value, not in format. Keys in
another order are a `key order` difference at the first moved key. A field
compared whole, such as a card's facts, reports it at its own path. Order is
read from the parsed answers, where JavaScript puts whole-number keys first, so
their order is not checked. A refused deal, client or vendor is compared as its
refusal; a refused board, invoices read, list, reminders read, meeting prep or
vendor meetings read counts as failed, and so does an unavailable calendar. A
network failure or a refused token stops the run. It prints counts, field paths and
record IDs, never values, bodies or the token. A suggested vendor meeting
prints its vendor ref and, when it has one, its contact ID. Exit codes are 0
for a match, 1 for differences or unsettled requests and 2 for failure.
