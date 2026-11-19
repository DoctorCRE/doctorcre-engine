import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { type Caller, doorTest } from "./test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ALEX, BLAIR, CLIENT, CADENCE_CLIENT, DEAL, PROPERTY] = [
	id(1),
	id(2),
	id(3),
	id(4),
	id(10),
	id(11),
];
const OLD_ROLES = [
	{ kind: "lead", id: id(20), party_id: id(30) },
	{ kind: "client", id: id(21), party_id: id(31) },
	{ kind: "vendor", id: id(22), party_id: id(32) },
] as const;
const OTHER_SOURCE_VENDOR_ID = id(23);
const ITEM = {
	title: "Example plan sent",
	bullets: ["First example point"],
	source_ref: "example:call",
};
const REPLACEMENT_DEAL = id(13);
// The dated facts the old system writes on a post-call item, which the copy keeps.
const FACTS = [
	{ date: null, kind: "call", text: "Example first fact" },
	{ date: "2025-01-01", kind: "call", text: "Example second fact" },
];

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into job values ('cadence', 'Example cadence'), ('call_capture', 'Example call capture');
		insert into party (id, kind, name) values ('${ALEX}', 'person', 'Alex Example'),
			('${BLAIR}', 'person', 'Blair Example'), ('${CLIENT}', 'company', 'Example Clinic'),
			('${CADENCE_CLIENT}', 'company', 'Example Practice');
		insert into app_user (id, slug) values ('${ALEX}', 'alex'), ('${BLAIR}', 'blair');
		insert into deal (id, name, owner_user_id) values ('${DEAL}', 'Example Deal', '${ALEX}'),
			('${REPLACEMENT_DEAL}', 'Example Replacement Deal', '${ALEX}');
		insert into property (id, address) values ('${PROPERTY}', 'Example Property');
		insert into role (slug, label) values ('lead', 'Lead'), ('client', 'Client'), ('vendor', 'Vendor');
		insert into stage (role, slug, label) values ('lead', 'new', 'New');
		insert into how_found (slug, label) values ('inbound', 'Inbound');
		${OLD_ROLES.map(
			({ kind, id, party_id }) => `
			insert into party (id, kind, name, how_found)
			values ('${party_id}', 'company', 'Example ${kind}', 'inbound');
			insert into party_role (party_id, role, stage)
			values ('${party_id}', '${kind}', ${kind === "lead" ? "'new'" : "null"});
			${kind === "client" ? `insert into client (party_id) values ('${party_id}');` : ""}
			insert into outside_id (source, value, party_id)
			values ('old_system', '${id}', '${party_id}');`,
		).join("")}
		insert into outside_id (source, value, party_id)
		values ('other_source', '${OTHER_SOURCE_VENDOR_ID}', '${OLD_ROLES[2].party_id}');
		commit;`);
});
after(cleanup);

const seen = async (step: unknown) =>
	Number(
		(
			await db.query(
				`select coalesce(max(id), 0) as id from change
				where table_name = 'next_step' and record = jsonb_build_object('id', $1::uuid)`,
				[step],
			)
		).rows[0].id,
	);

const stepNow = async (step: unknown) =>
	(
		await db.query(
			`select s.what, s.owner_party_id, s.due_on::text, s.hold_until::text, s.item_title, s.item_bullets, s.status, s.resolution_reason,
				s.done_at is not null as done, s.resolved_at is not null as resolved, s.resolution_event_id,
				by_user.slug as by_user, s.changed_by_job as by_job, for_user.slug as for_user
			from next_step s
			left join app_user by_user on by_user.id = s.changed_by_user_id
			left join app_user for_user on for_user.id = s.changed_for_user_id
			where s.id = $1`,
			[step],
		)
	).rows[0];

const create = (caller: Caller, args: object) =>
	save(caller, "next-steps", { idempotency_key: randomUUID(), ...args });

async function newStep(args: object = {}) {
	const deal = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Deal', '${ALEX}'); commit;`);
	const [status, body] = await create(
		{ user: "alex" },
		{ deal_id: deal, what: "Call the example clinic", ...args },
	);
	assert.equal(status, 201);
	return String(body.next_step_id);
}

