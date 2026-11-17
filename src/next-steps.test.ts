import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { type Caller, doorTest } from "./test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ALEX, BLAIR, CLIENT, DEAL] = [id(1), id(2), id(3), id(10)];
const ITEM = {
	title: "Example plan sent",
	bullets: ["First example point"],
	source_ref: "example:call",
};

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${ALEX}', 'person', 'Alex Example'),
			('${BLAIR}', 'person', 'Blair Example'), ('${CLIENT}', 'company', 'Example Clinic');
		insert into app_user (id, slug) values ('${ALEX}', 'alex'), ('${BLAIR}', 'blair');
		insert into deal (id, name, owner_user_id) values ('${DEAL}', 'Example Deal', '${ALEX}');
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
			`select s.what, s.due_on::text, s.item_title, s.item_bullets, s.status, s.resolution_reason,
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
	const [status, body] = await create(
		{ user: "alex" },
		{ deal_id: DEAL, what: "Call the example clinic", ...args },
	);
	assert.equal(status, 201);
	return String(body.next_step_id);
}

const act = (step: string, door: string, args: object) =>
	save({ user: "alex" }, `next-steps/${step}/${door}`, {
		idempotency_key: randomUUID(),
		...args,
	});

test("a partner's checklist item lands once on its deal, stamped with the partner", async () => {
	const args = {
		idempotency_key: randomUUID(),
		deal_id: DEAL,
		what: "Send the example plan",
		owner_party_id: ALEX,
		due_on: "2026-02-01",
		item: ITEM,
	};
	const [status, answer] = await save({ user: "alex" }, "next-steps", args);
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
		due_on: "2026-02-01",
		item_title: ITEM.title,
		item_bullets: ITEM.bullets,
		status: "open",
		resolution_reason: null,
		done: false,
		resolved: false,
		resolution_event_id: null,
		by_user: "alex",
		by_job: null,
		for_user: null,
	});
	assert.deepEqual(await save({ user: "alex" }, "next-steps", args), [
		201,
		{ replayed: true, ...answer },
	]);
	const [reused, refusal] = await save({ user: "alex" }, "next-steps", {
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
		[step.by_user, step.by_job, step.for_user],
		[null, "agent", "blair"],
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

test("a step ends done or cancelled once, and reopens once", async () => {
	const step = await newStep();
	assert.deepEqual(await act(step, "end", { resolution: "done" }), [
		200,
		{ next_step_id: step, status: "done" },
	]);
	const [again, ended] = await act(step, "end", { resolution: "cancelled" });
	assert.deepEqual(
		[again, ended.error, ended.status],
		[409, "step_ended", "done"],
	);
	assert.deepEqual(await act(step, "reopen", {}), [
		200,
		{ next_step_id: step, status: "open" },
	]);
	assert.deepEqual((await act(step, "reopen", {}))[1].error, "step_open");
	const [unreasoned, refusal] = await act(step, "end", {
		resolution: "cancelled",
	});
	assert.deepEqual(
		[unreasoned, refusal.rule],
		[422, "next_step_cancellation_reason"],
	);
	await act(step, "end", { resolution: "cancelled", reason: "Client paused" });
	const now = await stepNow(step);
	assert.deepEqual(
		[now.status, now.resolution_reason, now.done, now.resolved],
		["cancelled", "Client paused", false, true],
	);
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
		["what", "deal_id", "party_id", "property_id"],
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
	for (const path of [
		`next-steps/${id(98)}/end`,
		"next-steps/not-a-step/reopen",
	])
		assert.deepEqual(
			await refusal(path, { idempotency_key: key, resolution: "done" }),
			[404, "not_found", undefined],
		);
});
