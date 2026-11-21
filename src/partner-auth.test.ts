import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { type TestContext, test } from "node:test";
import { UnsecuredJWT } from "jose";
import pg from "pg";
import { withPartnerAuth } from "./partner-auth.ts";
import { isArguments } from "./save-door.ts";
import { copyTest, readSchema } from "./test-copy.ts";

const appOrigin = "https://app.example.test";
const secret = randomBytes(32).toString("hex");
const issuedAt = new Date("2030-01-01T00:00:00Z");
const expiresAt = new Date("2030-01-31T00:00:00Z");
function identity(id: string, slug: string, display: string) {
	return { id, slug, display, appUserId: randomUUID() };
}
const first = identity("one", "joe", "Example One");
const second = identity("two", "dell", "Example Two");
const other = identity("other", "other", "Example Other");

function sessionHeaders(token: string) {
	const signature = createHmac("sha256", secret).update(token).digest("base64");
	return new Headers({
		cookie: `__Host-doctorcre_session=${encodeURIComponent(`${token}.${signature}`)}`,
	});
}

test("requires an explicit signing secret", async () => {
	const config = { connectionString: "", appOrigin, secret: "" };
	for (const invalid of [
		"",
		" ".repeat(32),
		"short",
		"better-auth-secret-12345678901234567890",
	]) {
		await assert.rejects(
			withPartnerAuth(
				{ ...config, secret: invalid },
				({ auth }) => auth.$context,
			),
			/Partner auth requires a signing secret/,
		);
	}
});