const act = async (step: string, door: string, args: object) =>
	save({ user: "alex" }, `next-steps/${step}/${door}`, {
		idempotency_key: randomUUID(),
		...((door === "end" || door === "reopen") && {
			base_version: await seen(step),
		}),
		...args,
	});

test("a call-produced step keeps its source and leaves Home when completed", async () => {
	const callId = id(12);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into activity (id, kind, happened_at) values ('${callId}', 'call', '2025-01-01');
		insert into activity_about (activity_id, deal_id) values ('${callId}', '${DEAL}'); commit;`);
	const caller = { job: "call_capture", for_user: "alex" };
	const call = { activity_id: callId, evidence_quote: "Please send the plan." };
	const [wrongDeal] = await create(caller, {
		party_id: CLIENT,
		what: "Send the plan",
		call,
	});
	assert.equal(wrongDeal, 422);
	const [status, step] = await create(caller, {
		deal_id: DEAL,
		what: "Send the plan",
		call,
	});
	assert.equal(status, 201);
	const read = () =>
		db.query(
			"select call_activity_id, call_evidence_quote from home_next_step where id = $1",
			[step.next_step_id],
		);
	assert.deepEqual((await read()).rows, [
		{ call_activity_id: callId, call_evidence_quote: call.evidence_quote },
	]);
	assert.equal(
		(await act(String(step.next_step_id), "end", { resolution: "done" }))[0],
		200,
	);
	assert.equal((await read()).rowCount, 0);
	assert.equal((await act(String(step.next_step_id), "reopen", {}))[0], 200);
	assert.equal((await read()).rowCount, 1);
	assert.equal(
		(await act(String(step.next_step_id), "end", { resolution: "done" }))[0],
		200,
	);
});

test("the assistant completes its sponsoring owner's ordinary step on a named deal", async () => {
	const next_step_id = await newStep({ hold_until: "2035-01-01" });
	const {
		rows: [step],
	} = await db.query("select deal_id from next_step where id = $1", [
		next_step_id,
	]);
	const args = { idempotency_key: randomUUID(), deal_id: step.deal_id };
	const agent = { job: "agent", for_user: "alex" };
	const created = await Promise.all([
		create(
			{ user: "blair" },
			{ deal_id: step.deal_id, what: "Ask the lender" },
		),
		create(
			{ user: "alex" },
			{ deal_id: step.deal_id, what: "Gather example files", item: ITEM },
		),
	]);
	assert.deepEqual(
		created.map(([status]) => status),
		[201, 201],
	);
	const complete = (key: string) =>
		save(agent, "next-steps/complete", { ...args, idempotency_key: key });
	const answer = { next_step_id, status: "done" };
	assert.deepEqual(await complete(args.idempotency_key), [200, answer]);
	assert.deepEqual(await complete(args.idempotency_key), [
		200,
		{ ...answer, replayed: true },
	]);
	const done = await stepNow(next_step_id);
	assert.deepEqual(
		[done.done, done.by_job, done.for_user],
		[true, "agent", "alex"],
	);
	const [status, body] = await complete(randomUUID());
	assert.deepEqual([status, body.error], [409, "no_open_step"]);
	const { rows } = await db.query(
		"select status, count(*)::int from next_step where deal_id = $1 group by status order by status",
		[step.deal_id],
	);
	assert.deepEqual(rows, [
		{ status: "done", count: 1 },
		{ status: "open", count: 2 },
	]);
});

test("a completion naming both a deal and a party returns 400", async () => {
	const [status, answer] = await save({ user: "alex" }, "next-steps/complete", {
		idempotency_key: randomUUID(),
		deal_id: DEAL,
		party_id: CLIENT,
	});
	assert.deepEqual([status, answer.error], [400, "invalid_field_value"]);
});

test("a partner can complete their step on a party and a missing party is refused", async () => {
	const caller = { user: "blair" };
	const party_id = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${party_id}', 'company', 'Example Office'); commit;`);
	const [status, step] = await create(caller, {
		party_id,
		what: "Call the example office",
	});
	assert.equal(status, 201);
	const complete = (id: string) =>
		save(caller, "next-steps/complete", {
			idempotency_key: randomUUID(),
			party_id: id,
		});
	assert.deepEqual(await complete(party_id), [
		200,
		{ next_step_id: step.next_step_id, status: "done" },
	]);
	const [missing, refusal] = await complete(randomUUID());
	assert.deepEqual([missing, refusal.error], [404, "not_found"]);
});

