import assert from "node:assert/strict";
import { test } from "node:test";
import { doorTest } from "../test-door.ts";
import worker from "../worker.ts";

const ACTOR = "00000000-0000-4000-8000-000000000101";
const UNREAD = "postgres://made-up@127.0.0.1:1/none";

const markets = (search: string, connectionString: string, slug = "joe") =>
	worker.request(
		`https://app.example.test/api/engine/vendor-markets${search}`,
		{ headers: { Cookie: "__Host-dealroom_session=made-up-session" } },
		{
			CARR: {
				fetch: async () =>
					Response.json({
						actor: { slug, display: "Example Partner" },
						csrf_token: "made-up-csrf",
					}),
			},
			DATABASE: { connectionString },
		},
	);

// The old door's generic body: none of this read's refusals was public.
const GENERIC = {
	error: "unhandled_verb_failure",
	hint: "The operation failed. Quote the correlation_id when reporting it.",
};

async function refused(response: Response, status: number) {
	assert.equal(response.status, status);
	const { correlation_id, ...body } = (await response.json()) as Record<
		string,
		unknown
	>;
	assert.equal(typeof correlation_id, "string");
	assert.deepEqual(body, GENERIC);
}

test("bad input is refused before any read", async () => {
	for (const search of [
		"?market=",
		"?market=%20%20",
		`?market=${"x".repeat(201)}`,
		"?market=a&market=b",
	])
		await refused(await markets(search, UNREAD), 400);
});

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [vendor, otherVendor, contact, nonVendor, empty, undrawn] = [
	1, 2, 3, 4, 5, 6,
].map(id);
const copied = "27730777-4817-6292-5482-09d56518ba48";

async function withMarkets(
	run: (door: ReturnType<typeof doorTest>) => Promise<void>,
) {
	const door = doorTest();
	await door.setup();
	try {
		await door.db.query(`
			select set_config('engine.job', 'old_system', true);
			insert into party (id, kind, name) values ('${ACTOR}', 'person', 'Example Partner');
			insert into app_user (id, slug) values ('${ACTOR}', 'joe');
			insert into role (slug, label, category_of) values ('vendor', 'Vendor', null), ('lender', 'Lender', 'vendor');
		`);
		await run(door);
	} finally {
		await door.cleanup();
	}
}

const getMarkets = (door: ReturnType<typeof doorTest>, path = "") =>
	door.request({ user: "joe" }, `vendor-markets${path}`, { method: "GET" });

