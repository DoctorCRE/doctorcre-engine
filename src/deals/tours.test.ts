import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { type Caller, doorTest } from "../test-door.ts";

const { db, setup, cleanup, save, request } = doorTest();
const [alex, blair, deal, otherDeal, planned, cancelled, completed, meeting] =
	Array.from({ length: 8 }, () => randomUUID());
const property = randomUUID();
const client = randomUUID();
const owner = { user: "alex" };
const partner = { user: "blair" };
const path = `deals/${deal}/tours`;
const otherPath = `deals/${otherDeal}/tours`;
const fields = { planned_on: "2026-12-01", stops: [{ property_id: property }] };
const key = () => ({ idempotency_key: randomUUID() });

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into how_found (slug, label) values ('inbound', 'Inbound');
		insert into role (slug, label) values ('client', 'Client');
		insert into party (id, kind, name) values
			('${alex}', 'person', 'Alex Example'), ('${blair}', 'person', 'Blair Example');
		insert into party (id, kind, name, how_found)
			values ('${client}', 'company', 'Example Clinic', 'inbound');
		insert into party_role (party_id, role) values ('${client}', 'client');
		insert into app_user (id, slug) values ('${alex}', 'alex'), ('${blair}', 'blair');
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'Example Deal', '${alex}'), ('${otherDeal}', 'Sample Deal', '${blair}');
		insert into deal_party (deal_id, party_id, role) values ('${otherDeal}', '${client}', 'client');
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

const draft = () => ({ ...key(), ...fields });
const statusOf = async (caller: Caller, path: string, body?: object) =>
	(await save(caller, path, body ?? {}, body ? "POST" : "GET"))[0];

async function readOtherDeal() {
	const response = await request(
		owner,
		`deals/${otherDeal}`,
		{ method: "GET" },
		{ DEALS_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const page = await response.json();
	assert.ok(
		page &&
			typeof page === "object" &&
			"events" in page &&
			"correspondence" in page,
	);
	const { events, correspondence } = page;
	assert.ok(Array.isArray(events) && Array.isArray(correspondence));
	return { events, correspondence };
}

test("complete a tour once with the actual time, distinct visited stops, and parties", async () => {
	const [, created] = await save(owner, otherPath, draft());
	const tour = `${otherPath}/${created.id}`;
	const finish = `${tour}/complete`;
	const happened_at = "2026-12-02T14:30:00-06:00";
	const body = {
		...key(),
		revision: created.revision,
		happened_at,
		party_ids: [alex],
		visited_stops: [
			{ property_id: property },
			{ property_id: property.toUpperCase() },
			{ address: "50 Sample Lane" },
		],
	};
	for (const [url, args, expected] of [
		[finish, { ...body, revision: 1 }, 409],
		[finish, { ...body, happened_at: "2026-12-02T14:30" }, 400],
		[
			finish,
			{
				...body,
				visited_stops: [
					{ address: "Never Saved Lane" },
					{ property_id: randomUUID() },
				],
			},
			404,
		],
		[`${path}/${created.id}/complete`, body, 404],
	] as const) {
		assert.equal(await statusOf(owner, url, args), expected);
	}
	assert.equal(
		(await db.query("select from property where address = 'Never Saved Lane'"))
			.rowCount,
		0,
	);
	const [first, second] = await Promise.all([
		save(owner, finish, body),
		save(partner, finish, { ...body, ...key() }),
	]);
	assert.equal(first[0], 200);
	assert.deepEqual(second, first);
	const [, result] = first;
	assert.deepEqual(await save(owner, finish, body), [
		200,
		{ ...result, replayed: true },
	]);
	const [, plan] = await save(partner, tour, {}, "GET");
	assert.equal(plan.completed_activity_id, result.activity_id);
	assert.ok(Array.isArray(plan.stops));
	assert.deepEqual(
		plan.stops.map((stop) => stop.property_id),
		[property],
	);
	const { rows } = await db.query(
		"select party_id from activity_about where activity_id = $1 and party_id is not null",
		[result.activity_id],
	);
	assert.deepEqual(
		new Set(rows.map((row) => row.party_id)),
		new Set([alex, client]),
	);
	const { correspondence } = await readOtherDeal();
	assert.equal(correspondence.length, 1);
	assert.partialDeepStrictEqual(correspondence[0], {
		activity_id: result.activity_id,
		kind: "meeting",
		happened_at: "2026-12-02T20:30:00+00:00",
	});
	assert.deepEqual(
		correspondence[0].properties.map((p: { address: string }) => p.address),
		["10 Example Way", "50 Sample Lane"],
	);
});

test("cancel a tour into deal history without recording a meeting", async () => {
	const [, created] = await save(owner, otherPath, draft());
	const tour = `${otherPath}/${created.id}`;
	const cancel = `${tour}/cancel`;
	const body = { ...key(), revision: created.revision };
	assert.equal(await statusOf(partner, cancel, { ...body, revision: 1 }), 409);
	assert.equal(
		await statusOf(partner, `${path}/${created.id}/cancel`, body),
		404,
	);
	assert.equal(
		await statusOf(partner, `${path}/${completed}/cancel`, body),
		409,
	);
	const before = await readOtherDeal();
	const [status, result] = await save(partner, cancel, body);
	assert.equal(status, 200);
	assert.deepEqual(await save(partner, cancel, body), [
		200,
		{ ...result, replayed: true },
	]);
	assert.equal(await statusOf(owner, cancel, { ...body, ...key() }), 409);
	assert.equal(
		await statusOf(owner, `${tour}/complete`, {
			...key(),
			revision: result.revision,
			happened_at: "2026-12-02T14:30:00-06:00",
			visited_stops: fields.stops,
		}),
		409,
	);
	const after = await readOtherDeal();
	assert.deepEqual(after.correspondence, before.correspondence);
	const cancellation = after.events.find(
		(event: { verb: string }) => event.verb === "cancel-tour",
	);
	assert.partialDeepStrictEqual(cancellation, {
		actor: "blair",
		activity_id: null,
	});
	const [, active] = await save(owner, otherPath, {}, "GET");
	assert.ok(Array.isArray(active.tours));
	assert.ok(active.tours.every(({ id }) => id !== created.id));
});

test("copy the saved date and stops with current property details and no notes", async () => {
	const [, created] = await save(owner, otherPath, {
		...draft(),
		notes: "Keep this private",
		stops: [{ address: "60 Sample Lane", name: "Old name" }, ...fields.stops],
	});
	await db.query(`begin; set local engine.job = 'old_system';
		update property set address = '61 Sample Lane', name = 'New name'
		where address = '60 Sample Lane'; commit;`);
	assert.deepEqual(
		await save(partner, `${otherPath}/${created.id}/stop-list`, {}, "GET"),
		[
			200,
			{
				text: "December 1, 2026\n\n1. New name, 61 Sample Lane\n2. 10 Example Way",
			},
		],
	);
	assert.equal(await statusOf(partner, `${path}/${created.id}/stop-list`), 404);
});
