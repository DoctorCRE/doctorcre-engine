import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const [
	alex,
	blair,
	deal,
	otherDeal,
	property,
	planned,
	cancelled,
	completed,
	meeting,
] = Array.from({ length: 9 }, () => randomUUID());
const owner = { user: "alex" };
const partner = { user: "blair" };
const path = `deals/${deal}/tours`;
const otherPath = `deals/${otherDeal}/tours`;
const fields = { planned_on: "2026-12-01", stops: [{ property_id: property }] };
const key = () => ({ idempotency_key: randomUUID() });

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into party (id, kind, name) values
			('${alex}', 'person', 'Alex Example'), ('${blair}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${alex}', 'alex'), ('${blair}', 'blair');
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'Example Deal', '${alex}'), ('${otherDeal}', 'Sample Deal', '${blair}');
		insert into property (id, address) values ('${property}', '1 Example Way');
		insert into tour_plan (id, deal_id, planned_on) values
			('${planned}', '${deal}', '2026-12-01'), ('${cancelled}', '${deal}', '2026-12-02'),
			('${completed}', '${deal}', '2026-12-03');
		insert into tour_stop (tour_plan_id, property_id, position) values
			('${planned}', '${property}', 1), ('${cancelled}', '${property}', 1), ('${completed}', '${property}', 1);
		update property set address = '10 Example Way' where id = '${property}';
		update tour_plan set cancelled_at = now() where id = '${cancelled}';
		insert into activity (id, kind, happened_at) values ('${meeting}', 'meeting', now());
		insert into activity_about (activity_id, deal_id) values ('${meeting}', '${deal}');
		update tour_plan set completed_activity_id = '${meeting}' where id = '${completed}';
		commit;`);
});
after(cleanup);

test("both partners see only the deal's planned tours and jobs cannot list them", async () => {
	for (const caller of [owner, partner]) {
		assert.deepEqual(await save(caller, path, {}, "GET"), [
			200,
			{ tours: [{ id: planned, planned_on: fields.planned_on }] },
		]);
	}
	assert.equal((await save({ job: "agent" }, path, {}, "GET"))[0], 404);
});

test("read one plan on its own deal, with the current property facts", async () => {
	const [status, plan] = await save(partner, `${path}/${planned}`, {}, "GET");
	assert.equal(status, 200);
	assert.equal(plan.planned_on, fields.planned_on);
	assert.deepEqual(plan.stops, [
		{
			property_id: property,
			position: 1,
			address: "10 Example Way",
			name: null,
		},
	]);
	assert.equal(
		(await save(partner, `${otherPath}/${planned}`, {}, "GET"))[0],
		404,
	);
});

test("save a shared plan with both kinds of stop and replay without adding another property", async () => {
	const draft = {
		...key(),
		...fields,
		notes: "Bring the plans",
		stops: [
			...fields.stops,
			{ address: "20 Example Way", name: "Sample Center" },
		],
	};
	const [status, created] = await save(partner, otherPath, draft);
	assert.equal(status, 201);
	assert.deepEqual(await save(partner, otherPath, draft), [
		201,
		{ ...created, replayed: true },
	]);
	const savedPath = `${otherPath}/${created.id}`;
	const [readStatus, plan] = await save(owner, savedPath, {}, "GET");
	assert.equal(readStatus, 200);
	assert.equal(plan.notes, draft.notes);
	assert.equal(plan.revision, created.revision);
	assert.ok(Array.isArray(plan.stops));
	assert.deepEqual(
		plan.stops.map(({ address, name }) => ({ address, name })),
		[
			{ address: "10 Example Way", name: null },
			{ address: "20 Example Way", name: "Sample Center" },
		],
	);
	const [editedStatus, edited] = await save(owner, savedPath, {
		...key(),
		...fields,
		planned_on: "2026-12-05",
		revision: plan.revision,
		stops: [plan.stops[1], plan.stops[0]].map(({ property_id }) => ({
			property_id,
		})),
	});
	assert.equal(editedStatus, 200);
	assert.notEqual(edited.revision, plan.revision);
	const [, reopened] = await save(partner, savedPath, {}, "GET");
	assert.equal(reopened.notes, null);
	assert.equal(reopened.planned_on, "2026-12-05");
	assert.ok(Array.isArray(reopened.stops));
	assert.deepEqual(
		reopened.stops.map(({ address }) => address),
		["20 Example Way", "10 Example Way"],
	);
	const stamps = await db.query(
		"select changed_by_user_id from tour_plan where id = $1",
		[created.id],
	);
	assert.deepEqual(stamps.rows, [{ changed_by_user_id: alex }]);
	const [staleStatus, refused] = await save(partner, savedPath, {
		...key(),
		...fields,
		revision: plan.revision,
	});
	assert.deepEqual(
		[staleStatus, refused.error, refused.current_revision],
		[409, "version_conflict", edited.revision],
	);
	assert.deepEqual(await save(owner, savedPath, {}, "GET"), [200, reopened]);
});

test("refuse edits to finalized plans or to another deal's tour", async () => {
	for (const id of [cancelled, completed]) {
		const [, plan] = await save(owner, `${path}/${id}`, {}, "GET");
		const [status, body] = await save(partner, `${path}/${id}`, {
			...key(),
			...fields,
			revision: plan.revision,
		});
		assert.deepEqual([status, body.error], [409, "version_conflict"]);
	}
	const [status, body] = await save(partner, `${otherPath}/${planned}`, {
		...key(),
		...fields,
		revision: 1,
	});
	assert.deepEqual([status, body.error], [404, "not_found"]);
});

test("require a valid date and stops, and roll back a property when a stop cannot be saved", async () => {
	for (const invalid of [{ planned_on: "2026-02-30" }, { stops: [] }]) {
		const [status, body] = await save(owner, otherPath, {
			...key(),
			...fields,
			...invalid,
		});
		assert.deepEqual([status, body.error], [400, "invalid_field_value"]);
	}
	const address = "30 Example Way";
	const [status] = await save(owner, otherPath, {
		...key(),
		...fields,
		stops: [{ address }, { property_id: randomUUID() }],
	});
	assert.equal(status, 422);
	assert.equal(
		(await db.query("select from property where address = $1", [address]))
			.rowCount,
		0,
	);
});