test("markets list current vendor links, review evidence, and working vendor and market selections", () =>
	withMarkets(async (door) => {
		await door.db.query(`
			select set_config('engine.job', 'old_system', true);
			insert into party (id, kind, name) values
				('${vendor}', 'company', 'Example Lending Co'), ('${otherVendor}', 'person', 'Example Architect'),
				('${contact}', 'person', 'Alex Example'), ('${nonVendor}', 'person', 'Example Nonvendor');
			insert into party_role (party_id, role) values
				('${vendor}', 'vendor'), ('${vendor}', 'lender'), ('${otherVendor}', 'vendor');
			insert into outside_id (party_id, source, value) values ('${vendor}', 'old_system_ref', 'V-001');
			insert into party_company (person_id, company_id) values ('${contact}', '${vendor}');
			insert into territory (id, name) values
				('${copied}', 'Example City'), ('${empty}', 'Empty City'), ('${undrawn}', 'Undrawn');
			with created as (insert into market (name) values ('Example City'), ('Empty City') returning id, name)
			insert into territory_piece (territory_id, market_id)
				select t.id, m.id from territory t join created m using (name);
			with links as (
				insert into party_territory (party_id, territory_id, started_on, ended_on) values
					('${vendor}', '${copied}', null, null),
					('${vendor}', '${copied}', '2000-01-01', null),
					('${otherVendor}', '${copied}', null, null),
					('${otherVendor}', '${empty}', '2000-01-01', '2000-02-01'),
					('${vendor}', '${empty}', '9999-01-01', null),
					('${nonVendor}', '${empty}', null, null),
					('${vendor}', '${undrawn}', null, null)
				returning id, party_id, territory_id, started_on
			)
			insert into party_territory_review (party_territory_id, has_office, coverage, source)
				select id, true, 'Example coverage', 'Example review' from links
				where party_id = '${vendor}' and (started_on = '2000-01-01' or territory_id = '${undrawn}');
		`);
		const response = await getMarkets(door);
		assert.equal(response.status, 200);
		assert.partialDeepStrictEqual(await response.json(), {
			state: "ready",
			selected_market: null,
			markets: [
				{ slug: empty, name: "Empty City", vendor_count: 0, memberships: [] },
				{
					slug: copied,
					name: "Example City",
					kind: "market",
					aliases: [copied],
					vendor_count: 2,
					regional_references: [],
					memberships: [
						{
							market_slug: copied,
							vendor_id: vendor,
							office_presence: true,
							service_coverage: "Example coverage",
							source: "Example review",
							reviewed_by: "old_system",
						},
						{
							market_slug: copied,
							vendor_id: otherVendor,
							office_presence: false,
							service_coverage: null,
						},
					],
				},
			],
			vendors: [
				{
					id: vendor,
					ref: "V-001",
					category: "lender",
					name: "Example Lending Co",
					market_slugs: [copied],
					people: [
						{ contact: { id: contact, name: "Alex Example" }, office: null },
					],
				},
				{ id: otherVendor, market_slugs: [copied] },
			],
		});
		for (const key of [copied, "%20Example-City%20", empty]) {
			const selected = await getMarkets(door, `?market=${key}`);
			assert.equal(selected.status, 200);
			assert.partialDeepStrictEqual(await selected.json(), {
				selected_market: key === empty ? empty : copied,
			});
		}
		const drawer = await door.request(
			{ user: "joe" },
			`vendors/${vendor}?contract=vendor-directory.v2`,
			{
				method: "GET",
			},
			{ DIRECTORY_READ_SCHEMA: "next" },
		);
		assert.equal(drawer.status, 200);
		assert.partialDeepStrictEqual(await drawer.json(), {
			record: { id: vendor },
		});
		await refused(await getMarkets(door, "?market=nowhere"), 404);
	}));

test("an empty registry answers empty, and one over either cap is refused", () =>
	withMarkets(async (door) => {
		const response = await getMarkets(door, "?market=Anywhere");
		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), {
			ok: true,
			schema_version: "vendor-markets.v1",
			state: "empty",
			selected_market: null,
			markets: [],
			vendors: [],
		});
		await door.db.query(`
			select set_config('engine.job', 'old_system', true);
			with m as (insert into market (name) select 'Example ' || i from generate_series(1, 101) i returning id, name),
				t as (insert into territory (name) select name from m returning id, name)
			insert into territory_piece (territory_id, market_id)
				select t.id, m.id from t join m using (name) where m.name <> 'Example 101';
			with p as (insert into party (kind, name) select 'person', 'Example' from generate_series(1, 50) returning id)
			insert into party_role (party_id, role) select id, 'vendor' from p;
			insert into party_territory (party_id, territory_id)
				select pr.party_id, t.id from party_role pr cross join territory t where t.name <> 'Example 101';
		`);
		assert.equal((await getMarkets(door)).status, 200);
		await door.db.query(`
			select set_config('engine.job', 'old_system', true);
			with p as (insert into party (kind, name) values ('person', 'One more') returning id),
				r as (insert into party_role (party_id, role) select id, 'vendor' from p returning party_id)
			insert into party_territory (party_id, territory_id)
				select party_id, t.id from r cross join territory t where t.name = 'Example 1';
		`);
		await refused(await getMarkets(door), 422);
		await door.db.query(`
			select set_config('engine.job', 'old_system', true);
			delete from party_territory where party_id in (select id from party where name = 'One more');
			insert into territory_piece (territory_id, market_id)
				select t.id, m.id from territory t join market m using (name) where m.name = 'Example 101';
		`);
		await refused(await getMarkets(door), 422);
	}));
