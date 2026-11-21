import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { createTestHarness } from "wrangler";
import { withPartnerAuth } from "./partner-auth.ts";
import { copyTest, readSchema } from "./test-copy.ts";

const appOrigin = "https://app.example.test";
const engineOrigin = "https://engine.example.test";
const linkPath = "/api/engine/doc/link";
const proof = { Origin: appOrigin, "Sec-Fetch-Site": "same-origin" };

test("Doc link migration, private credentials and Mac polling", {
	timeout: 30_000,
}, async (t) => {
	const { db, setup, cleanup, connectionString } = copyTest();
	const reader = `doc_read_${randomUUID().replaceAll("-", "")}`;
	const writer = `doc_write_${randomUUID().replaceAll("-", "")}`;
	await setup();
	t.after(async () => {
		await db.query(`drop role if exists ${reader}, ${writer}`);
		await cleanup();
	});
	await db.query(`create role ${reader} login in role engine_reader;
		create role ${writer} login in role engine;`);
	await db.query("drop table next.doc_link");
	await db.query(await readSchema("partner-auth.sql"));
	const secret = randomBytes(32).toString("hex");
	const appUserId = randomUUID();
	const otherUserId = randomUUID();

	async function signIn(slug: string, owner: string) {
		await db.query("begin");
		await db.query("select set_config('engine.user_id', $1, true)", [owner]);
		await db.query(
			"insert into next.party (id, kind, name) values ($1, 'person', 'Example Partner')",
			[owner],
		);
		await db.query("insert into next.app_user (id, slug) values ($1, $2)", [
			owner,
			slug,
		]);
		await db.query("commit");
		await db.query(
			`insert into doctorcre_auth."user"
				(id, partner_user_id, name, email, "emailVerified", "createdAt", "updatedAt")
				values ($1, $2, 'Example Partner', $1 || '@example.test', true, now(), now())`,
			[slug, owner],
		);
		await db.query(
			`insert into doctorcre_auth.account
				(id, "userId", "providerId", "accountId", "createdAt", "updatedAt")
				values ($1, $1, 'google', $1, now(), now())`,
			[slug],
		);
		const { id, token } = await withPartnerAuth(
			{ appOrigin, connectionString, secret },
			async ({ auth }) =>
				(await auth.$context).internalAdapter.createSession(slug),
		);
		const {
			rows: [session],
		} = await db.query<{ csrfToken: string }>(
			'select "csrfToken" from doctorcre_auth.session where id = $1',
			[id],
		);
		assert.ok(session);
		const signature = createHmac("sha256", secret)
			.update(token)
			.digest("base64");
		return {
			Cookie: `__Host-doctorcre_session=${encodeURIComponent(`${token}.${signature}`)}`,
			"x-carr-csrf": session.csrfToken,
		};
	}
	const first = await signIn("joe", appUserId);
	const second = await signIn("dell", otherUserId);

	const dir = await mkdtemp(join(process.cwd(), ".doc-link-test-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const main = join(dir, "app.js");
	await writeFile(
		main,
		// The local harness delivers HTTPS URLs and Origin headers over HTTP.
		`export default { fetch(request, env) {
			const url = new URL(request.url);
			const headers = new Headers(request.headers);
			const sameOrigin = headers.get("Origin") === url.origin;
			url.protocol = "https:";
			if (sameOrigin) headers.set("Origin", url.origin);
			return env.PARTNER_APP.fetch(new Request(url, { method: request.method, headers }));
		} }`,
	);
	const localDatabase = new URL(connectionString);
	localDatabase.password = "fixture";
	const readDatabase = new URL(localDatabase);
	readDatabase.username = reader;
	const writeDatabase = new URL(localDatabase);
	writeDatabase.username = writer;
	const server = createTestHarness({
		workers: [
			{
				config: {
					name: "doc-link-test-app",
					main,
					compatibility_date: "2026-11-11",
					services: [
						{
							binding: "PARTNER_APP",
							service: "doc-link-test-engine",
							entrypoint: "PartnerApp",
						},
					],
					routes: [
						{ pattern: "app.example.test/*", zone_name: "example.test" },
					],
				},
			},
			{
				config: {
					name: "doc-link-test-engine",
					main: new URL("./worker-entry.ts", import.meta.url).pathname,
					compatibility_date: "2026-11-11",
					compatibility_flags: ["nodejs_compat"],
					hyperdrive: [
						{
							binding: "DATABASE",
							id: "test-reader",
							localConnectionString: readDatabase.href,
						},
						{
							binding: "DATABASE_WRITER",
							id: "test-writer",
							localConnectionString: writeDatabase.href,
						},
						{
							binding: "PARTNER_AUTH_DATABASE",
							id: "test-auth",
							localConnectionString: localDatabase.href,
						},
					],
					vars: { PARTNER_APP_ORIGIN: appOrigin },
					routes: [
						{ pattern: "engine.example.test/*", zone_name: "example.test" },
					],
				},
				secrets: { PARTNER_AUTH_SECRET: secret },
			},
		],
	});
	try {
		await server.listen();
		const send = (
			headers: Record<string, string>,
			method = "GET",
			suffix = "",
		) => server.fetch(appOrigin + linkPath + suffix, { method, headers });
		const poll = (credential: string, headers: Record<string, string> = {}) =>
			server.fetch(`${engineOrigin}${linkPath}/claim`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${credential}`,
					...headers,
				},
			});
		async function presence(partner: typeof first) {
			const response = await send(partner);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("cache-control"), "no-store");
			const status: unknown = await response.json();
			assert.ok(
				status &&
					typeof status === "object" &&
					"issued_at" in status &&
					"connected" in status,
			);
			assert.deepEqual(Object.keys(status).sort(), ["connected", "issued_at"]);
			return status;
		}
		async function issue(partner: typeof first, suffix = "") {
			const response = await send({ ...partner, ...proof }, "POST", suffix);
			assert.equal(response.status, 201);
			assert.equal(response.headers.get("cache-control"), "no-store");
			const result: unknown = await response.json();
			assert.ok(result && typeof result === "object" && "credential" in result);
			assert.ok(typeof result.credential === "string");
			return result.credential;
		}
		const revoke = (partner: typeof first, suffix = "") =>
			send({ ...partner, ...proof }, "POST", `/revoke${suffix}`);

		const wrongCredential = randomBytes(32).toString("base64url");
		for (const response of await Promise.all([
			send(first),
			send({ ...first, ...proof }, "POST"),
			revoke(first),
			poll(wrongCredential),
		])) {
			assert.equal(response.status, 503);
			assert.deepEqual(await response.json(), {
				error: "doc_link_unavailable",
			});
			assert.equal(response.headers.get("cache-control"), "no-store");
		}
		assert.equal(
			(await server.fetch(`${appOrigin}/auth/session`, { headers: first }))
				.status,
			200,
		);
		await db.query(await readSchema("add-doc-link.sql"));
		await db.query(await readSchema("add-doc-link-readiness.sql"));

		assert.equal((await send({})).status, 401);
		assert.equal((await send(first, "POST")).status, 403);
		assert.equal((await send(first, "POST", "/revoke")).status, 403);
		assert.equal(
			(await send({ ...first, ...proof }, "POST", "/claim")).status,
			404,
		);
		assert.equal(
			(
				await server.fetch(engineOrigin + linkPath, {
					method: "POST",
					headers: { ...first, ...proof },
				})
			).status,
			401,
		);
		assert.deepEqual(await presence(first), {
			connected: false,
			issued_at: null,
		});
		const credential = await issue(first);
		const expectedHash = createHash("sha256").update(credential).digest("hex");
		const stored = await db.query(
			"select owner_user_id, credential_hash from next.doc_link",
		);
		assert.ok(
			stored.rows.length === 1 &&
				stored.rows[0]?.owner_user_id === appUserId &&
				stored.rows[0]?.credential_hash === expectedHash,
			"database stores only the credential hash for the session owner",
		);

		const claim = randomUUID();
		await db.query(
			`with chat as (insert into next.doc_conversation (owner_user_id) values ($1) returning id)
			insert into next.doc_turn (conversation_id, owner_user_id, position, idempotency_key,
				request_hash, question, state, claim_id, claim_until, claim_state)
			select id, $1, 1, gen_random_uuid(), 'example', 'Find a deal', 'working', $2,
				clock_timestamp() + interval '60 seconds', '{"reads":0,"sources":{}}' from chat`,
			[appUserId, claim],
		);
		const mcp = await server.fetch(`${engineOrigin}/api/engine/doc/mcp`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${credential}`,
				"Doc-Claim-Id": claim,
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "find",
					arguments: { query: "Example Missing Deal", kind: "deal" },
				},
			}),
		});
		assert.equal(mcp.status, 200);
		assert.equal(mcp.headers.get("cache-control"), "no-store");
		assert.equal(
			(
				await server.fetch(`${appOrigin}/api/engine/doc/mcp`, {
					method: "POST",
					headers: {
						...first,
						...proof,
						Authorization: `Bearer ${credential}`,
					},
				})
			).status,
			404,
		);
		assert.deepEqual(await mcp.json(), {
			jsonrpc: "2.0",
			id: 1,
			result: { content: [{ type: "text", text: "[]" }] },
		});

		const completion = {
			claim_id: claim,
			kind: "answered",
			answer: {
				kind: "refusal",
				text: "I could not find that deal.",
				sources: [],
			},
		};
		const result = (headers: Record<string, string>, origin = engineOrigin) =>
			server.fetch(`${origin}${linkPath}/result`, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...headers },
				body: JSON.stringify(completion),
			});
		const bearer = { Authorization: `Bearer ${credential}` };
		assert.equal(
			(await result({ ...bearer, Cookie: first.Cookie })).status,
			401,
		);
		assert.equal((await result({ ...first, ...proof }, appOrigin)).status, 404);
		const done = await result(bearer);
		assert.equal(done.status, 204);
		assert.equal(done.headers.get("Cache-Control"), "no-store");
		assert.equal((await result(bearer)).status, 404);
		const { rows: turns } = await db.query(
			"select state, answer from next.doc_turn where owner_user_id = $1",
			[appUserId],
		);
		assert.deepEqual(turns, [
			{
				state: "answered",
				answer: { ...completion.answer, proposal: null },
			},
		]);

		assert.equal((await poll(wrongCredential)).status, 401);
		assert.equal(
			(await poll(credential, { Cookie: first.Cookie })).status,
			401,
		);
		assert.equal((await poll(credential, { Authorization: "" })).status, 401);
		assert.equal((await presence(first)).connected, false);
		const empty = await poll(credential);
		assert.equal(empty.status, 204);
		assert.equal(empty.headers.get("cache-control"), "no-store");
		assert.equal(await empty.text(), "");
		const status = await presence(first);
		assert.equal(status.connected, true);
		assert.ok(
			typeof status.issued_at === "string" &&
				Number.isFinite(Date.parse(status.issued_at)),
		);
		assert.deepEqual(await presence(second), {
			connected: false,
			issued_at: null,
		});
		await db.query(
			`update next.doc_link set last_seen_at = clock_timestamp() - interval '31 seconds'
			where owner_user_id = $1`,
			[appUserId],
		);
		assert.deepEqual(await presence(first), { ...status, connected: false });
		assert.equal((await poll(credential)).status, 204);
		assert.deepEqual(await presence(first), status);

		const otherCredential = await issue(second, `?owner_user_id=${appUserId}`);
		assert.equal((await poll(otherCredential)).status, 204);
		assert.equal((await presence(second)).connected, true);
		assert.equal(
			(await revoke(second, `?owner_user_id=${appUserId}`)).status,
			204,
		);
		assert.equal((await poll(otherCredential)).status, 401);
		assert.deepEqual(await presence(first), status);

		async function waitForBlockedRequest(
			request: Promise<unknown>,
			label: string,
			blocker?: number,
		) {
			let finished = false;
			const finish = () => {
				finished = true;
			};
			void request.then(finish, finish);
			const deadline = AbortSignal.timeout(5_000);
			while (!finished && !deadline.aborted) {
				const { rows } = await db.query<{ pid: number }>(
					`select pid from pg_locks
					where not granted
					and coalesce($1, pg_backend_pid()) = any(pg_blocking_pids(pid))`,
					[blocker ?? null],
				);
				if (rows[0]) return rows[0].pid;
			}
			assert.fail(`${label} did not wait for the row lock`);
		}

		async function queueLinkRequests<First, Second>(
			startFirst: () => Promise<First>,
			startSecond: () => Promise<Second>,
		) {
			await db.query("begin");
			await db.query(
				"select 1 from next.doc_link where owner_user_id = $1 for update",
				[appUserId],
			);
			const firstRequest = startFirst();
			let secondRequest: Promise<Second> | undefined;
			try {
				const firstPid = await waitForBlockedRequest(
					firstRequest,
					"First request",
				);
				secondRequest = startSecond();
				await waitForBlockedRequest(secondRequest, "Second request", firstPid);
			} finally {
				await db.query("rollback");
				await Promise.allSettled([firstRequest, secondRequest]);
			}
			return Promise.all([firstRequest, secondRequest]);
		}

		const [replacement, pollDuringRotation] = await queueLinkRequests(
			() => issue(first),
			() => poll(credential),
		);
		assert.equal(pollDuringRotation.status, 401);
		assert.equal((await poll(credential)).status, 401);
		assert.equal((await presence(first)).connected, false);
		assert.equal((await poll(replacement)).status, 204);
		assert.equal((await presence(first)).connected, true);
		const [revoked, pollDuringRevoke] = await queueLinkRequests(
			() => revoke(first),
			() => poll(replacement),
		);
		assert.equal(revoked.status, 204);
		assert.equal(pollDuringRevoke.status, 401);
		assert.equal((await revoke(first)).status, 204);
		assert.equal((await poll(replacement)).status, 401);
		assert.deepEqual(await presence(first), {
			connected: false,
			issued_at: null,
		});

		await t.test(
			"polls refresh presence at most every 15 seconds and keep their order with revoke",
			async () => {
				async function lastSeen() {
					const { rows } = await db.query<{ last_seen_at: string | null }>(
						"select last_seen_at::text from next.doc_link where owner_user_id = $1",
						[appUserId],
					);
					return rows[0]?.last_seen_at;
				}

				const credential = await issue(first);
				assert.equal((await poll(credential)).status, 204);
				const firstSeen = await lastSeen();
				assert.ok(firstSeen);
				assert.equal((await poll(credential)).status, 204);
				const secondSeen = await lastSeen();

				await db.query(
					`update next.doc_link set last_seen_at = clock_timestamp() - interval '16 seconds'
				where owner_user_id = $1`,
					[appUserId],
				);
				const agedSeen = await lastSeen();
				assert.equal((await poll(credential)).status, 204);
				const refreshedSeen = await lastSeen();
				assert.ok(refreshedSeen);
				assert.notEqual(refreshedSeen, agedSeen);
				assert.equal((await presence(first)).connected, true);

				const [pollBeforeRevoke, revoked] = await queueLinkRequests(
					() => poll(credential),
					() => revoke(first),
				);
				assert.equal(pollBeforeRevoke.status, 204);
				assert.equal(revoked.status, 204);
				assert.equal((await poll(credential)).status, 401);
				assert.equal(
					secondSeen,
					firstSeen,
					"a poll inside 15 seconds does not rewrite presence",
				);
			},
		);
	} finally {
		await server.close();
	}
});