test("replacing a held party step spares the other owner and replay spares the newest step", async () => {
	const agent = { job: "agent", for_user: "alex" };
	const party_id = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${party_id}', 'company', 'Example Office'); commit;`);
	const target = { party_id };
	const [firstStatus, first] = await create(agent, {
		...target,
		what: "Check the measurements",
		hold_until: "2035-01-01",
	});
	const [otherStatus, other] = await create(
		{ user: "blair" },
		{
			...target,
			what: "Ask about parking",
		},
	);
	assert.deepEqual([firstStatus, otherStatus], [201, 201]);
	const [conflict, refused] = await create(agent, {
		...target,
		what: "Send the floor plan",
	});
	assert.deepEqual(
		[conflict, refused.error, refused.next_step_id],
		[409, "open_step_exists", first.next_step_id],
	);
	const request = {
		...target,
		idempotency_key: randomUUID(),
		what: "Send the floor plan",
		replaces: "current",
	};
	const [replaced, answer] = await save(agent, "next-steps", request);
	assert.equal(replaced, 201);
	assert.equal((await stepNow(first.next_step_id)).status, "cancelled");
	assert.equal((await stepNow(other.next_step_id)).status, "open");
	assert.equal((await stepNow(answer.next_step_id)).status, "open");
	const [latestStatus, latest] = await save(agent, "next-steps", {
		...request,
		idempotency_key: randomUUID(),
		what: "Confirm the tour",
	});
	assert.equal(latestStatus, 201);
	assert.deepEqual(await save(agent, "next-steps", request), [
		201,
		{ ...answer, replayed: true },
	]);
	assert.equal((await stepNow(latest.next_step_id)).status, "open");
});