test("partner sessions in PostgreSQL", async (t) => {
	const { db, setup, cleanup, connectionString } = copyTest();
	const role = `auth_${randomUUID().replaceAll("-", "")}`;
	const url = new URL(connectionString);
	url.username = role;
	const config = { connectionString: url.href, appOrigin, secret };
	const resolve = (headers: Headers, origin = appOrigin) =>
		withPartnerAuth(config, ({ resolveSession }) =>
			resolveSession({ origin, headers }),
		);
	const issue = (id: string, origin = appOrigin) =>
		withPartnerAuth({ ...config, appOrigin: origin }, async ({ auth }) =>
			(await auth.$context).internalAdapter.createSession(id),
		);
	const addIdentity = (id: string, appUserId: string) =>
		db.query(
			`insert into doctorcre_auth."user"
				(id, partner_user_id, name, email, "emailVerified", "createdAt", "updatedAt")
				values ($1, $2, 'Example Auth User', $1 || '@example.test', true, $3, $3)`,
			[id, appUserId, issuedAt],
		);

	await setup();
	try {
		const migration = await readSchema("partner-auth.sql");
		await t.test("migration backs off under write contention", async () => {
			const writer = new pg.Client({ connectionString });
			await writer.connect();
			try {
				await writer.query("begin; lock next.app_user in row exclusive mode");
				await db.query("set statement_timeout = '4s'");
				await assert.rejects(db.query(migration), { code: "55P03" });
			} finally {
				await db.query("rollback; reset statement_timeout");
				await writer.end();
			}
		});
		await db.query(migration);
		await db.query(`create role ${role} login in role engine_partner_auth`);
		for (const { id, appUserId, slug, display } of [first, second, other]) {
			await db.query("begin");
			await db.query("select set_config('engine.user_id', $1, true)", [
				appUserId,
			]);
			await db.query(
				"insert into next.party (id, kind, name) values ($1, 'person', $2)",
				[appUserId, display],
			);
			await db.query("insert into next.app_user (id, slug) values ($1, $2)", [
				appUserId,
				slug,
			]);
			await db.query("commit");
			await addIdentity(id, appUserId);
			await db.query(
				`insert into doctorcre_auth.account
					(id, "userId", "providerId", "accountId", "createdAt", "updatedAt")
					values ($1, $1, 'google', $2, $3, $3)`,
				[id, `subject-${id}`, issuedAt],
			);
		}

		t.beforeEach((sub) =>
			sub.mock.timers.enable({ apis: ["Date"], now: issuedAt }),
		);
		await t.test(
			"Google sign-in through the named app binding",
			async (sub) => {
				const hooks = registerHooks({
					resolve(specifier, context, nextResolve) {
						if (specifier !== "cloudflare:workers")
							return nextResolve(specifier, context);
						return {
							url: "data:text/javascript,export class DurableObject {}; export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env } }",
							shortCircuit: true,
						};
					},
				});
				sub.after(() => hooks.deregister());
				const { PartnerApp, default: publicWorker } = await import(
					"./worker-entry.ts"
				);
				const env = {
					PARTNER_APP_ORIGIN: appOrigin,
					PARTNER_AUTH_DATABASE: { connectionString: config.connectionString },
					PARTNER_AUTH_SECRET: secret,
					PARTNER_GOOGLE_CLIENT_ID: "fixture-client",
					PARTNER_GOOGLE_CLIENT_SECRET: randomBytes(32).toString("hex"),
				};
				const entrypoint: unknown = Reflect.construct(PartnerApp, [
					undefined,
					env,
				]);
				assert.ok(entrypoint instanceof PartnerApp);
				const binding = entrypoint;
				const login = `${appOrigin}/auth/login`;
				const callback = `${appOrigin}/auth/callback/google`;
				const sessionCookie = "__Host-doctorcre_session";
				const cookiePair = (cookie: string) => cookie.split(";", 1)[0] ?? "";
				function cookieFrom(response: Response, name: string) {
					const cookie = response.headers
						.getSetCookie()
						.find((value) => value.startsWith(`${name}=`));
					assert.ok(cookie);
					return cookie;
				}
				function assertCookieFlags(cookie: string, persistent: boolean) {
					assert.match(cookie, /; Path=\//i);
					assert.match(cookie, /; Secure/i);
					assert.match(cookie, /; HttpOnly/i);
					assert.match(cookie, /; SameSite=Lax/i);
					assert.doesNotMatch(cookie, /; Domain=/i);
					assert.match(
						cookie,
						persistent
							? /; Max-Age=2592000(?:;|$)/i
							: /; Max-Age=[1-9]\d{1,2}(?:;|$)/i,
					);
				}
				let challenge: string | null;
				let exchanges = 0;
				sub.mock.method(
					globalThis,
					"fetch",
					async (input: string | URL | Request, init?: RequestInit) => {
						const request = new Request(input, init);
						assert.equal(request.url, "https://oauth2.googleapis.com/token");
						assert.equal(request.method, "POST");
						const body = new URLSearchParams(await request.text());
						assert.equal(body.get("redirect_uri"), callback);
						assert.equal(
							createHash("sha256")
								.update(body.get("code_verifier") ?? "")
								.digest("base64url"),
							challenge,
						);
						exchanges++;
						const code = body.get("code");
						const profile = {
							sub:
								code === "unknown"
									? "unprovisioned"
									: code === "ineligible"
										? "subject-other"
										: code === "different-account"
											? "subject-two"
											: "subject-one",
							email:
								code === "different-account"
									? "two@example.test"
									: "one@example.test",
							email_verified: code !== "unverified",
							name: "Example One",
						};
						const id_token = new UnsecuredJWT(profile)
							.setIssuer("https://accounts.google.com")
							.setAudience(
								code === "wrong-audience"
									? "another-client"
									: env.PARTNER_GOOGLE_CLIENT_ID,
							)
							.setExpirationTime(Math.floor(Date.now() / 1000) + 300)
							.encode();
						return Response.json({
							id_token,
							access_token: "fixture-access-token",
							token_type: "Bearer",
							expires_in: 300,
						});
					},
				);
				async function start(returnTo: string, browser?: Headers) {
					const request = new URL(
						browser ? "/auth/reauth" : "/auth/login",
						appOrigin,
					);
					request.searchParams.set("return_to", returnTo);
					const response = await binding.fetch(
						new Request(request, { headers: new Headers(browser) }),
					);
					assert.equal(response.status, 302);
					assert.equal(response.headers.get("cache-control"), "no-store");
					const authorize = new URL(response.headers.get("location") ?? "");
					assert.equal(authorize.origin, "https://accounts.google.com");
					assert.equal(authorize.searchParams.get("prompt"), "select_account");
					assert.equal(authorize.searchParams.get("redirect_uri"), callback);
					assert.equal(
						authorize.searchParams.get("code_challenge_method"),
						"S256",
					);
					assert.deepEqual(
						authorize.searchParams.get("scope")?.split(" ").sort(),
						["email", "openid", "profile"],
					);
					challenge = authorize.searchParams.get("code_challenge");
					assert.ok(challenge);
					const state = authorize.searchParams.get("state");
					assert.ok(state);
					const cookie = cookieFrom(response, "__Host-doctorcre_oauth_state");
					assertCookieFlags(cookie, false);
					return { state, cookie: cookiePair(cookie) };
				}
				function complete(
					{ state, cookie }: Awaited<ReturnType<typeof start>>,
					code = "verified",
					browser?: Headers,
				) {
					const url = new URL(callback);
					url.search = new URLSearchParams({
						state,
						...(code === "cancel" ? { error: "access_denied" } : { code }),
						return_to: "https://outside.example.test",
					}).toString();
					const cookies = [browser?.get("cookie"), cookie].filter(Boolean);
					return binding.fetch(
						new Request(url, {
							headers: {
								cookie: cookies.join("; "),
								"Sec-Fetch-Site": "cross-site",
							},
						}),
					);
				}
				const count = async () =>
					(await db.query("select id from doctorcre_auth.session")).rows.length;
				const initialSessions = await count();
				const assertRefused = (response: Response) => {
					assert.equal(response.status, 401);
					assert.equal(response.headers.get("cache-control"), "no-store");
					assert.ok(
						response.headers
							.getSetCookie()
							.every((cookie) => !cookie.startsWith(`${sessionCookie}=`)),
					);
				};

				assert.equal((await publicWorker.request(login)).status, 404);
				assert.equal((await publicWorker.request(callback)).status, 404);
				assert.equal(
					(
						await binding.fetch(
							new Request("https://worker.example.test/auth/login"),
						)
					).status,
					404,
				);
				const path = "/deals.html?deal=example#notes";
				const flow = await start(path);
				assertRefused(await complete({ ...flow, state: "wrong-state" }));
				assertRefused(await complete({ ...flow, cookie: "" }));
				assert.equal(exchanges, 0);
				assert.equal(await count(), initialSessions);
				const signedIn = await complete(flow);
				assert.equal(signedIn.status, 302);
				assert.equal(signedIn.headers.get("cache-control"), "no-store");
				assert.equal(signedIn.headers.get("location"), `${appOrigin}${path}`);
				assert.equal(signedIn.headers.getSetCookie().length, 2);
				assert.match(
					cookieFrom(signedIn, "__Host-doctorcre_oauth_state"),
					/; Max-Age=0/i,
				);
				const persistent = cookieFrom(signedIn, sessionCookie);
				assertCookieFlags(persistent, true);
				const recovered = await resolve(
					new Headers({ cookie: cookiePair(persistent) }),
				);
				assert.equal(recovered?.appUserId, first.appUserId);
				assert.deepEqual(recovered.expiresAt, expiresAt);
				assertRefused(await complete(flow));
				assert.equal(exchanges, 1);

				for (const code of [
					"unverified",
					"unknown",
					"ineligible",
					"wrong-audience",
				]) {
					assertRefused(await complete(await start("/"), code));
				}
				assert.equal(await count(), initialSessions + 1);
				for (const path of [
					"https://outside.example.test",
					"//outside.example.test",
					"/\\outside.example.test",
				]) {
					const response = await complete(await start(path));
					assert.equal(response.status, 302);
					assert.equal(response.headers.get("location"), `${appOrigin}/`);
				}
				const concurrent = await start("/");
				const results = await Promise.all([
					complete(concurrent, "first"),
					complete(concurrent, "second"),
				]);
				assert.deepEqual(
					results.map((response) => response.status).sort(),
					[302, 401],
				);
				assert.equal(await count(), initialSessions + 5);

				sub.mock.timers.reset();
				async function staleSession(reauth: TestContext) {
					reauth.mock.timers.setTime(issuedAt.getTime());
					const session = await issue(first.id);
					const browser = sessionHeaders(session.token);
					reauth.mock.timers.tick(600_000);
					const stored = await resolve(browser);
					assert.ok(stored);
					return { browser, csrfToken: stored.csrfToken };
				}
				async function assertFreshness(
					browser: Headers,
					reauthRequired: boolean,
				) {
					const status = await binding.fetch(
						new Request(`${appOrigin}/auth/session`, { headers: browser }),
					);
					assert.equal(status.status, 200);
					assert.partialDeepStrictEqual(await status.json(), {
						reauth_required: reauthRequired,
					});
				}
				await sub.test(
					"reauth without a session redirects to login with the local return path",
					async () => {
						const response = await binding.fetch(
							new Request(`${appOrigin}/auth/reauth?return_to=%2Fcalendar`),
						);
						assert.equal(response.status, 302);
						assert.equal(
							response.headers.get("location"),
							`${login}?return_to=%2Fcalendar`,
						);
					},
				);
				await sub.test(
					"reauth refreshes the same session for exactly ten minutes and refuses replay",
					async (reauth) => {
						const { browser } = await staleSession(reauth);
						const original = await resolve(browser);
						const sessions = await count();
						await assertFreshness(browser, true);
						const flow = await start(path, browser);
						const refreshed = await complete(flow, "verified", browser);
						assert.equal(refreshed.status, 302);
						assert.equal(
							refreshed.headers.get("location"),
							`${appOrigin}${path}`,
						);
						assert.match(
							cookieFrom(refreshed, "__Host-doctorcre_oauth_state"),
							/; Max-Age=0/i,
						);
						assert.equal(refreshed.headers.getSetCookie().length, 1);
						assert.equal(await count(), sessions);
						assert.deepEqual(await resolve(browser), {
							...original,
							googleAuthenticatedAt: new Date(),
						});
						reauth.mock.timers.tick(599_999);
						await assertFreshness(browser, false);
						reauth.mock.timers.tick(1);
						await assertFreshness(browser, true);
						assertRefused(await complete(flow, "verified", browser));
						await assertFreshness(browser, true);
					},
				);
				for (const code of ["different-account", "cancel"]) {
					await sub.test(
						`reauth leaves freshness alone on ${code}`,
						async (reauth) => {
							const { browser } = await staleSession(reauth);
							const sessions = await count();
							assertRefused(
								await complete(await start(path, browser), code, browser),
							);
							await assertFreshness(browser, true);
							assert.equal(await count(), sessions);
						},
					);
				}
				await sub.test(
					"reauth requires the original browser session",
					async (reauth) => {
						const { browser } = await staleSession(reauth);
						const { browser: other } = await staleSession(reauth);
						assertRefused(
							await complete(await start(path, browser), "verified", other),
						);
						await assertFreshness(browser, true);
						await assertFreshness(other, true);
					},
				);
				await sub.test(
					"sign-out during reauth leaves no session for a late callback",
					async (reauth) => {
						const { browser, csrfToken } = await staleSession(reauth);
						const flow = await start(path, browser);
						const sessions = await count();
						const headers = new Headers(browser);
						headers.set("Origin", appOrigin);
						headers.set("Sec-Fetch-Site", "same-origin");
						headers.set("x-carr-csrf", csrfToken);
						const signedOut = await binding.fetch(
							new Request(`${appOrigin}/auth/signout`, {
								method: "POST",
								headers,
							}),
						);
						assert.equal(signedOut.status, 303);
						assertRefused(await complete(flow, "verified", browser));
						assert.equal(await resolve(browser), null);
						assert.equal(await count(), sessions - 1);
					},
				);
			},
		);
		await t.test("resolves both actors and checks origin", async () => {
			for (const { id, appUserId, slug, display } of [first, second]) {
				const session = await issue(id);
				const resolved = await resolve(sessionHeaders(session.token));
				assert.ok(resolved?.csrfToken);
				assert.deepEqual(resolved, {
					id: session.id,
					appUserId,
					actor: { slug, display },
					csrfToken: resolved.csrfToken,
					googleAuthenticatedAt: issuedAt,
					expiresAt,
				});
			}
			const elsewhere = "https://other.example.test";
			const session = await issue(first.id, elsewhere);
			const headers = sessionHeaders(session.token);
			assert.equal(await resolve(headers), null);
			assert.equal(await resolve(headers, elsewhere), null);
		});

		await t.test("refuses unknown and ineligible users", async () => {
			await assert.rejects(addIdentity("unknown", randomUUID()), {
				code: "23503",
			});
			assert.equal(await resolve(sessionHeaders("unknown-token")), null);
			assert.equal(Boolean(await issue(other.id)), false);
			const sessions = await db.query(
				'select id from doctorcre_auth.session where "userId" = $1',
				[other.id],
			);
			assert.equal(sessions.rowCount, 0);
		});
		await t.test("requires unique subjects and partner links", async () => {
			await assert.rejects(
				db.query(
					`update doctorcre_auth.account set "accountId" = 'subject-one' where id = 'two'`,
				),
				{ code: "23505" },
			);
			await assert.rejects(addIdentity("duplicate", first.appUserId), {
				code: "23505",
			});
		});

		await t.test(
			"ordinary use never extends the 30-day lifetime",
			async (sub) => {
				const session = await issue(first.id);
				const headers = sessionHeaders(session.token);
				sub.mock.timers.setTime(expiresAt.getTime() - 1);
				assert.deepEqual((await resolve(headers))?.expiresAt, expiresAt);
				sub.mock.timers.setTime(expiresAt.getTime());
				assert.equal(await resolve(headers), null);
				sub.mock.timers.tick(1);
				assert.equal(await resolve(headers), null);
			},
		);

		await t.test("revokes only the ended session immediately", async () => {
			const revoked = await issue(second.id);
			const surviving = await issue(second.id);
			const headers = sessionHeaders(revoked.token);
			assert.ok(await resolve(headers));
			await withPartnerAuth(config, async ({ auth }) => {
				await (await auth.$context).internalAdapter.deleteSession(
					revoked.token,
				);
			});
			assert.equal(await resolve(headers), null);
			assert.ok(await resolve(sessionHeaders(surviving.token)));
		});

		await t.test("partner routes through the app binding", async (routes) => {
			// The inherited hook supplies a fresh clock to each route test.
			routes.mock.timers.reset();
			const hooks = registerHooks({
				resolve(specifier, context, nextResolve) {
					if (specifier === "cloudflare:workers") {
						return {
							url: "data:text/javascript,export class DurableObject {}; export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env } }",
							shortCircuit: true,
						};
					}
					return nextResolve(specifier, context);
				},
			});
			routes.after(() => hooks.deregister());
			const { default: worker, PartnerApp } = await import("./worker-entry.ts");
			const writer = `${role}_writer`;
			routes.after(async () => {
				await db.query(`rollback; drop role if exists ${writer}`);
			});
			await db.query(`begin; set local engine.job = 'old_system';
				create role ${writer} login in role engine;
				insert into role (slug, label) values ('lead', 'Lead');
				insert into stage (role, slug, label) values ('lead', 'opportunity', 'Opportunity');
				insert into how_found (slug, label) values ('referral', 'Referral');
				commit;`);
			const writerUrl = new URL(connectionString);
			writerUrl.username = writer;
			const env = {
				PARTNER_APP_ORIGIN: appOrigin,
				PARTNER_AUTH_DATABASE: { connectionString: config.connectionString },
				PARTNER_AUTH_SECRET: secret,
				DATABASE_WRITER: { connectionString: writerUrl.href },
				CARR: {
					fetch: async () =>
						Response.json({
							actor: { slug: first.slug, display: first.display },
							csrf_token: "legacy-token",
						}),
				},
			};
			const bind = (bindings = env) => {
				const binding: unknown = Reflect.construct(PartnerApp, [
					undefined,
					bindings,
				]);
				assert.ok(binding instanceof PartnerApp);
				return binding;
			};
			const binding = bind();
			const statusPath = "/auth/session";
			const whoamiPath = "/api/engine/whoami";
			const paths = [statusPath, whoamiPath];
			const forged = {
				"Engine-For-User": second.slug,
				"Engine-Job": "agent",
				"X-Forwarded-User": second.slug,
			};
			const browserSession = async (partner = first) => {
				const session = await issue(partner.id);
				const headers = sessionHeaders(session.token);
				for (const [name, value] of Object.entries(forged))
					headers.set(name, value);
				const stored = await resolve(headers);
				assert.ok(stored);
				return { headers, csrfToken: stored.csrfToken };
			};
			const request = (
				path: string,
				headers: HeadersInit,
				origin = appOrigin,
			) => new Request(origin + path, { headers });
			const read = (path: string, headers: HeadersInit, origin = appOrigin) =>
				binding.fetch(request(path, headers, origin));
			const publicRead = (path: string, headers: HeadersInit) =>
				worker.fetch(
					request(path, headers, "https://engine.example.test"),
					env,
				);
			const check = (response: Response, status: number) => {
				assert.equal(response.status, status);
				assert.equal(response.headers.get("Cache-Control"), "no-store");
			};
			const proofs = (headers: Headers, token: string) => {
				const proved = new Headers(headers);
				proved.set("Origin", appOrigin);
				proved.set("Sec-Fetch-Site", "same-origin");
				proved.set("x-carr-csrf", token);
				return proved;
			};
			const save = (headers: Headers) =>
				binding.fetch(
					new Request(`${appOrigin}/api/engine/prospects`, {
						method: "POST",
						headers,
						body: JSON.stringify({
							idempotency_key: randomUUID(),
							name: "Example Prospect",
							kind: "company",
							how_found: "referral",
							note: "Example note",
						}),
					}),
				);
			const signOut = (headers: Headers) =>
				binding.fetch(
					new Request(`${appOrigin}/auth/signout`, { method: "POST", headers }),
				);

			for (const partner of [first, second]) {
				await routes.test(`reads and saves as ${partner.display}`, async () => {
					const { headers, csrfToken } = await browserSession(partner);
					const actor = { slug: partner.slug, display: partner.display };
					const status = await read(statusPath, headers);
					check(status, 200);
					assert.deepEqual(await status.json(), {
						actor,
						csrf_token: csrfToken,
						reauth_required: false,
						reauth_url: "/auth/reauth?return_to=/",
					});
					const whoami = await read(whoamiPath, headers);
					check(whoami, 200);
					assert.deepEqual(await whoami.json(), actor);
					const saved = await save(proofs(headers, csrfToken));
					check(saved, 201);
					const answer = await saved.json();
					assert.ok(isArguments(answer));
					const { rows } = await db.query(
						"select changed_by_user_id from activity where id = $1",
						[answer.activity_id],
					);
					assert.deepEqual(rows, [{ changed_by_user_id: partner.appUserId }]);
				});
			}

			await routes.test(
				"Doc is app-only and requires session write proofs",
				async () => {
					const { headers, csrfToken } = await browserSession();
					const path = "/api/engine/doc/conversations";
					check(await read(path, {}), 401);
					assert.equal(
						(
							await publicRead(path, {
								Cookie: "__Host-dealroom_session=example",
							})
						).status,
						404,
					);
					const ask = (headers: Headers) =>
						binding.fetch(
							new Request(`${appOrigin}/api/engine/doc/turns`, {
								method: "POST",
								headers,
								body: JSON.stringify({
									idempotency_key: randomUUID(),
									question: "What should I review?",
								}),
							}),
						);
					for (const proof of ["Origin", "Sec-Fetch-Site", "x-carr-csrf"]) {
						const incomplete = proofs(headers, csrfToken);
						incomplete.delete(proof);
						check(await ask(incomplete), 403);
					}
					const response = await ask(proofs(headers, csrfToken));
					check(response, 503);
					const result = await response.json();
					assert.ok(isArguments(result));
					assert.equal(result.error, "doc_unavailable");
					const chat = `${path}/${result.conversation_id}`;
					check(await read(chat, headers), 200);
					const other = await browserSession(second);
					check(await read(chat, other.headers), 404);
				},
			);

			await routes.test(
				"requires each same-origin write proof from this session",
				async () => {
					const { headers, csrfToken } = await browserSession();
					const other = await browserSession(second);
					for (const [header, wrong] of Object.entries({
						Origin: "https://other.example.test",
						"Sec-Fetch-Site": "same-site",
						"x-carr-csrf": other.csrfToken,
					})) {
						const proved = proofs(headers, csrfToken);
						proved.delete(header);
						check(await save(proved), 403);
						proved.set(header, wrong);
						check(await save(proved), 403);
					}
				},
			);

			await routes.test(
				"refuses absent, expired, and wrong-origin sessions",
				async (sub) => {
					const { headers } = await browserSession();
					for (const path of paths) {
						check(await read(path, forged), 401);
						check(await read(path, headers, "https://other.example.test"), 401);
					}
					sub.mock.timers.setTime(expiresAt.getTime());
					for (const path of paths) check(await read(path, headers), 401);
				},
			);

			await routes.test(
				"session status reports freshness at ten minutes",
				async (sub) => {
					const { headers } = await browserSession();
					sub.mock.timers.tick(599_999);
					const fresh = await read(statusPath, headers);
					assert.partialDeepStrictEqual(await fresh.json(), {
						reauth_required: false,
					});
					sub.mock.timers.tick(1);
					const stale = await read(statusPath, headers);
					assert.partialDeepStrictEqual(await stale.json(), {
						reauth_required: true,
					});
				},
			);

			await routes.test(
				"auth store failure is unavailable even with a legacy cookie",
				async () => {
					const broken = bind({
						...env,
						PARTNER_AUTH_DATABASE: { connectionString: writerUrl.href },
					});
					const { headers } = await browserSession();
					headers.set(
						"Cookie",
						`${headers.get("Cookie")}; __Host-dealroom_session=legacy`,
					);
					for (const path of paths)
						check(await broken.fetch(request(path, headers)), 503);
				},
			);

			await routes.test(
				"sign-out revokes only the current session",
				async () => {
					const { headers, csrfToken } = await browserSession();
					const separate = await browserSession();
					const proved = proofs(headers, csrfToken);
					for (const name of ["Origin", "Sec-Fetch-Site", "x-carr-csrf"]) {
						const incomplete = new Headers(proved);
						incomplete.delete(name);
						check(await signOut(incomplete), 403);
						check(await read(statusPath, headers), 200);
					}
					const response = await signOut(proved);
					check(response, 303);
					assert.equal(response.headers.get("Location"), "/");
					assert.deepEqual(response.headers.getSetCookie(), [
						"__Host-doctorcre_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
					]);
					check(await read(statusPath, headers), 401);
					check(await read(whoamiPath, headers), 401);
					check(await read(statusPath, separate.headers), 200);
				},
			);

			await routes.test(
				"sign-out returns 503 if the session cannot be revoked",
				async () => {
					const { headers, csrfToken } = await browserSession();
					await db.query(
						"revoke delete on doctorcre_auth.session from engine_partner_auth",
					);
					try {
						const response = await signOut(proofs(headers, csrfToken));
						check(response, 503);
						assert.deepEqual(response.headers.getSetCookie(), []);
						assert.equal(response.headers.has("Location"), false);
						check(await read(statusPath, headers), 200);
					} finally {
						await db.query(
							"grant delete on doctorcre_auth.session to engine_partner_auth",
						);
					}
				},
			);

			await routes.test(
				"public dispatch accepts only CARR sign-in",
				async () => {
					const { headers } = await browserSession(second);
					assert.equal((await publicRead(statusPath, headers)).status, 404);
					check(await publicRead(whoamiPath, headers), 401);
					headers.set("Cookie", "__Host-dealroom_session=legacy");
					const legacy = await publicRead(whoamiPath, headers);
					check(legacy, 200);
					assert.deepEqual(await legacy.json(), {
						slug: first.slug,
						display: first.display,
					});
					assert.equal((await read("/jobs/deals", headers)).status, 404);
				},
			);
		});

		await t.test("auth login stays within the auth store", async () => {
			const { rows } = await db.query(
				`
				with outside_auth as (
					select oid, nspname from pg_namespace
					where nspname !~ '^pg_' and nspname not in ('information_schema', 'doctorcre_auth')
				)
				select nspname as unexpected from outside_auth
				where has_schema_privilege($1, oid, 'CREATE')
					or (nspname <> 'public' and has_schema_privilege($1, oid, 'USAGE'))
				union all
				select format('%I.%I', nspname, relname) from pg_class c join outside_auth n on n.oid = c.relnamespace
				where case when relkind = 'S' then has_sequence_privilege($1, c.oid, 'SELECT, UPDATE, USAGE')
					when relkind in ('r','p','v','m','f') then
						has_table_privilege($1, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
						or has_any_column_privilege($1, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
					else false end
				union all
				select format('%I.%I', nspname, proname) from pg_proc p join outside_auth n on n.oid = p.pronamespace
				where prosecdef and has_function_privilege($1, p.oid, 'EXECUTE')
				union all
				select 'write access beyond session fields' where
					has_schema_privilege($1, 'doctorcre_auth', 'CREATE')
					or has_table_privilege($1, 'doctorcre_auth.account', 'DELETE')
					or has_column_privilege($1, 'doctorcre_auth."user"', 'partner_user_id', 'UPDATE')
					or has_column_privilege($1, 'doctorcre_auth.session', 'token', 'UPDATE')
			`,
				[role],
			);
			assert.deepEqual(rows, []);
		});

		await t.test("existing legacy receipt trigger still runs", async () => {
			await db.query(`
				with actor as (
					insert into public.actor (slug, kind, display_name) values ('fixture', 'human', 'Example Actor')
					returning id
				)
				insert into public.tool_call (idempotency_key, verb, actor_id, request_hash, response, created_at)
				select 'fixture-receipt', 'fixture', id, 'old', '{}', now() - interval '31 days' from actor;
				grant insert on public.tool_call to engine_reader;
				grant select on public.actor to engine_reader;
			`);
			await db.query("set role engine_reader");
			try {
				const receipt = await db.query(`
						insert into public.tool_call (idempotency_key, verb, actor_id, request_hash, response)
						select 'fixture-receipt', 'fixture', id, 'new', '{}' from public.actor where slug = 'fixture'
					`);
				assert.equal(receipt.rowCount, 1);
				await assert.rejects(db.query("select * from doctorcre_auth.session"), {
					code: "42501",
				});
			} finally {
				await db.query("reset role");
			}
		});
	} finally {
		await db.query(`drop role if exists ${role}`);
		await cleanup();
	}
});
