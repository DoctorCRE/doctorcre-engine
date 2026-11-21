import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
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
		insert into job values ('call_capture', 'Example call capture');
		insert into party (id, kind, name) values ('${ALEX}', 'person', 'Alex Example'), ('${BLAIR}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${ALEX}', 'alex'), ('${BLAIR}', 'blair');
		insert into phase values ('touring', 'Touring'), ('negotiation', 'Negotiation'), ('closed', 'Closed'), ('dead', 'Dead');
		insert into how_found values ('referral', 'Referral');
		insert into role values ('client', 'Client'), ('client_contact', 'Client contact'), ('lead', 'Lead');
		insert into stage (role, slug, label) values ('lead', 'opportunity', 'Opportunity');
		insert into party (id, kind, name, how_found) values ('${CLIENT}', 'company', 'Example Clinic', 'referral');
		insert into party_role (party_id, role) values ('${CLIENT}', 'client');
		insert into market (id, name) values ('${MARKET}', 'Example Market');
		insert into property (id, address) values ('${PROPERTY}', '100 Example Way');
		insert into lease (id, party_id, property_id) values ('${LEASE}', '${CLIENT}', '${PROPERTY}');
		insert into deal_kind values ('lease', 'Lease');
		insert into deal_reason values ('renewal', 'Renewal');
		insert into deal (id, name, owner_user_id)
			select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Example Deal ' || n, '${ALEX}'
			from generate_series(10, 30) n;
		insert into deal_party (deal_id, party_id, role)
			select id, '${CLIENT}', 'client' from deal
			where id between '${id(15)}' and '${id(17)}' or id in ('${id(25)}', '${id(26)}', '${id(28)}', '${id(29)}');
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

test("the database reserves open names across partners and allows reuse after closing", async () => {
	const original = id(27);
	const name = "  example deal 27  ";
	const args = { name, client_id: CLIENT, owner: "blair", phase: "touring" };
	const add = () =>
		saveAt({ user: "blair" }, "deals", {
			...args,
			idempotency_key: randomUUID(),
		});

	const [duplicate, refusal] = await add();
	assert.deepEqual([duplicate, refusal.error], [409, "deal_name_exists"]);
	await db.query(
		"begin; select set_config('engine.job', 'old_system', true); set local role engine",
	);
	try {
		await db.query("set constraints deal_open_name_unique immediate");
		await assert.rejects(
			db.query("insert into deal (name, owner_user_id) values ($1, $2)", [
				name,
				BLAIR,
			]),
			{ code: "23505", constraint: "deal_open_name_unique" },
		);
	} finally {
		await db.query("rollback");
	}

	const [closed] = await change(partner, original, {
		phase: { from: "touring", to: "closed", on: "2026-04-01" },
	});
	assert.equal(closed, 200);
	assert.equal((await add())[0], 201);
	const [reopened, conflict] = await change(partner, original, {
		phase: { from: "closed", to: "touring" },
	});
	assert.deepEqual([reopened, conflict.error], [409, "deal_name_exists"]);
});

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