test("a deal replacement uses the signed-in partner's version from the deal page", async () => {
	const alex = { user: "alex" };
	const blair = { user: "blair" };
	const target = { deal_id: REPLACEMENT_DEAL, what: "Send the survey" };
	const [otherStatus, other] = await create(blair, target);
	const [itemStatus, item] = await create(alex, { ...target, item: ITEM });
	assert.deepEqual([otherStatus, itemStatus], [201, 201]);
	const replace = { ...target, replaces: "current" };
	const [missing, required] = await create(alex, replace);
	assert.deepEqual(
		[missing, required.error, required.fields],
		[400, "missing_required", ["seen_current_step"]],
	);
	const [firstStatus, first] = await create(alex, {
		...replace,
		seen_current_step: null,
	});
	assert.equal(firstStatus, 201);
	const read = async () => {
		const response = await request(
			alex,
			`deals/${REPLACEMENT_DEAL}`,
			{ method: "GET" },
			{ DEALS_READ_SCHEMA: "next" },
		);
		assert.equal(response.status, 200);
		return response.json();
	};
	assert.partialDeepStrictEqual(await read(), {
		next_actions: [
			{ id: other.next_step_id, owner: "blair", change_id: other.change_id },
			{ id: item.next_step_id, title: ITEM.title, change_id: item.change_id },
			{ id: first.next_step_id, owner: "alex", change_id: first.change_id },
		],
	});
	const version = (step: typeof first) => ({
		next_step_id: step.next_step_id,
		change_id: step.change_id,
	});
	const [wrongOwner, invalid] = await create(alex, {
		...replace,
		owner: blair.user,
		seen_current_step: version(other),
	});
	assert.deepEqual([wrongOwner, invalid.error], [400, "invalid_field_value"]);
	const [editStatus, edit] = await act(String(first.next_step_id), "changes", {
		seen_change_id: first.change_id,
		what: "Send the revised survey",
	});
	assert.equal(editStatus, 200);
	for (const stale of [
		null,
		{ ...version(other), change_id: edit.change_id },
		version(first),
	]) {
		const [status, conflict] = await create(alex, {
			...replace,
			seen_current_step: stale,
		});
		assert.deepEqual(
			[status, conflict.error, conflict.current_version],
			[409, "version_conflict", edit.change_id],
		);
	}
	assert.partialDeepStrictEqual(await read(), {
		next_actions: [{ id: first.next_step_id, change_id: edit.change_id }],
	});
	const current = { ...replace, seen_current_step: version(edit) };
	const answers = await Promise.all([
		create(alex, current),
		create(alex, current),
	]);
	assert.deepEqual(answers.map(([status]) => status).sort(), [201, 409]);
	const winner = answers.find(([status]) => status === 201)?.[1];
	const conflict = answers.find(([status]) => status === 409)?.[1];
	assert.ok(winner && conflict);
	assert.deepEqual(
		[conflict.error, conflict.current_version],
		["version_conflict", winner.change_id],
	);
	assert.equal((await stepNow(first.next_step_id)).status, "cancelled");
	assert.equal((await stepNow(other.next_step_id)).status, "open");
	assert.equal((await stepNow(item.next_step_id)).status, "open");
	const [endStatus] = await act(String(winner.next_step_id), "end", {
		resolution: "done",
	});
	assert.equal(endStatus, 200);
	assert.partialDeepStrictEqual(await read(), {
		next_actions: [{ id: winner.next_step_id, change_id: null }],
	});
	const [ended, endedConflict] = await create(alex, {
		...replace,
		seen_current_step: version(winner),
	});
	assert.deepEqual(
		[ended, endedConflict.error, endedConflict.current_version],
		[409, "version_conflict", null],
	);
});

test("a versioned deal replacement requires a job to name a partner", async () => {
	const [status, answer] = await create(
		{ job: "agent" },
		{
			deal_id: REPLACEMENT_DEAL,
			what: "Send the survey",
			replaces: "current",
			seen_current_step: null,
		},
	);
	assert.deepEqual([status, answer.error], [422, "actor_not_provisioned"]);
});

for (const { kind, id, party_id } of OLD_ROLES) {
	test(`a copied ${kind} role ID replaces and completes its party's step`, async () => {
		const agent = { job: "agent", for_user: "alex" };
		const [firstStatus, first] = await create(agent, {
			party_id,
			what: "Check the measurements",
		});
		assert.equal(firstStatus, 201);
		const old_role = { kind, id };
		const [status, step] = await create(agent, {
			old_role,
			what: "Send the floor plan",
			replaces: "current",
		});
		assert.equal(status, 201);
		assert.equal(step.party_id, party_id);
		assert.equal((await stepNow(first.next_step_id)).status, "cancelled");
		const args = { idempotency_key: randomUUID(), old_role };
		const answer = {
			next_step_id: step.next_step_id,
			status: "done",
			party_id,
		};
		assert.deepEqual(await save(agent, "next-steps/complete", args), [
			200,
			answer,
		]);
		assert.equal((await stepNow(step.next_step_id)).status, "done");
		assert.deepEqual(await save(agent, "next-steps/complete", args), [
			200,
			{ ...answer, replayed: true },
		]);
	});
}

async function assertOldRoleNotFound(old_role: object) {
	const agent = { job: "agent", for_user: "blair" };
	for (const path of ["next-steps", "next-steps/complete"]) {
		const [status, answer] = await save(agent, path, {
			idempotency_key: randomUUID(),
			old_role,
			...(path === "next-steps" && { what: "Send the floor plan" }),
		});
		assert.deepEqual([status, answer.error], [404, "old_role_not_found"]);
	}
}

