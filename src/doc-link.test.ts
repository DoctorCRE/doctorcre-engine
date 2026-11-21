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

test("two partners manage and connect their own Doc links", {
	timeout: 30_000,
}, async (t) => {
	const { db, setup, cleanup, connectionString } = copyTest();
	await setup();
	t.after(cleanup);
	await db.query("drop table next.doc_link");
	await db.query(await readSchema("add-doc-link.sql"));
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
					durable_objects: {
						bindings: [{ name: "DOC_LINK", class_name: "DocLink" }],
					},
					migrations: [{ tag: "doc-link-v1", new_sqlite_classes: ["DocLink"] }],
					hyperdrive: [
						{
							binding: "DATABASE_WRITER",
							id: "test-writer",
							localConnectionString: localDatabase.href,
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
		const connect = (
			credential: string,
			headers: Record<string, string> = {},
		) =>
			server.fetch(`${engineOrigin}${linkPath}/connect`, {
				headers: {
					Upgrade: "websocket",
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
		async function open(credential: string) {
			const response = await connect(credential);
			assert.equal(response.status, 101);
			assert.ok(response.webSocket);
			const socket = response.webSocket;
			const closed = new Promise<number>((resolve) => {
				const aborted = () => resolve(-1);
				t.signal.addEventListener("abort", aborted, { once: true });
				socket.addEventListener(
					"close",
					(event) => {
						t.signal.removeEventListener("abort", aborted);
						resolve(event.code);
					},
					{ once: true },
				);
			});
			socket.accept();
			return { socket, closed };
		}
		const revoke = (partner: typeof first, suffix = "") =>
			send({ ...partner, ...proof }, "POST", `/revoke${suffix}`);

		assert.equal((await send({})).status, 401);
		assert.equal((await send(first, "POST")).status, 403);
		assert.equal((await send(first, "POST", "/revoke")).status, 403);
		assert.equal((await send(first, "GET", "/connect")).status, 404);
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

		assert.equal(
			(await connect(randomBytes(32).toString("base64url"))).status,
			401,
		);
		assert.equal(
			(await connect(credential, { Cookie: first.Cookie })).status,
			401,
		);
		const original = await open(credential);
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

		const otherCredential = await issue(second, `?owner_user_id=${appUserId}`);
		const other = await open(otherCredential);
		assert.equal((await presence(second)).connected, true);
		assert.equal(
			(await revoke(second, `?owner_user_id=${appUserId}`)).status,
			204,
		);
		assert.equal((await connect(otherCredential)).status, 401);
		assert.deepEqual(await presence(first), status);

		const replacementSocket = await open(credential);
		assert.equal((await presence(first)).connected, true);
		replacementSocket.socket.close(1000, "Mac disconnected");
		await replacementSocket.closed;
		assert.deepEqual(await presence(first), { ...status, connected: false });

		const reconnected = await open(credential);
		const replacementCredential = await issue(first);
		assert.equal((await connect(credential)).status, 401);
		assert.equal((await presence(first)).connected, false);
		const rotated = await open(replacementCredential);
		assert.equal((await revoke(first)).status, 204);
		assert.equal((await revoke(first)).status, 204);
		assert.equal((await connect(replacementCredential)).status, 401);
		assert.deepEqual(await presence(first), {
			connected: false,
			issued_at: null,
		});
		assert.deepEqual(
			await Promise.all([
				original.closed,
				other.closed,
				reconnected.closed,
				rotated.closed,
			]),
			[1008, 1008, 1008, 1008],
		);
	} finally {
		await server.close();
	}
});
