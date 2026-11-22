# Partner sign-in

The two partners sign in with Google on the app's own address. The engine issues and checks the session for pages and partner API calls. The app keeps its existing sign-in links, return paths, and sign-out control. This design replaces [decision 6](decisions.md) at cutover.

## What the partners use today

CARR uses Google alone for browser sign-in, asks the user to select an account, and admits the two configured partner accounts with verified email. It issues a persistent host-only cookie and stores the session in Workers KV. Both its idle and absolute limits are 30 days. The cookie can be reissued in the last hour, but the original 30-day limit still applies. A fresh browser profile or a separate installed app storage context needs its own sign-in. A browser restart with the cookie intact keeps the session.

Sign-in starts a 10-minute freshness window. Reauthentication repeats Google's account chooser and marks the same live session fresh only if the same partner returns. CARR uses this for System Work approvals, which also require a separate single-use action challenge. Sign out checks the session's CSRF token, revokes its push registrations, and ends that browser session.

Source snapshots are CARR `5ec6edcf95f2f848481456f390120bde0eb454b8` (`mcp-server/src/dealroom-web.js`, `google-oidc.js`, `identity.js`) and the app `5d0a2ca5edcfde9c62d200e2672374e14ede219d` (`src/worker.js`, `js/app-shell.js`, `src/ui/worker/service-worker.ts`). The engine already gets the browser partner from the CARR session. `Engine-For-User` is used by the jobs door after Access authentication.

## Choose the sign-in service