test("an unknown old role ID or a mismatched kind is refused", async () => {
	await assertOldRoleNotFound({ kind: "vendor", id: OLD_ROLES[2].party_id });
	await assertOldRoleNotFound({ kind: "vendor", id: OLD_ROLES[0].id });
});

test("a vendor ID from another source is refused as an old role ID", async () => {
	await assertOldRoleNotFound({ kind: "vendor", id: OTHER_SOURCE_VENDOR_ID });
});

test("a partner's checklist item lands once on its deal, stamped with the partner", async () => {
	const args = {
		idempotency_key: randomUUID(),
		deal_id: DEAL,
		what: "Send the example plan",
		due_on: "2026-02-01",
		item: ITEM,
	};
	const [status, answer] = await save({ user: "blair" }, "next-steps", args);
	assert.deepEqual(
		[status, answer],
		[
			201,
			{
				next_step_id: answer.next_step_id,
				change_id: await seen(answer.next_step_id),
			},
		],
	);
	assert.deepEqual(await stepNow(answer.next_step_id), {
		what: "Send the example plan",
		owner_party_id: BLAIR,
		due_on: "2026-02-01",
		hold_until: null,
		item_title: ITEM.title,
		item_bullets: ITEM.bullets,
		status: "open",
		resolution_reason: null,
		done: false,
		resolved: false,
		resolution_event_id: null,
		by_user: "blair",
		by_job: null,
		for_user: null,
	});
	assert.deepEqual(await save({ user: "blair" }, "next-steps", args), [
		201,
		{ replayed: true, ...answer },
	]);
	const [reused, refusal] = await save({ user: "blair" }, "next-steps", {
		...args,
		what: "Another example",
	});
	assert.deepEqual([reused, refusal.error], [409, "key_reuse"]);
});

test("a job for a partner adds a held step on a party; an item off a deal, two records or an unknown one are refused", async () => {
	const agent = { job: "agent", for_user: "blair" };
	const [status, answer] = await create(agent, {
		party_id: CLIENT,
		what: "Ask the example clinic about space",
		hold_until: "2026-03-01",
	});
	assert.equal(status, 201);
	const step = await stepNow(answer.next_step_id);
	assert.deepEqual(
		[
			step.hold_until,
			step.by_user,
			step.by_job,
			step.for_user,
			step.owner_party_id,
		],
		["2026-03-01", null, "agent", "blair", BLAIR],
	);
	const refused = async (args: object) => {
		const [status, body] = await create(agent, { what: "Example", ...args });
		return [status, body.error, body.rule];
	};
	const shape = [422, "database_refused_the_statement", "next_step_item_shape"];
	assert.deepEqual(await refused({ party_id: CLIENT, item: ITEM }), shape);
	assert.deepEqual(
		await refused({ deal_id: DEAL, item: { ...ITEM, title: "Example" } }),
		shape,
	);
	assert.deepEqual(await refused({ deal_id: DEAL, party_id: CLIENT }), [
		422,
		"database_refused_the_statement",
		"next_step_one_record",
	]);
	assert.deepEqual(await refused({ deal_id: id(99) }), [
		404,
		"not_found",
		undefined,
	]);
});

test("an explicit next-step owner wins over the saving partner", async () => {
	const step = await newStep({ owner_party_id: BLAIR });
	assert.equal((await stepNow(step)).owner_party_id, BLAIR);
});

