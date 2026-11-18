import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { type Caller, doorTest } from "../test-door.ts";

const { db, setup, cleanup, save: saveAt, request } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ALEX, BLAIR] = [id(1), id(2)];
const [CLIENT, MARKET, LEASE, PROPERTY] = [id(3), id(4), id(5), id(6)];
const partner = { user: "alex" };
const assistant = { job: "agent", for_user: "blair" };

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${ALEX}', 'person', 'Alex Example'), ('${BLAIR}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${ALEX}', 'alex'), ('${BLAIR}', 'blair');
		insert into phase values ('touring', 'Touring'), ('negotiation', 'Negotiation'), ('closed', 'Closed'), ('dead', 'Dead');
		insert into how_found values ('referral', 'Referral');
		insert into role values ('client', 'Client');
		insert into party (id, kind, name, how_found) values ('${CLIENT}', 'company', 'Example Clinic', 'referral');
		insert into party_role (party_id, role) values ('${CLIENT}', 'client');
		insert into market (id, name) values ('${MARKET}', 'Example Market');
		insert into property (id, address) values ('${PROPERTY}', '100 Example Way');
		insert into lease (id, party_id, property_id) values ('${LEASE}', '${CLIENT}', '${PROPERTY}');
		insert into deal_kind values ('lease', 'Lease');
		insert into deal_reason values ('renewal', 'Renewal');
		insert into deal (id, name, owner_user_id)
			select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Example Deal ' || n, '${ALEX}'
			from generate_series(10, 21) n;
		insert into deal_party (deal_id, party_id, role)
			select id, '${CLIENT}', 'client' from deal where id between '${id(15)}' and '${id(17)}';
		commit;`);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal_phase_change select id, '2026-01-05T15:00:00Z', 'touring', null from deal; commit;`);
});
after(cleanup);

const save = (caller: Caller, deal: string, args: object) =>
	saveAt(caller, `deals/${deal}/changes`, args);

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
	const [status, body] = await move({
		from: "negotiation",
		to: "dead",
		on: "2026-02-01",
	});
	assert.deepEqual(
		[status, body.rule],
		[422, "deal_phase_change_dead_has_reason"],
	);
});

const addArgs = {
	client_id: CLIENT,
	owner: "blair",
	phase: "touring",
};

for (const { title, caller, extras } of [
	{
		title: "a deal with unknown kind and reason",
		caller: assistant,
		extras: {},
	},
	{
		title: "a renewal",
		caller: partner,
		extras: {
			kind: "lease",
			reason: "renewal",
			market_id: MARKET,
			renews_lease_id: LEASE,
		},
	},
]) {
	test(`adding ${title} saves the deal, its client and first phase once`, async () => {
		const args = {
			...addArgs,
			...extras,
			idempotency_key: randomUUID(),
			name: `Example of ${title}`,
		};
		const result = await saveAt(caller, "deals", args);
		assert.equal(result[0], 201);
		const [, answer] = result;
		assert.deepEqual(await saveAt(caller, "deals", args), [
			200,
			{ ...answer, replayed: true },
		]);
		const { rows } = await db.query(
			`select d.id, d.kind, d.reason, d.market_id, d.renews_lease_id, d.changed_by_job,
				p.party_id, ph.phase, o.slug as owner, u.slug as acting_user
			from deal d join app_user o on o.id = d.owner_user_id
			left join app_user u on u.id = d.changed_by_user_id
			left join deal_party p on p.deal_id = d.id and p.role = 'client'
			left join deal_phase_change ph on ph.deal_id = d.id
			where d.name = $1`,
			[args.name],
		);
		assert.deepEqual(rows, [
			{
				id: answer.deal_id,
				kind: extras.kind ?? null,
				reason: extras.reason ?? null,
				market_id: extras.market_id ?? null,
				renews_lease_id: extras.renews_lease_id ?? null,
				changed_by_job: "job" in caller ? "agent" : null,
				party_id: CLIENT,
				phase: "touring",
				owner: "blair",
				acting_user: "user" in caller ? "alex" : null,
			},
		]);
		assert.equal(answer.change_id, await seen(String(answer.deal_id)));
		assert.equal(typeof answer.phase_changed_at, "string");
	});
}

