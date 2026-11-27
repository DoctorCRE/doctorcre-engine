---
name: verify-engine
description: Verify a DoctorCRE engine change offline with the engine's existing check and tests, keep the evidence, and report what was not proved.
---

# Verify the DoctorCRE engine

Run from the root of an isolated checkout at the head under test. Use only the commands below and the repo's existing tests. Do not add a launcher, harness, script or throwaway test.

## Launch

In Foreman's attempt container, the image and setup in `.foreman/contract.yaml` have already run. PostgreSQL 18 answers at the default `TEST_DATABASE_URL` (`postgres://postgres@127.0.0.1:5432/postgres`, trust auth, `max_locks_per_transaction=256` for #420). The locked dependencies are installed. The `engine_verify` database holds the engine schema and the partner sign-in tables. The network is gone once setup ends.

Elsewhere, use the Node version in `.node-version` and `psql`, and run `npm ci`. Database tests need a local, disposable PostgreSQL 18 server with `pgcrypto` and `pg_trgm`. With the `postgres:18` image already pulled, use the README's Docker block: it starts a server with `max_locks_per_transaction=256`, runs the check against it, and removes it on exit. Otherwise use a server already on loopback and set `TEST_DATABASE_URL` to it. The loader accepts only a loopback host, makes a random database and drops it afterwards. Never point it at a server holding business data, and never use a Neon or production URL.

## Doctor

The server must answer, not just listen:

```sh
psql -X -Atq "${TEST_DATABASE_URL:-postgres://postgres@127.0.0.1:5432/postgres}" -c "select 1"
```

If no server can start (no Docker image cached and no network), say so and report every database test as not run.

## Start

Run the contract's `start.command` in its own terminal. It serves the Worker with `wrangler dev` over local HTTPS at `https://127.0.0.1:8787`, with Wrangler's self-signed certificate, and binds the three Hyperdrive databases to `engine_verify`. It needs `PARTNER_AUTH_SECRET` in the environment, a value generated for this run and never production's. The engine is up when the contract's health command exits 0:

```sh
curl -fsSk https://127.0.0.1:8787/health
```

The CARR service bindings and R2 are local stand-ins. Scheduled jobs do not fire on their own.

## Sign in

The partner doors sit behind the app's `PartnerApp` binding, so a signed-in session is checked with the engine's own session code. This one-off adds a made-up partner to `engine_verify` and signs a session with `PARTNER_AUTH_SECRET` the way the app's cookie is signed. It writes the `Cookie` header to the owner-only file `out/verify-session.txt` and prints only who it signed in. Run it once per database:

```sh
mkdir -p out && node --input-type=module -e '
import { createHmac } from "node:crypto";
import { writeFile } from "node:fs/promises";
import pg from "pg";
import { withPartnerAuth } from "./src/partner-auth.ts";
const config = { connectionString: "postgres://postgres@127.0.0.1:5432/engine_verify",
	appOrigin: "https://127.0.0.1:8787", secret: process.env.PARTNER_AUTH_SECRET };
const partner = "00000000-0000-4000-8000-000000000001";
const db = new pg.Client({ connectionString: config.connectionString });
await db.connect();
await db.query(`begin;
	set local search_path = next, public;
	set local engine.user_id = $$${partner}$$;
	insert into party (id, kind, name) values ($$${partner}$$, $$person$$, $$Example Partner$$);
	insert into app_user (id, slug) values ($$${partner}$$, $$joe$$);
	insert into doctorcre_auth."user" (id, partner_user_id, name, email, "emailVerified", "createdAt", "updatedAt")
		values ($$verify$$, $$${partner}$$, $$Example Partner$$, $$verify@example.test$$, true, now(), now());
	insert into doctorcre_auth.account (id, "userId", "providerId", "accountId", "createdAt", "updatedAt")
		values ($$verify$$, $$verify$$, $$google$$, $$verify$$, now(), now());
	commit`);
await db.end();
const { token } = await withPartnerAuth(config, async ({ auth }) =>
	(await auth.$context).internalAdapter.createSession("verify"));
const signature = createHmac("sha256", config.secret).update(token).digest("base64");
const cookie = `__Host-doctorcre_session=${encodeURIComponent(`${token}.${signature}`)}`;
await writeFile("out/verify-session.txt", `Cookie: ${cookie}\n`, { mode: 0o600 });
const session = await withPartnerAuth(config, ({ resolveSession }) =>
	resolveSession({ origin: config.appOrigin, headers: new Headers({ cookie }) }));
console.log("signed in as", session?.actor);
'
```

It prints `signed in as { slug: 'joe', display: 'Example Partner' }`. Anything else is a failed sign-in. A change to a partner door is proved by its test, which drives `partnerApp` with a made-up `env` as `src/activity/deal-attribution.test.ts` does.

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

The verifier has no network after setup. Report these as unverified, never as passed: the deployed Worker, staging or production databases, Hyperdrive, Cloudflare Access, Outlook or Google calls, the app's screens, and timing against the real database. The coordinator checks those where they run.

## Evidence

Keep each command, its exit status, and the failing assertions verbatim. Report skipped tests and missing preconditions explicitly. Evidence uses made-up data only; this repo is public.

Captures are not redacted, so no capture, log excerpt or screenshot may show a secret. Never print or capture `PARTNER_AUTH_SECRET`, the environment, `out/verify-session.txt`, a `Cookie` or `Set-Cookie` header, or a session token. Keep status codes and response bodies only.

## Cleanup

Stop the start command with Ctrl-C in its terminal. Stop and remove only a PostgreSQL server you started, with its data volume. Leave any other listener alone.