test("cadence and a partner saving together get one held step and its conflict id", async () => {
	const step = {
		party_id: CADENCE_CLIENT,
		what: "Check in",
		hold_until: "2099-01-01",
	};
	const answers = await Promise.all([
		create({ user: "alex" }, step),
		create({ job: "cadence", for_user: "alex" }, step),
	]);
	assert.deepEqual(answers.map(([status]) => status).sort(), [201, 409]);
	const winner = answers.find(([status]) => status === 201)?.[1];
	const conflict = answers.find(([status]) => status === 409)?.[1];
	assert.ok(winner && conflict);
	assert.deepEqual(
		[conflict.error, conflict.next_step_id],
		["open_step_exists", winner.next_step_id],
	);
	const change = await act(String(winner.next_step_id), "changes", {
		seen_change_id: await seen(winner.next_step_id),
		owner_party_id: BLAIR,
	});
	assert.equal(change[0], 200);
	const [replacementStatus, replacement] = await create({ user: "alex" }, step);
	assert.equal(replacementStatus, 201);
	const [changed, denied] = await act(String(winner.next_step_id), "changes", {
		seen_change_id: await seen(winner.next_step_id),
		owner_party_id: ALEX,
	});
	assert.deepEqual(
		[changed, denied.error, denied.next_step_id],
		[409, "open_step_exists", replacement.next_step_id],
	);
	await act(String(winner.next_step_id), "end", { resolution: "done" });
	assert.equal((await create({ user: "blair" }, step))[0], 201);
	const [reopened, reopen] = await act(
		String(winner.next_step_id),
		"reopen",
		{},
	);
	assert.deepEqual([reopened, reopen.error], [409, "open_step_exists"]);
	assert.equal((await stepNow(winner.next_step_id)).status, "done");
});

test("the database enforces the owner slot and allows checklist, property and ownerless steps", async () => {
	const values = (
		rows: string,
	) => `begin; select set_config('engine.job', 'old_system', true);
		insert into next_step (what, deal_id, party_id, property_id, owner_party_id, item_title, source_ref)
		values ${rows}`;
	try {
		await db.query(
			values(`
			('Example ordinary', '${DEAL}', null, null, '${ALEX}', null, null),
			('Example checklist', '${DEAL}', null, null, '${ALEX}', 'Example item', 'example:one'),
			('Example checklist', '${DEAL}', null, null, '${ALEX}', 'Example item', 'example:two'),
			('Example property', null, null, '${PROPERTY}', '${ALEX}', null, null),
			('Example property', null, null, '${PROPERTY}', '${ALEX}', null, null),
			('Example unclaimed', '${DEAL}', null, null, null, null, null),
			('Example unclaimed', '${DEAL}', null, null, null, null, null)`),
		);
		await assert.rejects(
			db.query(`insert into next_step (what, deal_id, owner_party_id)
			values ('Example duplicate', '${DEAL}', '${ALEX}')`),
			{ code: "23505" },
		);
	} finally {
		await db.query("rollback");
	}
});

test("a change lands from what the caller saw; a crossed field is refused and other fields rebase", async () => {
	const step = await newStep({ item: ITEM });
	const first = await seen(step);
	const [status, answer] = await act(step, "changes", {
		seen_change_id: first,
		what: "Call the example clinic back",
		item_bullets: ["Second example point"],
	});
	assert.deepEqual(
		[status, answer],
		[200, { next_step_id: step, change_id: await seen(step) }],
	);
	const second = await seen(step);
	assert.deepEqual(
		await act(step, "changes", { seen_change_id: first, due_on: "2026-04-01" }),
		[
			200,
			{ next_step_id: step, rebased: true, intervening_change_ids: [second] },
		],
	);
	const [crossed, refusal] = await act(step, "changes", {
		seen_change_id: first,
		what: "A crossed example",
	});
	assert.deepEqual(
		[crossed, refusal.error, refusal.current_version],
		[409, "version_conflict", await seen(step)],
	);
	const now = await stepNow(step);
	assert.deepEqual(
		[now.what, now.due_on, now.item_bullets],
		["Call the example clinic back", "2026-04-01", ["Second example point"]],
	);
});

