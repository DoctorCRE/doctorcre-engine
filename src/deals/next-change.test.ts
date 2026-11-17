import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { copyTest } from "../test-copy.ts";
import worker from "../worker.ts";

const { db, setup, cleanup, connectionString } = copyTest();
const writer = `deal_changes_${randomUUID().replaceAll("-", "")}`;
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ALEX, BLAIR] = [id(1), id(2)];
const TEAM = "https://example.cloudflareaccess.com";
const AUDIENCE = "made-up-jobs-audience";
const access = await generateKeyPair("RS256", { extractable: true });

before(async () => {
	mock.method(globalThis, "fetch", async () =>
		Response.json({
			keys: [{ ...(await exportJWK(access.publicKey)), kid: "made-up-kid" }],
		}),
	);
	await setup();
	await db.query(`create role ${writer} login; grant engine to ${writer};
		begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${ALEX}', 'person', 'Alex Example'), ('${BLAIR}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${ALEX}', 'alex'), ('${BLAIR}', 'blair');
		insert into phase values ('touring', 'Touring'), ('negotiation', 'Negotiation'), ('dead', 'Dead');
		insert into deal (id, name, owner_user_id)
			select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Example Deal ' || n, '${ALEX}'
			from generate_series(10, 14) n;
		commit;`);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal_phase_change select id, '2026-01-05T15:00:00Z', 'touring', null from deal; commit;`);
});
after(async () => {
	mock.restoreAll();
	await db.query(`drop owned by ${writer}; drop role ${writer}`);
	await cleanup();
});

const login = () => {
	const url = new URL(connectionString);
	url.username = writer;
	return url.href;
};

type Caller = { user: string } | { job: string; for_user?: string };
type Body = Record<string, unknown>;

async function save(
	caller: Caller,
	deal: string,
	args: object,
): Promise<[number, Body]> {
	const user = "user" in caller ? caller.user : undefined;
	const token = await new SignJWT({})
		.setProtectedHeader({ alg: "RS256", kid: "made-up-kid" })
		.setIssuer(TEAM)
		.setAudience(AUDIENCE)
		.setExpirationTime("5 minutes")
		.sign(access.privateKey);
	const headers: Record<string, string> =
		"job" in caller
			? {
					"Cf-Access-Jwt-Assertion": token,
					"Engine-Job": caller.job,
					...(caller.for_user && { "Engine-For-User": caller.for_user }),
				}
			: {
					Cookie: "__Host-dealroom_session=example",
					Origin: "https://engine.example.test",
					"Sec-Fetch-Site": "same-origin",
					"x-carr-csrf": "example",
				};
	const response = await worker.request(
		`https://engine.example.test/${user ? "api/engine" : "jobs"}/deals/${deal}/changes`,
		{ method: "POST", headers, body: JSON.stringify(args) },
		{
			DATABASE_WRITER: { connectionString: login() },
			ACCESS_TEAM_DOMAIN: TEAM,
			JOBS_ACCESS_AUD: AUDIENCE,
			CARR: {
				fetch: async () =>
					Response.json({
						actor: { slug: user, display: user },
						csrf_token: "example",
					}),
			},
		},
	);
	return [response.status, await response.json()];
}

const seen = async (deal: string) =>
	Number(
		(
			await db.query(
				`select coalesce(max(id), 0) as id from change
				where table_name = 'deal' and record = jsonb_build_object('id', $1::uuid)`,
				[deal],
			)
		).rows[0].id,
	);

// A save from the deal's latest change, as a caller that just read the board sends it.
const change = async (caller: Caller, deal: string, args: object) =>
	save(caller, deal, {
		idempotency_key: randomUUID(),
		seen_change_id: await seen(deal),
		...args,
	});

const dealNow = async (deal: string) =>
	(
		await db.query(
			`select o.slug as owner, d.needs_attention, by_user.slug as by_user, d.changed_by_job as by_job,
				for_user.slug as for_user, (select phase from deal_phase_change p where p.deal_id = d.id
					order by happened_at desc limit 1)
			from deal d join app_user o on o.id = d.owner_user_id
			left join app_user by_user on by_user.id = d.changed_by_user_id
			left join app_user for_user on for_user.id = d.changed_for_user_id
			where d.id = $1`,
			[deal],
		)
	).rows[0];