for (const [label, fields, refusal] of [
	[
		"renewal without a lease",
		{ reason: "renewal" },
		"deal_renewal_names_lease",
	],
	[
		"lease without a renewal reason",
		{ renews_lease_id: LEASE },
		"deal_renewal_names_lease",
	],
	[
		"unknown lease",
		{ reason: "renewal", renews_lease_id: id(99) },
		"deal_renews_lease_id_fkey",
	],
	[
		"party without the client role",
		{ client_id: ALEX },
		"deal_party_client_is_a_client",
	],
	["ended phase", { phase: "closed" }, "invalid_field_value"],
	["unknown phase", { phase: "made_up" }, "deal_phase_change_phase_fkey"],
	["unknown owner", { owner: "nobody" }, "unknown_owner"],
] as const) {
	test(`adding a deal refuses ${label} and saves nothing`, async () => {
		const name = `Example refused add with ${label}`;
		const [code, body] = await saveAt(partner, "deals", {
			...addArgs,
			...fields,
			name,
			idempotency_key: randomUUID(),
		});
		assert.deepEqual(
			[code, body.rule ?? body.error],
			[refusal.startsWith("deal_") ? 422 : 400, refusal],
		);
		const { rowCount } = await db.query("select id from deal where name = $1", [
			name,
		]);
		assert.equal(rowCount, 0);
	});
}

const CLOSE_DATE = "2026-02-02";
const from = { from: "touring", on: CLOSE_DATE };

for (const { deal, caller, phase, fields, outcome, value } of [
	{
		deal: id(15),
		caller: partner,
		phase: { ...from, to: "closed" },
		fields: { closed_value: 2500.5 },
		outcome: "won",
		value: "2500.50",
	},
	{
		deal: id(16),
		caller: assistant,
		phase: { ...from, to: "closed" },
		fields: undefined,
		outcome: "won",
		value: null,
	},
	{
		deal: id(17),
		caller: partner,
		phase: { ...from, to: "dead", reason: "Client chose another site" },
		fields: undefined,
		outcome: "lost",
		value: null,
	},
]) {
	test(`a ${outcome} save with value ${value} lands once and appears on Deals`, async () => {
		const args = {
			idempotency_key: randomUUID(),
			seen_change_id: await seen(deal),
			phase,
			fields,
		};
		const [status, answer] = await save(caller, deal, args);
		assert.equal(status, 200);
		assert.equal(answer.phase_changed_at, "2026-02-02T06:00:00+00:00");
		assert.deepEqual(await save(caller, deal, args), [
			200,
			{ ...answer, replayed: true },
		]);

		const bindings = { DEALS_READ_SCHEMA: "next" };
		const board = await request(partner, "deals", { method: "GET" }, bindings);
		assert.equal(board.status, 200);
		const lists: Record<
			"closed_deals" | "lost_deals" | "deals",
			Record<string, unknown>[]
		> = await board.json();
		const ended = lists[outcome === "won" ? "closed_deals" : "lost_deals"].find(
			(row) => row.id === deal,
		);
		const lostReason = "reason" in phase ? phase.reason : null;
		assert.deepEqual(
			[ended?.outcome, ended?.closed_on, ended?.lost_reason],
			[outcome, CLOSE_DATE, lostReason],
		);
		assert.ok(!lists.deals.some((row) => row.id === deal));
		const page = await request(
			partner,
			`deals/${deal}`,
			{ method: "GET" },
			bindings,
		);
		assert.equal(page.status, 200);
		const detail: Record<string, unknown> = await page.json();
		assert.deepEqual(
			[
				detail.outcome,
				detail.closed_on,
				detail.lost_reason,
				detail.closed_value,
			],
			[outcome, CLOSE_DATE, lostReason, value],
		);
	});
}

for (const [number, label, phase, value, status, refusal] of [
	[
		18,
		"Won without a date",
		{ from: "touring", to: "closed" },
		200,
		400,
		"missing_required",
	],
	[
		19,
		"Lost without a date",
		{ from: "touring", to: "dead", reason: "Changed plans" },
		null,
		400,
		"missing_required",
	],
	[
		20,
		"Lost without a reason",
		{ ...from, to: "dead" },
		200,
		422,
		"deal_phase_change_dead_has_reason",
	],
	[
		21,
		"Won with zero value",
		{ ...from, to: "closed" },
		0,
		422,
		"deal_closed_value_check",
	],
] as const) {
	test(`${label} is refused and leaves the phase and value unchanged`, async () => {
		const deal = id(number);
		const fields = { closed_value: value };
		const [code, body] = await change(partner, deal, { phase, fields });
		assert.deepEqual([code, body.rule ?? body.error], [status, refusal]);
		assert.equal((await dealNow(deal)).phase, "touring");
		const { rows } = await db.query(
			"select closed_value from deal where id = $1",
			[deal],
		);
		assert.equal(rows[0].closed_value, null);
	});
}

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
