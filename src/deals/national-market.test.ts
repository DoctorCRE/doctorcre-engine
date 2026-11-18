import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save, request } = doorTest();
const [USER, BRAND, CLIENT, OTHER, AGENT, MARKET] = Array.from(
	{ length: 6 },
	randomUUID,
);
const partner = { user: "example" };
const opening = {
	national_account_id: BRAND,
	market_id: MARKET,
	owner: partner.user,
	phase: "pending",
};

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into phase values ('pending', 'Prospective Client');
		insert into how_found values ('referral', 'Referral'), ('national_account', 'National account or corporate lead');
		insert into role values ('client', 'Client'), ('national_account', 'National account'), ('market_agent', 'Market agent');
		insert into client_type values ('franchise', 'Franchise');
		insert into party (id, kind, name, how_found) values
			('${USER}', 'person', 'Example Partner', null), ('${AGENT}', 'person', 'Example Agent', null),
			('${BRAND}', 'company', 'Example Account', null), ('${CLIENT}', 'person', 'Example Existing Location', 'referral'),
			('${OTHER}', 'company', 'Example Other Client', 'referral');
		insert into app_user (id, slug) values ('${USER}', 'example');
		insert into party_role (party_id, role) values ('${BRAND}', 'national_account'), ('${CLIENT}', 'client'), ('${OTHER}', 'client');
		insert into national_account (party_id) values ('${BRAND}');
		insert into client (party_id) values ('${CLIENT}'), ('${OTHER}');
		insert into client_brand (location_id, brand_id, started_on) values ('${CLIENT}', '${BRAND}', '2020-01-01');
		insert into market (id, name) values ('${MARKET}', 'Example Market');
		commit;`);
});
after(cleanup);

const deal = (name: string, fields: object) => ({
	...opening,
	idempotency_key: randomUUID(),
	name,
	...fields,
});

test("a new person location, its deal and selected market agent appear under the account after one save", async () => {
	const args = deal("Example New Market Deal", {
		new_location: { name: " Example New Location ", kind: "person" },
		market_agent_id: AGENT,
	});
	const [status, receipt] = await save(partner, "deals", args);
	assert.equal(status, 201);
	assert.deepEqual(await save(partner, "deals", args), [
		200,
		{ ...receipt, replayed: true },
	]);

	const response = await request(
		partner,
		`deals?workspace=national_account&account_client_id=${BRAND}`,
		{ method: "GET" },
		{ DEALS_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const board: {
		deals: {
			id: string;
			account_client_id: string;
			market_agent: string;
			market: string;
		}[];
	} = await response.json();
	const [saved] = board.deals.filter((row) => row.id === receipt.deal_id);
	assert.ok(saved);
	assert.equal(saved.account_client_id, BRAND);
	assert.equal(saved.market, "Example Market");
	assert.equal(saved.market_agent, "Example Agent");

	const { rows } = await db.query(
		`select p.kind, p.name, p.how_found, c.client_type
		from party p join client c on c.party_id = p.id join deal_party d on d.party_id = p.id
		where d.deal_id = $1 and d.role = 'client'`,
		[receipt.deal_id],
	);
	assert.deepEqual(rows, [
		{
			kind: "person",
			name: "Example New Location",
			how_found: "national_account",
			client_type: "franchise",
		},
	]);
});

test("an existing location is reused with its original how found", async () => {
	const [status, receipt] = await save(
		partner,
		"deals",
		deal("Example Existing Location Deal", { client_id: CLIENT }),
	);
	assert.equal(status, 201);
	const { rows } = await db.query(
		`select p.id, p.how_found from party p join deal_party d on d.party_id = p.id
		where d.deal_id = $1 and d.role = 'client'`,
		[receipt.deal_id],
	);
	assert.deepEqual(rows, [{ id: CLIENT, how_found: "referral" }]);
	const [duplicate, refusal] = await save(
		partner,
		"deals",
		deal("example existing location deal", { client_id: CLIENT }),
	);
	assert.equal(duplicate, 409);
	assert.equal(refusal.error, "deal_name_exists");
});

test("market deals refuse unlinked, duplicate or ambiguous locations and keep jobs on the original contract", async () => {
	const [outside, wrongAccount] = await save(
		partner,
		"deals",
		deal("Example Outside", { client_id: OTHER }),
	);
	assert.equal(outside, 409);
	assert.equal(wrongAccount.error, "location_not_in_account");
	const new_location = { name: "example existing location", kind: "person" };
	const [duplicate, matched] = await save(
		partner,
		"deals",
		deal("Example Duplicate", { new_location }),
	);
	assert.equal(duplicate, 409);
	assert.deepEqual(matched.candidates, [
		{ id: CLIENT, name: "Example Existing Location" },
	]);
	const ambiguous = deal("Example Ambiguous", {
		client_id: CLIENT,
		new_location,
	});
	assert.equal((await save(partner, "deals", ambiguous))[0], 400);
	assert.equal(
		(
			await save(
				{ job: "agent", for_user: "example" },
				"deals",
				deal("Example Job", { client_id: CLIENT }),
			)
		)[0],
		400,
	);
});

test("a refused market agent rolls back the new deal, client and membership", async () => {
	const name = "Example Unsaved Location";
	const [status, refusal] = await save(
		partner,
		"deals",
		deal("Example Unsaved Deal", {
			new_location: { name, kind: "company" },
			market_agent_id: BRAND,
		}),
	);
	assert.equal(status, 400);
	assert.deepEqual(refusal.fields, ["market_agent_id"]);
	const { rows } = await db.query(
		`select
		exists (select from party where name = $1) as client,
		exists (select from deal where name = 'Example Unsaved Deal') as deal`,
		[name],
	);
	assert.deepEqual(rows, [{ client: false, deal: false }]);
});