test("a partner's field change and phase move land once, stamped with the partner", async () => {
	const deal = id(10);
	const args = {
		idempotency_key: randomUUID(),
		seen_change_id: await seen(deal),
		fields: { owner: "blair", needs_attention: true },
		phase: { from: "touring", to: "negotiation" },
	};
	const [status, answer] = await save({ user: "alex" }, deal, args);
	assert.deepEqual(
		[status, answer],
		[
			200,
			{
				deal_id: deal,
				change_id: await seen(deal),
				phase_changed_at: answer.phase_changed_at,
			},
		],
	);
	assert.ok(String(answer.phase_changed_at) > "2026-01-05");
	assert.deepEqual(await dealNow(deal), {
		owner: "blair",
		needs_attention: true,
		by_user: "alex",
		by_job: null,
		for_user: null,
		phase: "negotiation",
	});
	assert.deepEqual(await save({ user: "alex" }, deal, args), [
		200,
		{ replayed: true, ...answer },
	]);
	const [reused, refusal] = await save({ user: "alex" }, deal, {
		...args,
		fields: { needs_attention: false },
	});
	assert.deepEqual([reused, refusal.error], [409, "key_reuse"]);
});

test("a move from a phase the deal has left is refused with the deal's phase", async () => {
	const deal = id(11);
	const from = { from: "touring", to: "negotiation" };
	await change({ user: "alex" }, deal, { phase: from });
	const [status, body] = await change({ user: "blair" }, deal, { phase: from });
	assert.deepEqual(
		[status, body.error, body.current_phase],
		[409, "version_conflict", "negotiation"],
	);
});

test("a job alone cannot park or flag a deal, but one working for a partner can", async () => {
	const deal = id(12);
	const [status, body] = await change({ job: "lead_stage" }, deal, {
		fields: { needs_attention: true },
	});
	assert.deepEqual(
		[status, body.error, body.rule],
		[422, "database_refused_the_statement", "deal_parked_or_flagged_by_a_user"],
	);
	const fields = { fields: { name: "Example" } };
	assert.equal((await change({ job: "lead_stage" }, deal, fields))[0], 200);
	const parked = await change({ job: "agent", for_user: "blair" }, deal, {
		fields: { parking_reason: "client_paused" },
	});
	assert.equal(parked[0], 200);
	assert.deepEqual(await dealNow(deal), {
		owner: "alex",
		needs_attention: false,
		by_user: null,
		by_job: "agent",
		for_user: "blair",
		phase: "touring",
	});
	const [unknown, refusal] = await change({ job: "made_up_job" }, deal, fields);
	assert.deepEqual([unknown, refusal.error], [403, "unknown_job"]);
});

test("a dated move lands on its day in Central time, never before the current phase began or after today", async () => {
	const deal = id(13);
	const move = (phase: object) =>
		change({ job: "lead_stage" }, deal, { phase });
	assert.deepEqual(
		await move({ from: "touring", to: "negotiation", on: "2026-02-01" }),
		[
			200,
			{
				deal_id: deal,
				change_id: await seen(deal),
				phase_changed_at: "2026-02-01T06:00:00+00:00",
			},
		],
	);
	for (const on of ["2026-01-31", "2999-01-01"]) {
		const [status, body] = await move({
			from: "negotiation",
			to: "touring",
			on,
		});
		assert.deepEqual(
			[status, body.error, body.fields],
			[400, "invalid_field_value", ["phase"]],
		);
	}
	const [status, body] = await move({ from: "negotiation", to: "dead" });
	assert.deepEqual(
		[status, body.rule],
		[422, "deal_phase_change_dead_has_reason"],
	);
});

test("a request missing or misnaming its arguments, or naming no known deal or owner, is refused", async () => {
	const refusal = async (deal: string, args: object) => {
		const [status, body] = await save({ user: "alex" }, deal, args);
		return [status, body.error, body.fields];
	};
	const key = randomUUID();
	assert.deepEqual(await refusal(id(14), { idempotency_key: key }), [
		400,
		"missing_required",
		["seen_change_id", "fields", "phase"],
	]);
	const misnamed = {
		idempotency_key: "not-a-key",
		seen_change_id: 0,
		fields: { owner: "", made_up: 1 },
		phase: { to: "dead" },
		extra: true,
	};
	assert.deepEqual(await refusal(id(14), misnamed), [
		400,
		"invalid_field_value",
		["idempotency_key", "fields", "phase", "extra"],
	]);
	const args = { idempotency_key: key, seen_change_id: 0, fields: {} };
	for (const deal of [id(99), "not-a-deal"])
		assert.deepEqual(await refusal(deal, args), [404, "not_found", undefined]);
	assert.deepEqual(
		await refusal(id(14), { ...args, fields: { owner: "nobody" } }),
		[400, "unknown_owner", undefined],
	);
});
