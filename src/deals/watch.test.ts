import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import { SESSION_COOKIE, withPartnerAuth } from "../partner-auth.ts";
import { readSchema } from "../test-copy.ts";
import { doorTest } from "../test-door.ts";
import { partnerApp } from "../worker.ts";

const { db, setup, cleanup, connectionString, readerUrl } = doorTest();
const origin = "https://app.example.test";
const secret = randomBytes(32).toString("hex");
const joe = randomUUID();
const dell = randomUUID();
const copied = randomUUID();
const native = randomUUID();
const sessions = new Map<string, { cookie: string; csrf: string }>();

before(async () => {
	await setup();
	await db.query(await readSchema("partner-auth.sql"));
	await db.query(`
		begin; set local engine.job = 'old_system';
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example Viewer'), ('${dell}', 'person', 'Example Owner');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into deal (id, name, owner_user_id) values
			('${copied}', 'Example copied deal', '${dell}'),
			('${native}', 'Example native deal', '${dell}');
		insert into outside_id (source, value, deal_id)
			values ('old_system', '${copied}', '${copied}'),
			       ('old_system_ref', 'EXAMPLE-1', '${native}');
		commit;
		insert into doctorcre_auth."user"
			(id, partner_user_id, name, email, "emailVerified", "createdAt", "updatedAt")
			select slug, id, 'Example Partner', slug || '@example.test', true, now(), now()
			from app_user where id in ('${joe}', '${dell}');
		insert into doctorcre_auth.account (id, "userId", "providerId", "accountId", "createdAt", "updatedAt")
			select id, id, 'google', id, now(), now() from doctorcre_auth."user";
	`);
	await withPartnerAuth(
		{ appOrigin: origin, connectionString, secret },
		async ({ auth }) => {
			const { internalAdapter } = await auth.$context;
			for (const slug of ["joe", "dell"]) {
				const { token } = await internalAdapter.createSession(slug);
				const {
					rows: [session],
				} = await db.query<{ csrfToken: string }>(
					'select "csrfToken" from doctorcre_auth.session where token = $1',
					[token],
				);
				assert.ok(session);
				const signature = createHmac("sha256", secret)
					.update(token)
					.digest("base64");
				sessions.set(slug, {
					cookie: `${SESSION_COOKIE}=${encodeURIComponent(`${token}.${signature}`)}`,
					csrf: session.csrfToken,
				});
			}
		},
	);
});
after(cleanup);

type Run = (partner: string, deal: string, input: object) => Promise<unknown>;

function request(
	run: Run,
	options: {
		slug?: string | null;
		deal?: string;
		body?: object;
		csrf?: boolean;
	} = {},
) {
	const { slug = "joe", deal = copied, body, csrf = true } = options;
	const session = slug ? sessions.get(slug) : undefined;
	return partnerApp.request(
		`${origin}/api/engine/deals/${deal}/watch`,
		{
			method: body ? "POST" : "GET",
			headers: {
				Origin: origin,
				"Sec-Fetch-Site": "same-origin",
				...(session && { Cookie: session.cookie }),
				...(session && csrf && { "x-carr-csrf": session.csrf }),
			},
			...(body && { body: JSON.stringify(body) }),
		},
		{
			DATABASE: { connectionString: readerUrl },
			PARTNER_AUTH_DATABASE: { connectionString },
			PARTNER_APP_ORIGIN: origin,
			PARTNER_AUTH_SECRET: secret,
			CARR_WATCH_SETTINGS: { run },
		},
	);
}

const policy = { change_kinds: ["reply_arrived"], include_self_changes: true };
const watch = {
	id: randomUUID(),
	actor_id: joe,
	subject_type: "deal",
	subject_id: copied,
	state: "watching",
	policy,
	lifecycle_version: 2,
	baseline: {
		schema_version: "subject-watch-baseline.v1",
		subject_type: "deal",
		subject_id: copied,
		version: 8,
	},
	subscribed_at: "2026-01-01T00:00:00Z",
};
const health = {
	status: "healthy",
	pending_count: 0,
	last_success_at: null,
	oldest_pending_at: null,
};
const v2 = { ok: true, schema_version: "subject-watch.v2", watch, health };
const edit = () => ({
	command: "pause",
	subscription_id: watch.id,
	base_version: watch.lifecycle_version,
	idempotency_key: randomUUID(),
});

test("a copied deal shows the signed-in partner's watch only", async () => {
	const run = mock.fn<Run>(async (partner) =>
		partner === "joe" ? v2 : { ...v2, watch: null, health: null },
	);
	const own = await request(run);
	assert.equal(own.status, 200);
	assert.deepEqual(await own.json(), { watch, health });
	assert.equal(own.headers.get("Cache-Control"), "no-store");
	const other = await request(run, { slug: "dell" });
	assert.equal(other.status, 200);
	assert.deepEqual(await other.json(), { watch: null, health: null });
	assert.deepEqual(
		run.mock.calls.map((call) => call.arguments),
		[
			["joe", copied, { command: "read" }],
			["dell", copied, { command: "read" }],
		],
	);
});