test("only an automatic phase move shows its source call and can be undone", async () => {
	const automaticDeal = id(28);
	const suggestedDeal = id(29);
	const caller = { job: "call_capture", for_user: "alex" };
	const happened_at = "2026-01-06T01:15:00+00:00";
	const [logged, call] = await saveAt(caller, "activities", {
		idempotency_key: randomUUID(),
		kind: "call",
		happened_at,
		about: [{ deal_id: automaticDeal }, { deal_id: suggestedDeal }],
	});
	assert.equal(logged, 201, JSON.stringify(call));
	const { activity_id } = call;
	const phase = { from: "touring", to: "negotiation", on: "2026-01-06" };
	const [missing, refusal] = await change(caller, automaticDeal, { phase });
	assert.deepEqual(
		[missing, refusal.error, refusal.fields],
		[400, "missing_required", ["phase.activity_id"]],
	);
	await db.query(
		"begin; select set_config('engine.job', 'call_capture', true)",
	);
	try {
		await assert.rejects(
			db.query(
				"insert into deal_phase_change (deal_id, happened_at, phase) values ($1, now(), 'negotiation')",
				[automaticDeal],
			),
			{ constraint: "deal_phase_change_call_source" },
		);
	} finally {
		await db.query("rollback");
	}
	const [wrongDeal, wrongCall] = await change(caller, id(30), {
		phase: { ...phase, activity_id },
	});
	assert.deepEqual(
		[wrongDeal, wrongCall.rule],
		[422, "deal_phase_change_call_on_deal"],
	);
	const event_id = randomUUID();
	const saveArgs = {
		idempotency_key: event_id,
		seen_change_id: await seen(automaticDeal),
		phase: { ...phase, activity_id },
	};
	const [partnerStatus, partnerRefusal] = await change(partner, automaticDeal, {
		phase: saveArgs.phase,
	});
	assert.deepEqual(
		[partnerStatus, partnerRefusal.error, partnerRefusal.rule],
		[422, "database_refused_the_statement", "deal_phase_change_call_source"],
	);
	const [saved, answer] = await save(caller, automaticDeal, saveArgs);
	assert.equal(saved, 200, JSON.stringify(answer));
	assert.deepEqual(await save(caller, automaticDeal, saveArgs), [
		200,
		{ ...answer, replayed: true },
	]);
	const [proposed, proposal] = await saveAt(caller, "proposals", {
		idempotency_key: randomUUID(),
		kind: "phase_move",
		deal_id: suggestedDeal,
		activity_id,
		evidence: "The client asked us to negotiate.",
		to: phase.to,
		on: phase.on,
	});
	assert.equal(proposed, 201, JSON.stringify(proposal));
	const [accepted, decision] = await saveAt(
		partner,
		`proposals/${proposal.proposal_id}/decision`,
		{ idempotency_key: randomUUID(), decision: "accept" },
	);
	assert.equal(accepted, 200, JSON.stringify(decision));
	const read = async (path: string) => {
		const response = await request(
			partner,
			path,
			{ method: "GET" },
			{ DEALS_READ_SCHEMA: "next" },
		);
		assert.equal(response.status, 200);
		const body: unknown = await response.json();
		assert.ok(isArguments(body));
		return body;
	};
	const automatic = await read(`deals/${automaticDeal}`);
	const receipt = automatic.phase_change;
	assert.ok(isArguments(receipt));
	assert.deepEqual(receipt, {
		event_id,
		prior_phase: phase.from,
		phase: phase.to,
		reason: null,
		evidence_date: phase.on,
		recorded_at: receipt.recorded_at,
		automatic: true,
		source: "call_capture",
		call: { activity_id, happened_at },
		undoable: true,
	});
	assert.ok(Number.isFinite(Date.parse(String(receipt.recorded_at))));
	assert.deepEqual((await read(`deals/${suggestedDeal}`)).phase_change, null);
	assert.partialDeepStrictEqual(await read("deals"), {
		deals: [
			{ id: automaticDeal, phase_change: receipt },
			{ id: suggestedDeal, phase: phase.to, phase_change: null },
		],
	});
	const undo = () =>
		saveAt(partner, `deals/${automaticDeal}/phase/undo`, {
			idempotency_key: randomUUID(),
			event_id,
			base_version: automatic.seen,
		});
	const [undone, restored] = await undo();
	assert.equal(undone, 200, JSON.stringify(restored));
	assert.partialDeepStrictEqual(await read(`deals/${automaticDeal}`), {
		phase: phase.from,
		phase_change: null,
	});
	assert.equal((await undo())[0], 409);
});

