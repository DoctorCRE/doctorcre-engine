import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const get = (query: string, job = "cadence") =>
	save({ job }, `cadence?${query}`, {}, "GET");

before(async () => {
	await setup();
	await db
		.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into role (slug,label) values ('client','Client'), ('lead','Lead'), ('vendor','Vendor');
		insert into stage (role,slug,label) values ('lead','new','New');
		insert into phase (slug,label) values ('dead','Dead'), ('research','Research');
		insert into job values ('cadence', 'Example cadence');
		insert into party (id, kind, name) values
		('${id(1)}', 'person', 'Alex Example'), ('${id(2)}', 'company', 'Example Clinic'),
		('${id(3)}', 'person', 'Example Lead'), ('${id(4)}', 'company', 'Example Vendor'),
		('${id(5)}', 'company', 'Example Paused Clinic');
		insert into how_found (slug, label) values ('referral', 'Referral');
		update party set how_found = 'referral' where id in ('${id(2)}', '${id(3)}', '${id(5)}');
		insert into app_user (id, slug) values ('${id(1)}', 'alex');
		insert into party_role (party_id, role) values ('${id(2)}', 'client'), ('${id(5)}', 'client'), ('${id(4)}', 'vendor');
		insert into party_role (party_id, role, stage, owner_user_id, estimated_lease_on, lease_estimate_source) values
		('${id(2)}', 'lead', 'new', '${id(1)}', '2027-06-01', 'Example lease estimate'),
		('${id(3)}', 'lead', 'new', null, null, null);
		insert into client (party_id, status, owner_user_id) values
		('${id(2)}', 'cold', '${id(1)}'), ('${id(5)}', 'paused', null);
		insert into deal (id, name, owner_user_id) values
		('${id(10)}', 'Example Deal', '${id(1)}'), ('${id(11)}', 'Example Unlinked Deal', '${id(1)}');
		insert into deal_party (deal_id, party_id, role) values ('${id(10)}', '${id(2)}', 'client');
		insert into outside_id (source, value, party_id) values
		('old_system', '${id(102)}', '${id(2)}'), ('old_system', '${id(103)}', '${id(2)}'),
		('old_system_ref', 'C-EX-1', '${id(2)}'), ('old_system_ref', 'L-EX-1', '${id(2)}'),
		('old_system_ref', 'P-EX-1', '${id(2)}'), ('old_system_ref', 'V-EX-1', '${id(4)}');
		insert into next_step (id, what, deal_id, party_id, owner_party_id, hold_until, resolution, done_at) values
		('${id(20)}', 'Example held step', '${id(10)}', null, '${id(1)}', '2099-01-01', null, null),
		('${id(21)}', 'Example party step', null, '${id(2)}', null, null, null, null),
		('${id(22)}', 'Example completed step', '${id(10)}', null, '${id(1)}', null, 'done', '2026-01-02T12:00:00Z'),
		('${id(23)}', 'Example undated completion', null, '${id(2)}', null, null, 'done', null),
		('${id(24)}', 'Example expired step', '${id(10)}', null, null, null, 'expired', null);
		commit;`)
		.catch(async (error: unknown) => {
			await db.query("rollback");
			throw error;
		});
});
after(cleanup);

async function items(query: string) {
	const [status, body] = await get(query);
	assert.equal(status, 200);
	return body;
}

test("cadence reads deal names, governing derived status and owner identity, including deals without a client", async () => {
	assert.deepEqual(await items("collection=deals"), {
		items: [
			{
				id: id(10),
				name: "Example Deal",
				ref: null,
				client_status: "active_deal",
				owner: "alex",
				owner_party_id: id(1),
			},
			{
				id: id(11),
				name: "Example Unlinked Deal",
				ref: null,
				client_status: null,
				owner: "alex",
				owner_party_id: id(1),
			},
		],
		next_cursor: null,
	});
});

test("clients and converted leads share their party's status and old ids; lead dates and missing owners remain explicit", async () => {
	const old_ids = [{ value: id(102) }, { value: id(103) }];
	assert.deepEqual(await items("collection=clients"), {
		items: [
			{
				id: id(2),
				name: "Example Clinic",
				ref: "C-EX-1",
				client_status: "active_deal",
				owner: "alex",
				owner_party_id: id(1),
				old_ids,
			},
			{
				id: id(5),
				name: "Example Paused Clinic",
				ref: null,
				client_status: "paused",
				owner: null,
				owner_party_id: null,
				old_ids: [],
			},
		],
		next_cursor: null,
	});
	assert.deepEqual(await items("collection=leads"), {
		items: [
			{
				id: id(2),
				name: "Example Clinic",
				ref: "L-EX-1",
				client_status: "active_deal",
				owner: "alex",
				owner_party_id: id(1),
				old_ids,
				estimated_lease_on: "2027-06-01",
			},
			{
				id: id(3),
				name: "Example Lead",
				ref: null,
				client_status: null,
				owner: null,
				owner_party_id: null,
				old_ids: [],
				estimated_lease_on: null,
			},
		],
		next_cursor: null,
	});
	assert.deepEqual(await items("collection=vendors"), {
		items: [
			{
				id: id(4),
				name: "Example Vendor",
				ref: "V-EX-1",
				client_status: null,
				owner: null,
				owner_party_id: null,
				old_ids: [],
			},
		],
		next_cursor: null,
	});
	await db
		.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal_phase_change (deal_id, happened_at, phase, reason) values ('${id(10)}', now(), 'dead', 'Example ended deal'); commit;`)
		.catch(async (error: unknown) => {
			await db.query("rollback");
			throw error;
		});
	const clients = await items("collection=clients&limit=1");
	assert.equal(
		JSON.stringify(clients).includes('"client_status":"cold"'),
		true,
	);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal_phase_change (deal_id, happened_at, phase) values ('${id(10)}', now(), 'research'); commit;`);
});

test("open steps include held work; done steps retain description and unknown completion time", async () => {
	assert.deepEqual(await items("collection=next_steps&status=open"), {
		items: [
			{
				id: id(20),
				deal_id: id(10),
				party_id: null,
				property_id: null,
				owner_party_id: id(1),
			},
			{
				id: id(21),
				deal_id: null,
				party_id: id(2),
				property_id: null,
				owner_party_id: null,
			},
		],
		next_cursor: null,
	});
	const done = await items("collection=next_steps&status=done");
	assert.deepEqual(done, {
		items: [
			{
				id: id(22),
				deal_id: id(10),
				party_id: null,
				property_id: null,
				owner_party_id: id(1),
				description: "Example completed step",
				done_at: "2026-01-02 12:00:00+00",
			},
			{
				id: id(23),
				deal_id: null,
				party_id: id(2),
				property_id: null,
				owner_party_id: null,
				description: "Example undated completion",
				done_at: null,
			},
		],
		next_cursor: null,
	});
});

test("each collection pages by exclusive id and refuses invalid requests or other jobs", async () => {
	for (const collection of [
		"deals",
		"clients",
		"leads",
		"vendors",
		"next_steps&status=open",
		"next_steps&status=done",
	]) {
		const first = await items(`collection=${collection}&limit=1`);
		if (first.next_cursor) {
			const last = await items(
				`collection=${collection}&limit=1&after=${first.next_cursor}`,
			);
			assert.equal(last.next_cursor, null);
			assert.notDeepEqual(last.items, first.items);
		}
	}
	for (const query of [
		"collection=unknown",
		"collection=deals&after=no",
		"collection=deals&limit=0",
		"collection=deals&limit=501",
		"collection=deals&limit=1.5",
		"collection=next_steps",
		"collection=next_steps&status=expired",
		"collection=deals&status=open",
	])
		assert.equal((await get(query))[0], 400);
	assert.equal((await get("collection=deals", "agent"))[0], 403);
	await db.query("delete from job where slug = 'cadence'");
	assert.equal((await get("collection=deals"))[0], 403);
	await db.query("insert into job values ('cadence', 'Example cadence')");
});