test("versioned saves return CARR's confirmed state and replay with the original key", async () => {
	const saved = {
		...v2,
		watch: { ...watch, state: "paused", lifecycle_version: 3 },
		rows_changed: 1,
	};
	const replayed = { ...saved, replayed: true };
	const run = mock.fn<Run>(async () => saved);
	run.mock.mockImplementationOnce(async () => replayed, 1);
	const body = edit();
	for (const expected of [saved, replayed]) {
		const response = await request(run, { body });
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), expected);
	}
	assert.deepEqual(
		run.mock.calls.map((call) => call.arguments),
		[
			["joe", copied, body],
			["joe", copied, body],
		],
	);
});

test("stale and other-partner subscription edits return the CARR conflict", async () => {
	const refused = { ok: false, error: "watch_stale_version" };
	const run = mock.fn<Run>(async () => refused);
	const stale = { ...edit(), base_version: 1 };
	const foreign = edit();
	for (const response of [
		await request(run, { body: stale }),
		await request(run, { slug: "dell", body: foreign }),
	]) {
		assert.equal(response.status, 409);
		assert.deepEqual(await response.json(), refused);
	}
	assert.deepEqual(
		run.mock.calls.map((call) => call.arguments),
		[
			["joe", copied, stale],
			["dell", copied, foreign],
		],
	);
});

test("the engine refuses absent proof, supplied identities, and non-copied deals before RPC", async () => {
	const run = mock.fn<Run>(async () => v2);
	assert.equal((await request(run, { slug: null })).status, 401);
	assert.equal((await request(run, { csrf: false, body: edit() })).status, 403);
	assert.equal(
		(await request(run, { slug: "dell", body: { ...edit(), partner: "joe" } }))
			.status,
		400,
	);
	assert.equal((await request(run, { deal: native })).status, 404);
	assert.equal(
		(await request(run, { deal: native, body: edit() })).status,
		404,
	);
	assert.equal((await request(run, { deal: randomUUID() })).status, 404);
	assert.equal(run.mock.callCount(), 0);
});

test("CARR missing targets and RPC failures have distinct statuses", async () => {
	const missing = { ok: false, error: "watch_target_not_found" };
	const response = await request(async () => missing);
	assert.equal(response.status, 404);
	assert.deepEqual(await response.json(), missing);
	for (const run of [
		async () => ({ ok: false, error: "actor_not_provisioned" }),
		async () => ({ ok: false, error: "unknown_partner" }),
		async () => {
			throw new Error("Fixture failure");
		},
	]) {
		const failed = await request(run);
		assert.equal(failed.status, 502);
		assert.deepEqual(await failed.json(), unavailable);
	}
});

const unavailable = { ok: false, error: "watch_settings_unavailable" };

test("invalid policies and versions are refused before RPC", async () => {
	const run = mock.fn<Run>(async () => ({ ...v2, rows_changed: 1 }));
	const start = { command: "watch", idempotency_key: randomUUID() };
	const replace = { ...edit(), command: "replace-policy" };
	const lease = { change_kinds: ["lease_threshold_crossed"] };
	for (const body of [
		{ ...start, policy: { ...lease, lease_threshold_days: [3651] } },
		{ ...replace, policy: { ...lease, lease_threshold_months: [121] } },
		{ ...replace, policy: { ...lease, lease_threshold_days: [1, 1] } },
		{ ...start, policy: lease },
		{ ...edit(), base_version: 2_147_483_648 },
	]) {
		const response = await request(run, { body });
		assert.equal(response.status, 400);
		assert.deepEqual(await response.json(), {
			ok: false,
			error: "invalid_request",
		});
	}
	assert.equal(run.mock.callCount(), 0);
});

test("a malformed save reply returns the generic upstream error", async () => {
	const body = edit();
	for (const reply of [
		{ ...v2, debug: "extra" },
		{ ...v2, rows_changed: 2 },
		{ ...v2, rows_changed: 1, watch: null },
		{ ...v2, rows_changed: 1, replayed: "yes" },
	]) {
		const response = await request(async () => reply, { body });
		assert.equal(response.status, 502);
		assert.deepEqual(await response.json(), unavailable);
	}
});

test("valid replies expose only public fields", async () => {
	const saved = { ...v2, rows_changed: 0, replayed: true };
	const reply = {
		...saved,
		watch: { ...watch, debug: "extra" },
		debug: "extra",
	};
	const response = await request(async () => reply, { body: edit() });
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), saved);
});