test("a copied item's dated facts come back through a change, and a new item takes them", async () => {
	await db.query(
		`begin; select set_config('engine.job', 'old_system', true);
		insert into next_step (id, deal_id, what, item_title, item_bullets, source_ref)
		values ('${id(60)}', '${DEAL}', 'Copied example', 'Review lease terms', '${JSON.stringify(FACTS)}', 'example:copy'); commit;`,
	);
	const copied = (await stepNow(id(60))).item_bullets;
	const bullets = [
		...copied,
		{ date: "2026-02-02", kind: "status", text: "Example third fact" },
	];
	const [status] = await act(id(60), "changes", {
		seen_change_id: await seen(id(60)),
		item_bullets: bullets,
	});
	assert.equal(status, 200);
	assert.deepEqual((await stepNow(id(60))).item_bullets, bullets);
	const step = await newStep({ item: { ...ITEM, bullets: FACTS } });
	assert.deepEqual((await stepNow(step)).item_bullets, FACTS);
	for (const bullet of [
		{ kind: "call", text: "Example undated" },
		{ date: null, kind: "other", text: "Example kind" },
		{ date: null, kind: "call", text: " " },
		{ ...FACTS[0], extra: true },
	])
		assert.deepEqual(
			(
				await act(step, "changes", {
					seen_change_id: 0,
					item_bullets: [bullet],
				})
			)[1].fields,
			["item_bullets"],
		);
});

test("a job can end and reopen a step without a version", async () => {
	const step = await newStep();
	const job = { job: "cadence", for_user: "alex" };
	const act = (door: string, args: object) =>
		save(job, `next-steps/${step}/${door}`, {
			idempotency_key: randomUUID(),
			...args,
		});
	const [status, endedStep] = await act("end", { resolution: "done" });
	assert.equal(status, 200);
	assert.deepEqual(endedStep, {
		next_step_id: step,
		status: "done",
		change_id: await seen(step),
	});
	const [again, ended] = await act("end", { resolution: "cancelled" });
	assert.deepEqual(
		[again, ended.error, ended.status],
		[409, "step_ended", "done"],
	);
	assert.deepEqual(await act("reopen", {}), [
		200,
		{ next_step_id: step, status: "open" },
	]);
	assert.deepEqual((await act("reopen", {}))[1].error, "step_open");
	const [unreasoned, refusal] = await act("end", {
		resolution: "cancelled",
	});
	assert.deepEqual(
		[unreasoned, refusal.rule],
		[422, "next_step_cancellation_reason"],
	);
	await act("end", { resolution: "cancelled", reason: "Client paused" });
	const now = await stepNow(step);
	assert.deepEqual(
		[now.status, now.resolution_reason, now.done, now.resolved],
		["cancelled", "Client paused", false, true],
	);
});

test("Home can finish and undo a step with its current version and retry either save", async () => {
	const step = await newStep();
	const caller = { user: "alex" };
	const lifecycle = (door: "end" | "reopen", args: object) =>
		save(caller, `next-steps/${step}/${door}`, args);
	const response = await request(
		caller,
		"home/inbox",
		{ method: "GET" },
		{
			HOME_INBOX_READ_SCHEMA: "next",
		},
	);
	assert.equal(response.status, 200);
	const read: unknown = await response.json();
	assert.ok(isArguments(read) && Array.isArray(read.items));
	const card = read.items
		.filter(isArguments)
		.find((item) => item.action_id === step);
	assert.ok(card);
	const end = {
		idempotency_key: randomUUID(),
		resolution: "done",
		base_version: card.action_version,
	};
	const [, edit] = await act(step, "changes", {
		seen_change_id: card.action_version,
		what: "Send the revised plan",
	});
	const [stale, conflict] = await lifecycle("end", end);
	assert.deepEqual(
		[stale, conflict.error, conflict.current_version],
		[409, "version_conflict", edit.change_id],
	);
	assert.equal((await stepNow(step)).status, "open");
	const [unversioned, missing] = await lifecycle("end", {
		idempotency_key: randomUUID(),
		resolution: "done",
	});
	assert.deepEqual([unversioned, missing.fields], [400, ["base_version"]]);

	const current = { ...end, base_version: edit.change_id };
	const [ended, completion] = await lifecycle("end", current);
	assert.equal(ended, 200);
	assert.deepEqual(completion, {
		next_step_id: step,
		status: "done",
		change_id: await seen(step),
	});
	assert.equal((await stepNow(step)).status, "done");
	const undo = {
		idempotency_key: randomUUID(),
		base_version: completion.change_id,
	};
	const [oldUndo, refused] = await lifecycle("reopen", {
		...undo,
		base_version: edit.change_id,
	});
	assert.deepEqual(
		[oldUndo, refused.error, refused.current_version],
		[409, "version_conflict", completion.change_id],
	);
	assert.equal((await stepNow(step)).status, "done");

	const reopened = { next_step_id: step, status: "open" };
	assert.deepEqual(await lifecycle("reopen", undo), [200, reopened]);
	const version = await seen(step);
	assert.deepEqual(await lifecycle("end", current), [
		200,
		{ ...completion, replayed: true },
	]);
	assert.deepEqual(await lifecycle("reopen", undo), [
		200,
		{ ...reopened, replayed: true },
	]);
	assert.equal(await seen(step), version);
	assert.equal((await stepNow(step)).status, "open");
});

