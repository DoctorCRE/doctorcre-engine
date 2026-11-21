import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { copyTest, readSchema } from "../test-copy.ts";
import worker from "../worker.ts";

const { db, setup, cleanup, connectionString } = copyTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

before(async () => {
	await setup();
	await db.query(`
		insert into public.actor (id, slug, kind, display_name)
			values ('${id(1)}', 'fit-partner', 'human', 'Example Partner');
		insert into public.contact_state (slug, label, sort, contactable) values ('active', 'Active', 1, true);
		insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Lease', 1);
		insert into public.deal_phase (slug, label) values ('closed', 'Closed'), ('touring', 'Touring') on conflict do nothing;
		insert into public.party (id, kind, name, state, created_by, updated_by)
			values ('${id(2)}', 'org', 'Example Clinic', 'IL', '${id(1)}', '${id(1)}');
		insert into public.client_status (slug, label) values ('engaged', 'Engaged') on conflict do nothing;
		insert into public.client (id, party_id, status, vertical, created_by, updated_by)
			values ('${id(3)}', '${id(2)}', 'engaged', 'Example Dental', '${id(1)}', '${id(1)}');
		insert into public.deal (name, client_id, deal_type, phase, outcome, closed_on, city, owner, created_by, updated_by)
			select 'Example Copied Win ' || n, '${id(3)}', 'lease', 'closed', 'won',
				case when n <= 5 then date '2024-06-01' end,
				'Example Market ' || ((n - 1) % 5 + 1), 'fit-partner', '${id(1)}', '${id(1)}'
			from generate_series(1, 51) n;
	`);
	for (const [file, input] of [
		["copy-parties.sql", ""],
		["copy-leads-clients.sql", ""],
		["copy-client-research.sql", ""],
		[
			"copy-deals.sql",
			`
			insert into market (name) select 'Example Market ' || n from generate_series(1, 5) n;
			insert into market_county (market_id, county_fips) select id, '17001' from market;
		`,
		],
	] as const) {
		await db.query(
			`begin; select set_config('engine.job', 'old_system', true); ${input} ${await readSchema(file)} commit;`,
		);
	}

	await db.query(`
		begin;
		select set_config('engine.user_id', (select id::text from app_user where slug = 'fit-partner'), true);
		insert into market (id, name) values ('${id(4)}', 'Example New Market'), ('${id(5)}', 'Example Cross-Border Market');
		insert into market_county (market_id, county_fips) values
			('${id(4)}', '29001'), ('${id(4)}', '29003'), ('${id(5)}', '17001'), ('${id(5)}', '29001');
		insert into party (id, kind, name, how_found) values
			('${id(6)}', 'person', 'Example New Client', 'referral'), ('${id(7)}', 'company', 'Example Client Without a Vertical', 'referral');
		insert into party_role (party_id, role) values ('${id(6)}', 'client'), ('${id(7)}', 'client');
		insert into client (party_id) values ('${id(6)}'), ('${id(7)}');
		insert into specialty (slug, label) values ('optometry', 'Example Optometry');
		insert into party_specialty (person_id, specialty) values ('${id(6)}', 'optometry');
		insert into deal (id, name, kind, market_id, owner_user_id)
			select v.id::uuid, v.name, 'lease', v.market_id::uuid, u.id
			from app_user u cross join (values
				('${id(10)}', 'Example New Win', '${id(4)}'),
				('${id(11)}', 'Example Open Deal', '${id(4)}'),
				('${id(12)}', 'Example Lost Deal', '${id(4)}'),
				('${id(13)}', 'Example Unrecorded Win', null),
				('${id(14)}', 'Example Cross-Border Win', '${id(5)}'),
				('${id(15)}', 'Example Future Win', '${id(4)}'),
				('${id(16)}', 'Example Win With Premises', '${id(5)}')
			) v(id, name, market_id) where u.slug = 'fit-partner';
		insert into deal_party (deal_id, party_id, role) values
			('${id(10)}', '${id(6)}', 'client'), ('${id(11)}', '${id(6)}', 'client'),
			('${id(12)}', '${id(6)}', 'client'), ('${id(13)}', '${id(7)}', 'client'),
			('${id(14)}', '${id(7)}', 'client'), ('${id(15)}', '${id(6)}', 'client'),
			('${id(16)}', '${id(7)}', 'client');
		insert into deal_phase_change (deal_id, happened_at, phase, reason) values
			('${id(10)}', '2025-11-22 02:00Z', 'closed', null),
			('${id(11)}', '2025-11-21 02:00Z', 'closed', null),
			('${id(11)}', '2025-11-22 02:00Z', 'touring', null),
			('${id(12)}', '2025-11-22 02:00Z', 'dead', 'Example reason'),
			('${id(13)}', '2025-11-22 02:00Z', 'closed', null),
			('${id(14)}', '2025-11-22 02:00Z', 'closed', null),
			('${id(15)}', current_date + interval '2 days', 'closed', null),
			('${id(16)}', '2025-11-22 02:00Z', 'closed', null);
		insert into property (id, address, county_fips) values ('${id(17)}', 'Example address', '17003');
		insert into deal_property (deal_id, property_id) values ('${id(16)}', '${id(17)}');
		insert into lease (deal_id, party_id, property_id) values ('${id(16)}', '${id(7)}', '${id(17)}');
		commit;
	`);
});
after(cleanup);