test("a partner can undo the current copied move once with a fresh card version", async () => {
	const deal = id(22);
	const event_id = id(23);
	const path = `deals/${deal}/phase/undo`;
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal_phase_change (deal_id, happened_at, phase)
		values ('${deal}', '2026-01-06', 'negotiation');
		insert into imported_automatic_phase_move (source_event_id, deal_id, happened_at, prior_phase, reason)
		values ('${event_id}', '${deal}', '2026-01-06', 'touring', 'Example automatic move');
		commit;`);
	const args = {
		idempotency_key: randomUUID(),
		event_id,
		base_version: await seen(deal),
	};
	assert.equal((await saveAt(assistant, path, args))[0], 404);
	assert.equal(
		(await change(partner, deal, { fields: { needs_attention: true } }))[0],
		200,
	);
	assert.equal((await saveAt(partner, path, args))[0], 409);

	const fresh = { ...args, base_version: await seen(deal) };
	const [wrongEventStatus, wrongEvent] = await saveAt(partner, path, {
		...fresh,
		idempotency_key: randomUUID(),
		event_id: randomUUID(),
	});
	assert.deepEqual(
		[wrongEventStatus, wrongEvent.error, wrongEvent.current_version],
		[409, "version_conflict", fresh.base_version],
	);
	const [status, answer] = await saveAt({ user: "blair" }, path, fresh);
	assert.equal(status, 200, JSON.stringify(answer));
	assert.partialDeepStrictEqual(answer, { deal_id: deal, phase: "touring" });
	assert.equal((await dealNow(deal)).phase, "touring");
	assert.deepEqual(await saveAt({ user: "blair" }, path, fresh), [
		200,
		{ ...answer, replayed: true },
	]);
	assert.equal(
		(
			await saveAt(partner, path, { ...fresh, idempotency_key: randomUUID() })
		)[0],
		409,
	);
	const history = await db.query(
		`select new_value ->> 'phase' as phase, changed_by_user_id
		from change where table_name = 'deal_phase_change'
		and record ->> 'deal_id' = $1 and changed_by_user_id is not null`,
		[deal],
	);
	assert.deepEqual(history.rows, [
		{ phase: "touring", changed_by_user_id: BLAIR },
	]);
});

for (const [name, number, phase, outcome] of [
	[
		"a copied loss stays in Lost without an automatic close or Undo",
		25,
		"closed",
		"lost",
	],
	[
		"a copied win uses the phase reason if its receipt has none and allows Undo",
		26,
		"dead",
		"won",
	],
] as const) {
	test(name, async () => {
		const deal = id(number);
		const event_id = randomUUID();
		await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal_phase_change (deal_id, happened_at, phase, reason)
		values ('${deal}', '2026-01-06', '${phase}', 'Example recorded phase');
		insert into imported_deal_board (deal_id, phase, phase_at, outcome)
		values ('${deal}', '${phase}', '2026-01-06', '${outcome}');
		insert into imported_automatic_phase_move (source_event_id, deal_id, happened_at, prior_phase, reason)
		values ('${event_id}', '${deal}', '2026-01-06', 'touring', '');
		commit;`);
		const read = async (path: string) => {
			const response = await request(
				partner,
				path,
				{ method: "GET" },
				{
					DEALS_READ_SCHEMA: "next",
				},
			);
			assert.equal(response.status, 200);
			return response.json();
		};
		const lost = outcome === "lost";
		const facts = {
			outcome,
			phase_change: lost
				? null
				: { event_id, reason: "Example recorded phase" },
		};
		assert.partialDeepStrictEqual(await read("deals"), {
			[lost ? "lost_deals" : "closed_deals"]: [{ id: deal, ...facts }],
		});
		assert.partialDeepStrictEqual(await read(`deals/${deal}`), facts);
		const [status, answer] = await saveAt(partner, `deals/${deal}/phase/undo`, {
			idempotency_key: randomUUID(),
			event_id,
			base_version: await seen(deal),
		});
		if (lost) {
			assert.deepEqual([status, answer.error], [409, "version_conflict"]);
		} else {
			assert.equal(status, 200, JSON.stringify(answer));
		}
		assert.equal((await dealNow(deal)).phase, lost ? phase : "touring");
	});
}

