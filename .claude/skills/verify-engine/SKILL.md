---
name: verify-engine
description: Verify a DoctorCRE engine change offline with the engine's existing check and tests, keep the evidence, and report what was not proved.
---

# Verify the DoctorCRE engine

Run from the root of an isolated checkout at the head under test. Use only the commands below and the repo's existing tests. Do not add a launcher, harness, script or throwaway test.

## Launch

Use the Node version in `.node-version` and `psql`. Install the locked dependencies:

```sh
npm ci
```

Database tests need a local, disposable PostgreSQL 18 server with `pgcrypto` and `pg_trgm`. With the `postgres:18` image already pulled, use the README's Docker block: it starts a server with `max_locks_per_transaction=256` (#420), runs the check against it, and removes it on exit. Otherwise use a server already on loopback and set `TEST_DATABASE_URL` to it. The loader accepts only a loopback host, makes a random database and drops it afterwards. Never point it at a server holding business data, and never use a Neon or production URL.

## Doctor

The server must answer, not just listen:

```sh
psql -X -Atq "$TEST_DATABASE_URL" -c "select 1"
```

If no server can start (no Docker image cached and no network), say so and report every database test as not run.

## Drive

Read the pull request's diff and the issue it closes. Then:

1. For a change to an HTTP door or pure code, run its test file first, by name:

   ```sh
   node --test src/<changed>.test.ts
   ```

   Door tests drive `src/worker.ts`'s default export with a made-up `env`, as `src/compare-door.test.ts` does. Database and copy tests need the snapshots that only `npm run check` sets up; run alone, they stop or rebuild the schema slowly, which is not a failure of the change. Step 2 is their evidence.
2. Run the full check, which CI runs and nothing else:

   ```sh
   npm run check
   ```

3. For a migration under `schema/`, confirm a test applies it to a database built the way production was and checks the result. Applying it twice must succeed when the file says it is safe to.

For each acceptance criterion in the issue, name the test and assertion that prove it. A passing test that does not touch the changed path is not coverage.

## Not provable here

The verifier has no network. Report these as unverified, never as passed: the deployed Worker, staging or production databases, Hyperdrive, Cloudflare Access, Outlook or Google calls, the app's screens, and timing against the real database. The coordinator checks those where they run.

## Evidence

Keep each command, its exit status, and the failing assertions verbatim. Report skipped tests and missing preconditions explicitly. Evidence uses made-up data only; this repo is public.

## Cleanup

Stop and remove only a PostgreSQL server you started, with its data volume. Leave any other listener alone.