- Cloudflare Access has its own global and app session clocks. Access logout revokes the user's sessions across Access applications. The app needs its own browser-session revocation and same-session reauthentication. [Cloudflare Access session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
- Neon Managed Better Auth supports Google and Postgres sessions. Its managed server has no app-owned callback hooks for binding reauthentication to the existing DoctorCRE session. [About Managed Better Auth](https://neon.com/docs/auth/about)
- Run **Better Auth in the engine Worker** using its Google provider and PostgreSQL session store. Its server hooks let the engine check the two provisioned identities and bind Google's return to the current session. Use a patched stable release and its documented Hono integration. [Hono integration](https://better-auth.com/docs/integrations/hono), [OAuth hooks](https://better-auth.com/docs/concepts/oauth), [Google provider](https://better-auth.com/docs/authentication/google)

## Keep one session per browser context

Provision one Better Auth user and Google account per partner. Each account binds the Google subject to one `next.app_user.id`. Keep the provider account ID and partner link unique in PostgreSQL and require a provisioned account and `is_account_partner` at session issuance and resolution. Disable public signup, passwords, implicit account linking, and other providers. Each OAuth return requires a verified Google email and the provisioned subject. Use the existing partner slug and display name in the app response. Identity review and configuration happen privately. Configure a random signing secret of at least 32 characters and keep provider and signing secrets separate for staging and production. No browser flow needs Google mail or calendar permission or stored Google tokens.

Better Auth stores the session in a private auth schema in Neon. Use its documented PostgreSQL adapter with a request-scoped connection through uncached Hyperdrive and a login limited to the auth tables and partner lookup. Keep migrations and provisioning on a separate login. The session binds the auth user, an opaque token, the issuing app origin, creation and expiration times, a CSRF token, and the most recent Google authentication time. Keep the session token out of responses, logs, and diagnostics except in its cookie.

Apply [`schema/partner-auth.sql`](../schema/partner-auth.sql) as the migration owner after the legacy schema, `next.app_user`, and `next.party` exist. If a lock wait reaches one second, roll back and retry during a quiet period. Give the dedicated Hyperdrive login membership in `engine_partner_auth` to look up current partners and manage sessions and OAuth verification state. The migration revokes `PUBLIC` execute on `public.tool_call_expire()`, which prevents attaching that function to new triggers. The existing receipt trigger keeps running. Provision the auth users and Google accounts as the migration owner.

Set a persistent `__Host-doctorcre_session` cookie with `Path=/`, `Secure`, `HttpOnly`, and `SameSite=Lax`. Keep the 30-day absolute lifetime. Set Better Auth's `expiresIn` to 30 days and disable sliding refresh and cookie caching. Ordinary use and reauthentication leave the expiration alone. Look up the live session and partner on each protected request. Opening another browser profile or signing in on another device creates an independent session. Staging and production use separate cookies by host and separate auth stores. Clear staging auth tables when refreshing a database copy and provision fixtures there. [Better Auth session management](https://better-auth.com/docs/concepts/session-management), [Cloudflare runtime guidance](https://better-auth.com/docs/guides/cloudflare)

## Serve pages and partner calls through the app

Bind a named engine Worker entrypoint for app traffic. The app keeps the browser URL on its own configured HTTPS origin for page checks, the Google callback and `/api/engine/*`. The engine checks that origin against its environment and the session. The named binding is the only engine entrypoint for the new partner door. The engine's public Worker addresses keep serving their existing public or service-token routes. [Named Worker entrypoints](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/#named-entrypoints)

Bind the app to `PartnerApp` and forward each request with its original app URL. Before enabling that binding in the app, set `PARTNER_APP_ORIGIN` to the app's HTTPS origin in each engine environment. Bind `PARTNER_AUTH_DATABASE` to the uncached auth Hyperdrive and set the Worker secrets `PARTNER_AUTH_SECRET`, `PARTNER_GOOGLE_CLIENT_ID`, and `PARTNER_GOOGLE_CLIENT_SECRET`. Register `/auth/callback/google` on that app origin as the Google client's redirect URI. Keep the app's default `PARTNER_SIGN_IN=carr` until cutover.

Staging deploys read `PARTNER_APP_ORIGIN` and `PARTNER_AUTH_DATABASE` from `env.staging` in `wrangler.jsonc`. The origin is the staging app's HTTPS address. The auth, reader, and writer Hyperdrives all connect to the same Neon rehearsal branch. Set the three sign-in secrets on the staging Worker.

| App route                                                     | Behavior                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /auth/login?return_to=…` and `GET /auth/callback/google` | Start the Google redirect through Better Auth with the account chooser. Better Auth verifies the OAuth response and binds the callback to the browser with state and PKCE. Store the return path with short-lived, single-use OAuth state. Accept only a local path on the app origin and use `/` for an invalid or missing path. A successful callback issues a session and returns to that path. |
| `GET /auth/session`                                           | Return `actor.slug`, `actor.display`, `csrf_token`, `reauth_required`, and `reauth_url`. An absent, revoked, expired, or ineligible session returns 401. An unavailable auth store returns 503.                                                                                                                                                                                                    |
| `GET /auth/reauth?return_to=…`                                | Require a live session or direct the browser to sign-in. Carry its ID, origin, and return path in server-bound OAuth state. After the account chooser, update the freshness time only on the same live session and partner. The account chooser is the same Google interaction as today. It can use Google's existing login.                                                                       |
| `POST /auth/signout`                                          | Require the same write proofs as partner saves. Revoke the current session and its session-bound push subscriptions, where supported. Expire its cookie and redirect to `/`. Report success only after revocation. The app confirms the next session check returns 401 and clears signed-in state across tabs.                                                                                     |
| Protected pages                                               | Ask the engine for session validity before serving HTML or sending a gated redirect. A 401 sends the browser to sign-in with the original path and query. A 503 shows the unavailable page. Keep each page's existing feature and role checks and its GET and HEAD behavior. Static shell assets and the status page can load signed out.                                                          |
| `/api/engine/*`                                               | Resolve the user from the session, then apply route authorization and stamp writes with that user. A caller's `Engine-For-User`, `Engine-Job`, or forwarded identity headers carry no browser authority. The app forwards the session and write proofs through the binding.                                                                                                                        |

For reauthentication, use Better Auth's Google callback as proof. The engine stops the callback before it creates a session or issues a session cookie. Consume the flow once and update the original session only if the browser still presents it and it is live, on the same host, for the same partner. A cancelled, mismatched, replayed, or late callback leaves the original session untouched. A new sign-in or successful reauthentication grants 10 minutes of freshness. A feature that requires freshness must check it server-side and keep its own approval rules.

Use the existing `x-carr-csrf` header name during the move. Every partner write, including sign-out, requires the session CSRF token, an exact same-origin `Origin`, and `Sec-Fetch-Site: same-origin`. Keep the existing constant-time token comparison. Auth and protected responses use `Cache-Control: no-store`. Preserve each `Set-Cookie` separately across the binding. Both the service worker and app continue to require a live network check for signed-in data. An auth outage fails closed without routing a request to the old API.

The Studio and assistant keep their [jobs door](new-database.md#what-every-door-shares) with its existing Access service token and audience. The audience and credentials for intake and comparison stay separate as today.

## Prepare production while the app uses CARR

Keep `PARTNER_SIGN_IN=carr` in the app. After the owner's approval, verify that the migration and auth connections use the direct endpoint for the production Neon branch. Run the database and Wrangler commands in a private terminal with credentials from the private store.

Before the first secret write or engine deployment, record the active production engine version serving 100% as `PREVIOUS_ENGINE_VERSION_ID`. Confirm that the engine's `/health` reports `ok: true` and that version ID. Keep the recorded ID through provisioning and release verification.

```sh
./node_modules/.bin/wrangler deployments status --name doctorcre-engine --json
curl --fail --silent --show-error "$PRODUCTION_ENGINE_ORIGIN/health"
```

1. If `doctorcre_auth` is absent, apply the approved `schema/partner-auth.sql` as the migration owner.

   ```sh
   psql -X -v ON_ERROR_STOP=1 "$PRODUCTION_MIGRATION_DATABASE_URL" -f schema/partner-auth.sql
   ```

2. In a `psql -X -v ON_ERROR_STOP=1` session as the migration owner, create the dedicated login if it is absent. Set its password at the `\password` prompt.

   ```sql
   begin;
   create role engine_partner_auth_login login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
   grant engine_partner_auth to engine_partner_auth_login;
   \password engine_partner_auth_login
   commit;
   ```

   Run the [effective permission audit](../schema/partner-auth-permissions.sql) as the dedicated login. It checks login attributes, memberships, every effective auth table and column privilege, and access to business schemas, tables, columns, sequences, and security-definer functions. Proceed to Hyperdrive only if the audit returns zero rows.

   ```sh
   psql -X -v ON_ERROR_STOP=1 "$PRODUCTION_PARTNER_AUTH_DATABASE_URL" \
       -c 'begin read only' -f schema/partner-auth-permissions.sql -c 'rollback'
   ```

3. Write the two verified mappings in a private CSV with the header `partner_user_id,email,google_subject`. Keep it outside the repo. Open `psql -X -v ON_ERROR_STOP=1 "$PRODUCTION_MIGRATION_DATABASE_URL"` as the migration owner and replace the example CSV path below. Run the block through the final `select`, then compare the two joined rows to the approved mappings in the same private session. Enter `commit;` only if both match. On any error or mismatch, enter `rollback;`. Report only the number of confirmed mappings.

   ```sql
   begin;
   set local lock_timeout = '1s';
   create temp table approved_partner (
       partner_user_id uuid primary key,
       email text not null unique,
       google_subject text not null unique
   ) on commit drop;
   \copy approved_partner from '/private/path/approved-partners.csv' with (format csv, header true)
   lock table doctorcre_auth."user", doctorcre_auth.account in share row exclusive mode;

   insert into doctorcre_auth."user"
       (id, partner_user_id, name, email, "emailVerified", "createdAt", "updatedAt")
   select gen_random_uuid()::text, u.id, p.name, a.email, true, now(), now()
   from approved_partner a
   join next.app_user u on u.id = a.partner_user_id and u.is_account_partner
   join next.party p on p.id = u.id
   on conflict do nothing;

   insert into doctorcre_auth.account
       (id, "userId", "providerId", "accountId", "createdAt", "updatedAt")
   select gen_random_uuid()::text, u.id, 'google', a.google_subject, now(), now()
   from approved_partner a
   join doctorcre_auth."user" u on u.partner_user_id = a.partner_user_id and u.email = a.email
   on conflict do nothing;

   do $$ begin
       if (select count(*) from approved_partner) <> 2
           or (select count(*) from doctorcre_auth."user") <> 2
           or (select count(*) from doctorcre_auth.account) <> 2
           or (select count(*) from approved_partner a
               join doctorcre_auth.partner p on p.app_user_id = a.partner_user_id
               join doctorcre_auth."user" u on u.id = p.auth_user_id
                   and u.email = a.email and u."emailVerified"
               join doctorcre_auth.account g on g."userId" = u.id
                   and g."providerId" = 'google' and g."accountId" = a.google_subject) <> 2 then
           raise exception 'Expected exactly two approved, eligible Google mappings';
       end if;
   end $$;

   select p.app_user_id, u.email, g."accountId" as google_subject
   from doctorcre_auth.partner p
   join doctorcre_auth."user" u on u.id = p.auth_user_id
   join doctorcre_auth.account g on g."userId" = u.id
   order by p.app_user_id;
   ```

   An exact existing pair is accepted. A matching user with a missing account is completed. A conflicting pair aborts the transaction for both mappings.

4. Check `./node_modules/.bin/wrangler hyperdrive list` for `doctorcre-engine-partner-auth`. If it is absent, create it using the direct connection URL for `engine_partner_auth_login`.

   ```sh
   ./node_modules/.bin/wrangler hyperdrive create doctorcre-engine-partner-auth \
       --connection-string "$PRODUCTION_PARTNER_AUTH_DATABASE_URL" --caching-disabled
   ```

   Check the returned ID with `./node_modules/.bin/wrangler hyperdrive get "$PRODUCTION_PARTNER_AUTH_HYPERDRIVE_ID"`. Verify the production Neon host, database, `engine_partner_auth_login`, and `caching.disabled=true`. In `wrangler.jsonc`, replace the all-zero production `PARTNER_AUTH_DATABASE` ID with this ID. Keep staging's own Hyperdrive on the rehearsal branch. A merge to `main` starts a production upload, so commit and review the real ID before queuing the merge. [Hyperdrive commands](https://developers.cloudflare.com/workers/wrangler/commands/hyperdrive/)

5. For the production Google client, confirm the redirect URI is `https://app.doctorcre.com/auth/callback/google`. If any of the three production secrets are missing, set them with the approved values at the interactive prompts. Each `secret put` deploys a version of the named engine Worker.

   ```sh
   ./node_modules/.bin/wrangler secret put PARTNER_AUTH_SECRET --name doctorcre-engine
   ./node_modules/.bin/wrangler secret put PARTNER_GOOGLE_CLIENT_ID --name doctorcre-engine
   ./node_modules/.bin/wrangler secret put PARTNER_GOOGLE_CLIENT_SECRET --name doctorcre-engine
   ```

6. After the engine release, read back the active versions. For each Worker, take the `version_id` serving 100% from `deployments status`.

   ```sh
   ./node_modules/.bin/wrangler deployments status --name doctorcre-engine --json
   ./node_modules/.bin/wrangler versions view "$ENGINE_VERSION_ID" --name doctorcre-engine --json |
       jq '.resources.bindings[] | select(.name | startswith("PARTNER_"))'
   ./node_modules/.bin/wrangler deployments status --name doctorcre-app --json
   ./node_modules/.bin/wrangler versions view "$APP_VERSION_ID" --name doctorcre-app --json |
       jq '.resources.bindings[] | select(.name == "PARTNER_SIGN_IN")'
   ```

   Verify `PARTNER_APP_ORIGIN=https://app.doctorcre.com`, the approved `PARTNER_AUTH_DATABASE` ID, and the three secret names on the engine. Verify `PARTNER_SIGN_IN=carr` on the app. [Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)

### Restore the previous engine version

If provisioning or release verification fails, stop the rollout and keep `PARTNER_SIGN_IN=carr`. If an engine release is still running, let it finish before restoring so it cannot overwrite the rollback. Check the active engine version. If a secret write or release changed it, restore the version recorded before provisioning.

```sh
./node_modules/.bin/wrangler rollback "$PREVIOUS_ENGINE_VERSION_ID" \
    --name doctorcre-engine --yes --message "Restore engine after sign-in preparation"
./node_modules/.bin/wrangler deployments status --name doctorcre-engine --json
curl --fail --silent --show-error "$PRODUCTION_ENGINE_ORIGIN/health"
```

Verify the recorded version serves 100% and `/health` returns `ok: true` with that version. Confirm the app still uses CARR by opening a protected page through the usual sign-in. Hold subsequent engine releases until the config is corrected. Worker rollback restores the release. Keep the database and Hyperdrive in place for the next attempt. [Cloudflare Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

## Switch after hours with advance notice

1. Deploy the engine, app and old-session rollback changes ahead of the switch. Keep the app's `PARTNER_SIGN_IN` release setting on `carr`. In staging, run both modes against a production-shaped copy with fixture identities and do a real Google round trip with approved test accounts. Test browser and installed-app contexts, sign in as both partners, reopen each from a saved link, and check that the displayed identity and saved attribution agree. Rehearse rollback and switch again.
2. Move or retire the remaining app routes that need CARR's browser cookie before the production switch. Check the app's proxy and live route list, including unmatched `/mcp` verbs, `/api/v1/*`, call and tour paths, push, and any retained System Work approvals. If push remains, move delivery to live engine sessions and end old registrations for this app host. Keep each remaining feature on its existing gate until it moves or is retired. Exercise the retained routes in staging with CARR's browser auth unavailable, including an engine read timeout. A retained app route that still requires the old cookie blocks the switch.
3. Tell both partners the after-hours window at least one working day ahead. Ask them to save open work before the window and explain that the next visit requires one Google sign-in per browser or installed-app context. Record the current app and engine releases and check that the old app-host sign-in path is available for rollback.
4. End pre-switch CARR browser sessions for this app host at the announced cutover. Set a fixed issuance cutoff in CARR's browser validator for this host and cancel any older pending login or reauth. In the app, set `PARTNER_SIGN_IN=engine` in one release so page gates, auth endpoints, and partner API calls select the same binding. Clear the old app-host cookies. Old sessions end here. Their tokens and freshness times are never imported. A stale tab must reload its session before it can retry a save.
5. Check both partners' sign-in and session on the running app. Check a deep link, an ordinary read, a permitted save and its actor, reauth, and sign-out. Confirm a separate context stays signed in when the current one signs out. Check push behavior for new and ended sessions if push remains enabled. Verify that an old cookie is refused and that a jobs call still reaches the same door.
6. If a check fails, return the app setting to `carr` with the rollback release. Keep the old issuance cutoff and clear the engine cookie on the same host. End the engine sessions and pending flows from the failed window before another attempt. Both partners sign in again if they were using the app. This switch changes authentication only, so keep the current business routes, data switches, and saves. After a successful window and both partners' checks, remove the app's legacy auth path and the engine's CARR session check.

## Build units

Each numbered item is one PR in the named repo, under about 400 changed lines excluding lockfiles and generated files. Tests use synthetic identities, a local database when needed, a supplied clock, and a stubbed Google response. Run the repo check for each PR before starting its dependents.

1. **Store the two partner identities and sessions (engine).** Add the private auth schema, grants, Better Auth adapter, and session resolver. Test both partner mappings, duplicate subjects and partner links, an unknown or ineligible user, the 30-day expiry, immediate revocation, and the restricted login. Prove the pinned release bundles and runs in the Worker.
2. **Sign in with Google (engine, after 1).** Add the app-only login and callback with secure cookies and return paths. Test a deep link, browser cookie attributes and restart persistence, verified versus unverified identity, bad state, callback replay, and an external return path.
3. **Authenticate partner calls (engine, after 1).** Wire the named entrypoint, session status and partner API middleware. Test both actors' reads and save attribution, absent and expired sessions, storage failure, direct public host refusal, forged identity headers, and each missing write proof. Run the existing jobs authorization tests.
4. **Reauthenticate and sign out (engine, after 2 and 3).** Test success, the 10-minute freshness boundary, a different account, cancellation, replay, and sign-out during reauth. Test revocation of the current session, refusal of a reused cookie, the surviving second session, and 503 when revocation is unavailable.
5. **Use the engine session in the app (app, after 3 and 4).** Switch the auth routes, page gates and partner API clients as a group. Verify gated redirects and deep links, page and API outage handling, stale tabs and offline behavior, sign-out, and staging-to-production isolation. Rehearse both release settings. Verify that switched-on browser requests can complete with the CARR browser gate unavailable.
6. **End the old sessions cleanly (CARR, before cutover, can start after 1).** Add the app-host issuance cutoff for sessions and pending OAuth state for rollback. Treat any record without an issuance time as older than the cutoff. Test on either side of the cutoff, a late callback, fresh sign-in after rollback, and isolation from other hosts and non-browser OAuth callers.
7. **Remove the app's old sign-in routes (app, after cutover checks).** Remove the rollback setting and CARR page and auth adapters. Exercise deep links, sign-out, app routes and the remaining separately authorized integrations.
8. **Remove CARR session checks from the engine (engine, after 7).** Remove the old browser session middleware and leave comparison calls on their existing binding. Test that an old cookie and the public Worker address cannot reach partner routes and that the jobs, intake, and comparison authorization tests still pass.

## Details to confirm before release

- The provider subjects and new OAuth client registrations are private deployment facts. Default to a separate app client per environment. Confirm the mappings with the two partners' verified Google sign-ins before enabling production.
- Inventory row 02 reports Cloudflare Error 1015 after about 35 minutes of signed-in browsing. The responsible rule is unverified. Default to keeping the rules in place while the coordinator uses scoped read access and the incident Ray ID to identify the rule and path. Repeat the ordinary browsing pattern on staging through and beyond the reported interval. Investigate a recurrence before switching.