test("an invoice-dated copied close keeps its receipt and refuses phase Undo", async () => {
	const deal = id(30);
	const event_id = randomUUID();
	const invoiced_on = "2026-01-05";
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${CLIENT}', 'client');
		insert into deal_phase_change (deal_id, happened_at, phase)
		values ('${deal}', '2026-01-06T15:00Z', 'closed');
		insert into imported_automatic_phase_move (source_event_id, deal_id, happened_at, prior_phase, reason)
		values ('${event_id}', '${deal}', '2026-01-06T15:00Z', 'touring', 'Example automatic close');
		insert into imported_deal_invoiced (deal_id, invoiced_on) values ('${deal}', '${invoiced_on}');
		commit;`);
	const read = async (path: string) => {
		const response = await request(
			partner,
			path,
			{ method: "GET" },
			{ DEALS_READ_SCHEMA: "next" },
		);
		assert.equal(response.status, 200);
		const body: unknown = await response.json();
		assert.ok(isArguments(body));
		return body;
	};
	const beforeUndo = await read(`deals/${deal}`);
	const [status, body] = await saveAt(partner, `deals/${deal}/phase/undo`, {
		idempotency_key: randomUUID(),
		event_id,
		base_version: beforeUndo.seen,
	});
	assert.equal(status, 409, JSON.stringify(body));
	assert.partialDeepStrictEqual(body, {
		error: "version_conflict",
		current_version: beforeUndo.seen,
		hint: "Closed because an invoice was recorded; Undo isn't available",
	});
	assert.partialDeepStrictEqual(beforeUndo, {
		phase: "closed",
		invoiced_on,
		phase_change: { event_id, source: "copied", undoable: false },
	});
	const { phase, phase_change, seen: currentVersion } = beforeUndo;
	const facts = { phase, phase_change, invoiced_on, seen: currentVersion };
	assert.partialDeepStrictEqual(await read(`deals/${deal}`), facts);
	assert.partialDeepStrictEqual(await read("deals"), {
		closed_deals: [{ id: deal, ...facts }],
	});
});

for (const { deal, priorPhase } of [
	{ deal: id(23), priorPhase: "closed" },
	{ deal: id(24), priorPhase: "dead" },
]) {
	test(`undo refuses to put a deal back in ${priorPhase}`, async () => {
		const event_id = randomUUID();
		await db.query(`begin; select set_config('engine.job', 'old_system', true);
			insert into deal_phase_change (deal_id, happened_at, phase, reason)
			values ('${deal}', '2026-01-06', '${priorPhase}', 'Example deal ended'),
			       ('${deal}', '2026-01-07', 'negotiation', null);
			insert into imported_automatic_phase_move (source_event_id, deal_id, happened_at, prior_phase, reason)
			values ('${event_id}', '${deal}', '2026-01-07', '${priorPhase}', 'Example automatic move');
			commit;`);
		const base_version = await seen(deal);
		const [status, body] = await saveAt(partner, `deals/${deal}/phase/undo`, {
			idempotency_key: randomUUID(),
			event_id,
			base_version,
		});
		assert.equal(status, 409, JSON.stringify(body));
		assert.partialDeepStrictEqual(body, {
			error: "version_conflict",
			current_version: base_version,
			hint: "Undo would return this deal to Closed deals or Lost deals.",
		});
		assert.equal((await dealNow(deal)).phase, "negotiation");
	});
}

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

async function addProspect(name: string, note?: string) {
	const [status, prospect] = await saveAt(partner, "prospects", {
		idempotency_key: randomUUID(),
		name,
		kind: "person",
		how_found: "referral",
		note,
	});
	assert.equal(status, 201);
	assert.equal(typeof prospect.party_id, "string");
	return prospect;
}

const conversion = (name: string) => ({
	...addArgs,
	idempotency_key: randomUUID(),
	name,
});

test("turning a prospect into its own deal keeps its notes and follow-ups and can be retried", async () => {
	const note = "Example prospect note";
	const prospect = await addProspect("Example Prospect Client", note);
	const [stepStatus, step] = await saveAt(partner, "next-steps", {
		idempotency_key: randomUUID(),
		party_id: prospect.party_id,
		replaces: "current",
		seen_current_step: null,
		due_on: "2026-11-19",
		what: "Example follow-up",
	});
	assert.equal(stepStatus, 201);
	const inLane = async () => {
		const [status, lane] = await saveAt(partner, "prospects", {}, "GET");
		assert.equal(status, 200);
		assert.ok(Array.isArray(lane.prospects));
		return lane.prospects.some(
			(card: unknown) =>
				isArguments(card) && card.party_id === prospect.party_id,
		);
	};
	assert.equal(await inLane(), true);

	const args = {
		...conversion("Example Prospect's Deal"),
		prospect_id: prospect.party_id,
		client_id: String(prospect.party_id).toUpperCase(),
	};
	const [status, answer] = await saveAt(partner, "deals", args);
	assert.equal(status, 201);
	assert.equal(typeof answer.phase_changed_at, "string");
	assert.equal(answer.change_id, await seen(String(answer.deal_id)));
	assert.deepEqual(await saveAt(partner, "deals", args), [
		200,
		{ ...answer, replayed: true },
	]);
	assert.equal(await inLane(), false);
	assert.deepEqual(await dealNow(String(answer.deal_id)), {
		owner: "blair",
		needs_attention: false,
		by_user: "alex",
		by_job: null,
		for_user: null,
		phase: "touring",
	});
	assert.deepEqual(
		(
			await db.query(
				"select party_id, role, changed_by_user_id from deal_party where deal_id = $1",
				[answer.deal_id],
			)
		).rows,
		[{ party_id: prospect.party_id, role: "client", changed_by_user_id: ALEX }],
	);
	assert.deepEqual(
		(
			await db.query(
				`select a.summary from activity a join activity_about link on link.activity_id = a.id
			where a.id = $1 and link.party_id = $2`,
				[prospect.activity_id, prospect.party_id],
			)
		).rows,
		[{ summary: note }],
	);
	assert.deepEqual(
		(
			await db.query("select party_id, status from next_step where id = $1", [
				step.next_step_id,
			])
		).rows,
		[{ party_id: prospect.party_id, status: "open" }],
	);
	assert.equal(
		(await db.query("select id from deal where name = $1", [args.name]))
			.rowCount,
		1,
	);
});

test("a different existing party gains the client role and the prospect joins as client contact", async () => {
	const prospect = await addProspect("Example Prospect Contact");
	const clientId = randomUUID();
	await db.query("begin; set local engine.job = 'old_system'");
	await db.query(
		"insert into party (id, kind, name, how_found) values ($1, 'company', 'Example Selected Practice', 'referral')",
		[clientId],
	);
	await db.query("commit");
	const [status, answer] = await saveAt(partner, "deals", {
		...conversion("Example Existing Client Deal"),
		prospect_id: prospect.party_id,
		client_id: clientId,
	});
	assert.equal(status, 201);
	assert.deepEqual(
		(
			await db.query(
				`select p.party_id, p.role from deal_party p
			where p.deal_id = $1 order by p.role`,
				[answer.deal_id],
			)
		).rows,
		[
			{ party_id: clientId, role: "client" },
			{ party_id: prospect.party_id, role: "client_contact" },
		],
	);
	assert.deepEqual(
		(
			await db.query(
				"select role, changed_by_user_id from party_role where party_id = $1",
				[clientId],
			)
		).rows,
		[{ role: "client", changed_by_user_id: ALEX }],
	);
});

test("a new client, the deal and its prospect contact save together", async () => {
	const prospect = await addProspect("Example Prospect for New Client");
	const args = {
		idempotency_key: randomUUID(),
		name: "Example New Client Deal",
		owner: "blair",
		phase: "touring",
		prospect_id: prospect.party_id,
		client: {
			name: "Example New Practice",
			kind: "company",
			how_found: "referral",
		},
	};
	const [refused, error] = await saveAt(partner, "deals", {
		...args,
		phase: "made_up",
	});
	assert.deepEqual(
		[refused, error.rule],
		[422, "deal_phase_change_phase_fkey"],
	);
	assert.equal(
		(await db.query("select id from party where name = $1", [args.client.name]))
			.rowCount,
		0,
	);
	assert.equal(
		(await db.query("select id from deal where name = $1", [args.name]))
			.rowCount,
		0,
	);

	const [status, answer] = await saveAt(partner, "deals", args);
	assert.equal(status, 201);
	assert.deepEqual(
		(
			await db.query(
				`select p.name, p.kind, p.how_found from deal_party link
			join party p on p.id = link.party_id where link.deal_id = $1 and link.role = 'client'`,
				[answer.deal_id],
			)
		).rows,
		[args.client],
	);
	assert.deepEqual(
		(
			await db.query(
				"select party_id from deal_party where deal_id = $1 and role = 'client_contact'",
				[answer.deal_id],
			)
		).rows,
		[{ party_id: prospect.party_id }],
	);
});

test("Client Fit counts a prospect deal closed won with a new client", async () => {
	const prospect = await addProspect("Example Client Fit Prospect");
	const name = "Example Converted Win";
	const [created, deal] = await saveAt(partner, "deals", {
		idempotency_key: randomUUID(),
		name,
		owner: "blair",
		phase: "touring",
		kind: "lease",
		market_id: MARKET,
		prospect_id: prospect.party_id,
		client: {
			name: "Example New Client Fit Practice",
			kind: "company",
			how_found: "referral",
		},
	});
	assert.equal(created, 201);
	assert.ok(typeof deal.deal_id === "string");
	const {
		rows: [day],
	} = await db.query<{ today: string }>(
		"select (now() at time zone 'America/Chicago')::date::text as today",
	);
	assert.ok(day);
	const closed_on = day.today;
	const [closed, receipt] = await change(partner, deal.deal_id, {
		phase: { from: "touring", to: "closed", on: closed_on },
	});
	assert.equal(closed, 200, JSON.stringify(receipt));

	const board = await request(
		partner,
		"deals",
		{},
		{ DEALS_READ_SCHEMA: "next" },
	);
	assert.equal(board.status, 200);
	assert.partialDeepStrictEqual(await board.json(), {
		closed_deals: [{ id: deal.deal_id, outcome: "won", closed_on }],
	});

	const fit = await request(partner, "client-fit?city=Example%20Market", {});
	assert.equal(fit.status, 200);
	assert.partialDeepStrictEqual(await fit.json(), {
		profiles: [
			{
				clients: 1,
				won_deals: 1,
				evidence: [{ deal_id: deal.deal_id, deal_name: name, closed_on }],
			},
		],
	});
});

test("a conversion refuses a party outside the lane and only one concurrent save can convert a prospect", async () => {
	const [status, refusal] = await saveAt(partner, "deals", {
		...conversion("Example Refused Conversion"),
		prospect_id: randomUUID(),
	});
	assert.deepEqual([status, refusal.error], [409, "not_a_prospect"]);
	const prospect = await addProspect("Example Concurrent Prospect");
	const args = {
		...conversion("Example Concurrent Conversion"),
		prospect_id: prospect.party_id,
	};
	const [jobStatus, jobRefusal] = await saveAt(assistant, "deals", args);
	assert.deepEqual([jobStatus, jobRefusal.error], [400, "invalid_field_value"]);
	const results = await Promise.all([
		saveAt(partner, "deals", args),
		saveAt(partner, "deals", { ...args, idempotency_key: randomUUID() }),
	]);
	assert.deepEqual(results.map(([code]) => code).sort(), [201, 409]);
	assert.equal(
		results.find(([code]) => code === 409)?.[1].error,
		"not_a_prospect",
	);
});

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