test("the Deals checklist can still complete an item without a version", async () => {
	const step = await newStep({ item: ITEM });
	const [status, answer] = await save(
		{ user: "alex" },
		`next-steps/${step}/end`,
		{
			idempotency_key: randomUUID(),
			resolution: "done",
		},
	);
	assert.equal(status, 200);
	assert.equal(answer.status, "done");
});

test("a step ended at a given moment keeps it, and a copied closed step reopens without its old event", async () => {
	const done = await newStep();
	await act(done, "end", {
		resolution: "done",
		done_at: "2026-01-06T15:00:00Z",
	});
	const { rows } = await db.query(
		"select to_jsonb(done_at) #>> '{}' as done_at from next_step where id = $1",
		[done],
	);
	assert.equal(rows[0].done_at, "2026-01-06T15:00:00+00:00");
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into next_step (id, deal_id, what, resolution, done_at, resolution_event_id)
		values ('${id(50)}', '${DEAL}', 'Copied example', 'done', '2026-01-02', '${id(77)}'); commit;`);
	assert.equal((await act(id(50), "reopen", {}))[0], 200);
	const now = await stepNow(id(50));
	assert.deepEqual([now.status, now.resolution_event_id], ["open", null]);
});

test("a request missing or misnaming its arguments, or naming no known step, is refused", async () => {
	const refusal = async (path: string, args: object) => {
		const [status, body] = await save({ user: "alex" }, path, args);
		return [status, body.error, body.fields];
	};
	const key = randomUUID();
	assert.deepEqual(await refusal("next-steps", { idempotency_key: key }), [
		400,
		"missing_required",
		["what", "deal_id", "party_id", "property_id", "old_role"],
	]);
	const step = await newStep();
	assert.deepEqual(
		await refusal(`next-steps/${step}/changes`, { idempotency_key: key }),
		[
			400,
			"missing_required",
			[
				"seen_change_id",
				"what",
				"owner_party_id",
				"due_on",
				"hold_until",
				"item_bullets",
			],
		],
	);
	assert.deepEqual(
		await refusal(`next-steps/${step}/changes`, {
			idempotency_key: key,
			seen_change_id: -1,
			item_bullets: [""],
			extra: true,
		}),
		[400, "invalid_field_value", ["seen_change_id", "item_bullets", "extra"]],
	);
	assert.deepEqual(
		await refusal(`next-steps/${step}/end`, {
			idempotency_key: key,
			resolution: "expired",
			done_at: "2026-01-06",
		}),
		[400, "invalid_field_value", ["resolution", "done_at"]],
	);
	assert.deepEqual(
		await refusal(`next-steps/${step}/end`, {
			idempotency_key: key,
			resolution: "done",
			done_at: "2020-02-31T00:00:00Z",
		}),
		[400, "invalid_field_value", ["done_at"]],
	);
	for (const path of [
		`next-steps/${id(98)}/end`,
		"next-steps/not-a-step/reopen",
	])
		assert.deepEqual(
			await refusal(path, { idempotency_key: key, resolution: "done" }),
			[404, "not_found", undefined],
		);
});