const get = (query = "") =>
	worker.request(
		`https://app.example.test/api/engine/client-fit${query}`,
		{ headers: { Cookie: "__Host-dealroom_session=made-up-session" } },
		{
			DATABASE: { connectionString },
			CARR: {
				fetch: async () =>
					Response.json({
						actor: { slug: "fit-partner", display: "Example Partner" },
						csrf_token: "made-up-csrf",
					}),
			},
		},
	);

const profile = (
	[vertical, city, state]: [string | null, string | null, string | null],
	deal_id: string,
	deal_name: string,
	closed_on = "2025-11-21",
) => ({
	vertical,
	deal_type: "lease",
	city,
	state,
	won_deals: 1,
	clients: 1,
	evidence: [{ deal_id, closed_on, deal_name }],
	hypothesis: "Historical fit, not a prediction or qualification rule.",
});

const fit = (profiles: ReturnType<typeof profile>[]) => ({
	schema_version: "ideal-client-profile.v1",
	coverage: "recorded_closed_won_only",
	profiles,
});

const newWin = profile(
	["Example Optometry", "Example New Market", "MO"],
	id(10),
	"Example New Win",
);

test("Client Fit keeps the five copied groups and counts the newly recorded wins", async () => {
	const { rows: copied } = await db.query<{
		id: string;
		name: string;
		city: string;
	}>(
		"select id, name, city from public.deal where closed_on is not null order by city",
	);
	assert.equal(copied.length, 5);
	const response = await get();
	assert.equal(response.status, 200);
	assert.deepEqual(
		await response.json(),
		fit([
			...copied.map(({ id, name, city }) =>
				profile(["Example Dental", city, "IL"], id, name, "2024-06-01"),
			),
			newWin,
			profile(
				[null, "Example Cross-Border Market", "IL"],
				id(16),
				"Example Win With Premises",
			),
			profile(
				[null, "Example Cross-Border Market", null],
				id(14),
				"Example Cross-Border Win",
			),
			profile([null, null, null], id(13), "Example Unrecorded Win"),
		]),
	);
});

test("Client Fit keeps its exact filters, counts and source link fields", async () => {
	const path =
		"?vertical=Example%20Optometry&city=Example%20New%20Market&state=";
	const response = await get(`${path}MO`);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
	assert.deepEqual(await response.json(), fit([newWin]));
	assert.deepEqual(await (await get(`${path}mo`)).json(), fit([]));
});
