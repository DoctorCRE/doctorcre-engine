import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request } = doorTest();
const joe = randomUUID();
const dell = randomUUID();
const brand = randomUUID();
const [open, past, roster, lower, vet, unset] = Array.from({ length: 6 }, () =>
	randomUUID(),
);
type Mix = {
	total: number;
	open_deal: number;
	past_client: number;
	no_deal_yet: number;
};
type Tiles = {
	all: Mix;
	national_accounts: Mix & { accounts: number };
	practice_types: (Mix & { practice_type: string })[];
	not_set: Mix;
};
const mix = (total: number, open_deal = 0, past_client = 0): Mix => ({
	total,
	open_deal,
	past_client,
	no_deal_yet: total - open_deal - past_client,
});

before(async () => {
	await setup();
	const clients = [open, past, roster, lower, vet, unset];
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into phase values ('negotiation', 'Negotiation'), ('closed', 'Closed');
		insert into role values ('client', 'Client'), ('national_account', 'National account');
		insert into how_found values ('referral', 'Referral');
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example Partner One'),
			('${dell}', 'person', 'Example Partner Two'),
			('${brand}', 'company', 'Example Brand'),
			${clients.map((id, i) => `('${id}', 'company', 'Example Client ${i}')`).join(", ")};
		update party set how_found = 'referral' where name like 'Example Client %';
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into party_role (party_id, role) values ('${brand}', 'national_account'),
			${clients.map((id) => `('${id}', 'client')`).join(", ")};
		insert into national_account (party_id) values ('${brand}');
		insert into client (party_id, owner_user_id) values
			${clients.map((id) => `('${id}', '${id === vet ? dell : joe}')`).join(", ")};
		insert into client_vertical (party_id, vertical) values
			('${open}', 'Dental'), ('${past}', 'Dental'), ('${roster}', 'Dental'),
			('${lower}', 'dental'), ('${vet}', 'Veterinary');
		insert into client_brand (location_id, brand_id, started_on) values
			('${open}', '${brand}', '2020-01-01'), ('${vet}', '${brand}', '2020-01-01');
		insert into deal (id, name, owner_user_id) values
			('${open}', 'Example Open Deal', '${joe}'), ('${past}', 'Example Closed Deal', '${joe}');
		insert into deal_party (deal_id, party_id, role) values
			('${open}', '${open}', 'client'), ('${past}', '${past}', 'client');
		insert into deal_phase_change (deal_id, happened_at, phase) values
			('${open}', '2026-01-01', 'negotiation'), ('${past}', '2026-01-01', 'closed');
		commit;`);
});
after(cleanup);

const read = async (query: string) => {
	const response = await request(
		{ user: "joe" },
		`clients?${query}`,
		{ method: "GET" },
		{ DIRECTORY_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200, await response.clone().text());
	return (await response.json()) as {
		total: number;
		rows: { id: string }[];
		tiles: Tiles;
	};
};

test("Clients counts a tile per practice type, most clients first, with Not set apart", async () => {
	const { tiles } = await read("");
	assert.deepEqual(tiles, {
		all: mix(6, 1, 1),
		national_accounts: { accounts: 1, ...mix(2, 1) },
		practice_types: [
			{ practice_type: "Dental", ...mix(4, 1, 1) },
			{ practice_type: "Veterinary", ...mix(1) },
		],
		not_set: mix(1),
	});
});

test("Joe or Dell recounts every tile", async () => {
	const { tiles } = await read("owner=dell");
	assert.deepEqual(tiles, {
		all: mix(1),
		national_accounts: { accounts: 1, ...mix(1) },
		practice_types: [{ practice_type: "Veterinary", ...mix(1) }],
		not_set: mix(0),
	});
});

test("A tile's filter lists its clients", async () => {
	const ids = async (query: string) =>
		(await read(query)).rows.map(({ id }) => id).sort();
	assert.deepEqual(
		await ids("practice_type=DENTAL"),
		[open, past, roster, lower].sort(),
	);
	assert.deepEqual(await ids("practice_type="), [unset]);
	assert.deepEqual(await ids("national_account=any"), [open, vet].sort());
	assert.deepEqual(
		await ids(`national_account=${brand.toUpperCase()}`),
		[open, vet].sort(),
	);
	assert.deepEqual(await ids(`national_account=${randomUUID()}`), []);
});

test("The old-table read refuses the tile filters", async () => {
	const response = await request(
		{ user: "joe" },
		"clients?practice_type=Dental",
		{ method: "GET" },
		{ DIRECTORY_READ_SCHEMA: "" },
	);
	assert.equal(response.status, 400);
	assert.partialDeepStrictEqual(await response.json(), {
		detail: { parameter: "practice_type", reason: "unsupported" },
	});
});
