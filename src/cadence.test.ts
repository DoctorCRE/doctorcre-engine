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
		insert into job values ('cadence', 'Example cadence');
		insert into party (id, kind, name) values
		('${id(1)}', 'person', 'Alex Example'), ('${id(2)}', 'company', 'Example Clinic'),
		('${id(3)}', 'person', 'Example Lead'), ('${id(4)}', 'company', 'Example Vendor'),
		('${id(5)}', 'company', 'Example Paused Clinic'), ('${id(6)}', 'company', 'Example Converted Clinic');
		insert into how_found (slug, label) values ('referral', 'Referral');
		update party set how_found = 'referral' where id in ('${id(2)}', '${id(3)}', '${id(5)}', '${id(6)}');
		insert into app_user (id, slug) values ('${id(1)}', 'alex');
		insert into party_role (party_id, role) values
		('${id(2)}', 'client'), ('${id(5)}', 'client'), ('${id(6)}', 'client'), ('${id(4)}', 'vendor');
		insert into party_role (party_id, role, stage, owner_user_id, estimated_lease_on, lease_estimate_source) values
		('${id(3)}', 'lead', 'new', '${id(1)}', '2027-06-01', 'Example lease estimate'),
		('${id(6)}', 'lead', 'new', '${id(1)}', '2027-06-01', 'Example lease estimate');
		insert into client (party_id, status, owner_user_id) values
		('${id(2)}', 'cold', '${id(1)}'), ('${id(5)}', 'paused', null), ('${id(6)}', 'engaged', '${id(1)}');
		insert into deal (id, name, owner_user_id) values
		('${id(10)}', 'Example Deal', '${id(1)}'), ('${id(11)}', 'Example Second Deal', '${id(1)}');
		insert into deal_party (deal_id, party_id, role) values
		('${id(10)}', '${id(2)}', 'client'), ('${id(11)}', '${id(6)}', 'client');
		insert into property (id, address) values ('${id(12)}', 'Example Property');
		insert into outside_id (source, value, party_id) values
		('old_system', '${id(102)}', '${id(2)}'), ('old_system', '${id(103)}', '${id(2)}'),
		('old_system', '${id(104)}', '${id(3)}'),
		('old_system_ref', 'C-EX-1', '${id(2)}'), ('old_system_ref', 'L-EX-1', '${id(2)}'),
		('old_system_ref', 'P-EX-1', '${id(3)}'), ('old_system_ref', 'V-EX-1', '${id(4)}');
		insert into next_step (id, what, deal_id, party_id, property_id, owner_party_id, hold_until, resolution, done_at) values
		('${id(20)}', 'Example held step', null, '${id(2)}', null, '${id(1)}', '2099-01-01', null, null),
		('${id(21)}', 'Example deal step', '${id(10)}', null, null, null, null, null, null),
		('${id(22)}', 'Example completed step', null, '${id(6)}', null, '${id(1)}', null, 'done', '2026-01-02T12:00:00Z'),
		('${id(23)}', 'Example undated completion', null, '${id(2)}', null, null, null, 'done', null),
		('${id(24)}', 'Example expired step', null, '${id(2)}', null, null, null, 'expired', null),
		('${id(25)}', 'Example property step', null, null, '${id(12)}', null, null, null, null);
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

test("a stored cold client with an open deal answers cold", async () => {
	const { items: clients } = await items("collection=clients&limit=1");
	assert.deepEqual(clients, [
		{
			id: id(2),
			name: "Example Clinic",
			ref: "C-EX-1",
			client_status: "cold",
			owner: "alex",
			owner_party_id: id(1),
			old_ids: [{ value: id(102) }, { value: id(103) }],
		},
	]);
});

test("client paging keeps paused and derived statuses, and converted parties stay out of leads", async () => {
	const first = await items("collection=clients&limit=1");
	assert.equal(first.next_cursor, id(2));
	assert.deepEqual(
		await items(`collection=clients&after=${first.next_cursor}`),
		{
			items: [
				{
					id: id(5),
					name: "Example Paused Clinic",
					ref: null,
					client_status: "paused",
					owner: null,
					owner_party_id: null,
					old_ids: [],
				},
				{
					id: id(6),
					name: "Example Converted Clinic",
					ref: null,
					client_status: "active_deal",
					owner: "alex",
					owner_party_id: id(1),
					old_ids: [],
				},
			],
			next_cursor: null,
		},
	);
	assert.deepEqual(await items("collection=leads"), {
		items: [
			{
				id: id(3),
				name: "Example Lead",
				ref: null,
				client_status: null,
				owner: "alex",
				owner_party_id: id(1),
				old_ids: [{ value: id(104) }],
				estimated_lease_on: "2027-06-01",
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
});

test("only party steps are returned, with holds and completion dates preserved", async () => {
	assert.deepEqual(await items("collection=next_steps&status=open"), {
		items: [{ id: id(20), party_id: id(2), owner_party_id: id(1) }],
		next_cursor: null,
	});
	assert.deepEqual(await items("collection=next_steps&status=done&limit=1"), {
		items: [
			{
				id: id(22),
				party_id: id(6),
				owner_party_id: id(1),
				description: "Example completed step",
				done_at: "2026-01-02 12:00:00+00",
			},
		],
		next_cursor: id(22),
	});
	assert.deepEqual(
		await items(`collection=next_steps&status=done&after=${id(22)}`),
		{
			items: [
				{
					id: id(23),
					party_id: id(2),
					owner_party_id: null,
					description: "Example undated completion",
					done_at: null,
				},
			],
			next_cursor: null,
		},
	);
});

test("cadence refuses invalid requests, deal reads and other or unregistered jobs", async () => {
	for (const query of [
		"",
		"collection=unknown",
		"collection=deals",
		"collection=clients&after=no",
		"collection=clients&limit=0",
		"collection=clients&limit=501",
		"collection=clients&limit=1.5",
		"collection=next_steps",
		"collection=next_steps&status=expired",
		"collection=clients&status=open",
	])
		assert.equal((await get(query))[0], 400);
	assert.equal((await get("collection=clients", "agent"))[0], 403);
	await db.query("delete from job where slug = 'cadence'");
	try {
		assert.equal((await get("collection=clients"))[0], 403);
	} finally {
		await db.query("insert into job values ('cadence', 'Example cadence')");
	}
});
