import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const user = { user: "example-partner" };
const partner = randomUUID();
const tenant = randomUUID();
const landlord = randomUUID();
const northClinic = randomUUID();
const northDental = randomUUID();
const southClinic = randomUUID();
const northDeal = randomUUID();
const dentalDeal = randomUUID();
const southDeal = randomUUID();
const lease = randomUUID();
const unsignedLease = randomUUID();
const dealless = randomUUID();
const loi = randomUUID();
const signed = randomUUID();
const amendment = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into role values ('client', 'Client'), ('landlord', 'Landlord');
		insert into how_found values ('referral', 'Referral');
		insert into party (id, kind, name, how_found) values
			('${partner}', 'person', 'Example Partner', null),
			('${tenant}', 'company', 'Example Tenant Clinic', 'referral'),
			('${landlord}', 'company', 'Example Landlord', null);
		insert into party_role (party_id, role) values ('${tenant}', 'client');
		insert into app_user (id, slug) values ('${partner}', '${user.user}');
		insert into market (name) values ('Example North'), ('Example South');
		insert into market_county (market_id, county_fips)
			select id, case name when 'Example North' then '99001' else '99002' end from market;
		insert into property (id, address, county_fips, building_type) values
			('${northClinic}', '1 Example North Road', '99001', 'Medical office'),
			('${northDental}', '2 Example North Road', '99001', 'Dental'),
			('${southClinic}', '3 Example South Road', '99002', 'Medical office');
		insert into deal (id, name, owner_user_id) values
			('${northDeal}', 'Example North Clinic', '${partner}'),
			('${dentalDeal}', 'Example North Dental', '${partner}'),
			('${southDeal}', 'Example South Clinic', '${partner}');
		insert into deal_property values
			('${northDeal}', '${northClinic}'), ('${dentalDeal}', '${northDental}'), ('${southDeal}', '${southClinic}');
		insert into deal_party (deal_id, party_id, role) values
			('${northDeal}', '${tenant}', 'client'), ('${northDeal}', '${landlord}', 'landlord'),
			('${dentalDeal}', '${landlord}', 'landlord'), ('${southDeal}', '${landlord}', 'landlord'),
			('${southDeal}', '${tenant}', 'client');
		insert into document (id, name, r2_key, r2_bucket, content_type) values
			('${loi}', 'Example LOI.pdf', 'example-loi', 'deal_documents', 'application/pdf'),
			('${signed}', 'Example lease.pdf', 'example-lease', 'deal_documents', 'application/pdf'),
			('${amendment}', 'Example amendment.pdf', 'example-amendment', 'deal_documents', 'application/pdf');
		insert into offer (deal_id, property_id, round, from_party_id, from_role, offered_at, status, rent_per_sf_yr, ti_per_sf) values
			('${northDeal}', '${northClinic}', 1, '${landlord}', 'landlord', '2026-03-02 15:00Z', 'countered', 32.5, 40),
			('${dentalDeal}', '${northDental}', 1, '${landlord}', 'landlord', '2026-03-03 15:00Z', 'open', 29, null),
			('${southDeal}', '${southClinic}', 1, '${landlord}', 'landlord', '2026-03-04 15:00Z', 'open', 26, null);
		insert into offer (deal_id, property_id, round, answers_round, from_party_id, from_role, offered_at, status, rent_per_sf_yr)
			values ('${northDeal}', '${northClinic}', 2, 1, '${tenant}', 'client', '2026-04-01 15:00Z', 'accepted', 31);
		insert into offer_document select id, '${loi}' from offer where deal_id = '${northDeal}' and round = 1;
		insert into lease (id, party_id, property_id, deal_id) values
			('${lease}', '${tenant}', '${northClinic}', '${northDeal}'),
			('${unsignedLease}', '${tenant}', '${southClinic}', '${southDeal}'),
			('${dealless}', '${tenant}', '${southClinic}', null);
		insert into lease_version (lease_id, version, document_id, executed_on, expiration_on, rent_per_sf_yr, nnn_per_sf_yr, expense_structure) values
			('${lease}', 1, '${signed}', '2026-05-01', '2031-05-31', 31, 9.25, 'NNN'),
			('${lease}', 2, '${amendment}', '2026-09-01', '2033-05-31', 33, null, 'NNN'),
			('${unsignedLease}', 1, '${signed}', null, '2031-05-31', 27, null, null),
			('${dealless}', 1, '${signed}', '2026-02-01', '2031-05-31', 99, null, null);
		commit;`);
});
after(cleanup);

const read = async (query: string) => {
	const [status, body] = await save(user, `market-terms${query}`, {}, "GET");
	assert.equal(status, 200, JSON.stringify(body));
	return body as { rows: Record<string, unknown>[] };
};
const summary = ({ rows }: { rows: Record<string, unknown>[] }) =>
	rows.map((row) =>
		[
			row.deal_name,
			row.stage,
			row.number,
			row.term,
			row.value,
			row.superseded,
		].join(" "),
	);

test("compares the recorded rounds and signed leases on properties in one market and use type", async () => {
	const body = await read("?market=example north&use_type=MEDICAL OFFICE");
	assert.deepEqual(summary(body), [
		"Example North Clinic lease 2 rent_per_sf_yr 33 false",
		"Example North Clinic lease 1 rent_per_sf_yr 31 true",
		"Example North Clinic lease 1 nnn_per_sf_yr 9.25 true",
		"Example North Clinic round 2 rent_per_sf_yr 31 false",
		"Example North Clinic round 1 rent_per_sf_yr 32.5 true",
		"Example North Clinic round 1 ti_per_sf 40 true",
	]);
	assert.deepEqual(body.rows.at(-1), {
		deal_id: northDeal,
		deal_name: "Example North Clinic",
		property: { id: northClinic, name: null, address: "1 Example North Road" },
		stage: "round",
		number: 1,
		recorded_on: "2026-03-02",
		term: "ti_per_sf",
		value: 40,
		expense_structure: null,
		superseded: true,
		documents: [{ id: loi, name: "Example LOI.pdf" }],
	});
	assert.deepEqual(body.rows[0]?.documents, [
		{ id: amendment, name: "Example amendment.pdf" },
	]);
	assert.equal(body.rows[0]?.expense_structure, "NNN");
});

test("as of a date shows only what was recorded by then, and what had replaced it by then", async () => {
	assert.deepEqual(
		summary(
			await read(
				"?market=Example North&use_type=Medical office&as_of=2026-05-15",
			),
		),
		[
			"Example North Clinic lease 1 rent_per_sf_yr 31 false",
			"Example North Clinic lease 1 nnn_per_sf_yr 9.25 false",
			"Example North Clinic round 2 rent_per_sf_yr 31 false",
			"Example North Clinic round 1 rent_per_sf_yr 32.5 true",
			"Example North Clinic round 1 ti_per_sf 40 true",
		],
	);
	assert.deepEqual(
		summary(await read("?market=Example North&as_of=2026-03-03")),
		[
			"Example North Dental round 1 rent_per_sf_yr 29 false",
			"Example North Clinic round 1 rent_per_sf_yr 32.5 false",
			"Example North Clinic round 1 ti_per_sf 40 false",
		],
	);
});

test("an unsigned lease shows until a date is asked for, and a lease with no deal never shows", async () => {
	assert.deepEqual(summary(await read("?market=Example South")), [
		"Example South Clinic round 1 rent_per_sf_yr 26 false",
		"Example South Clinic lease 1 rent_per_sf_yr 27 false",
	]);
	assert.deepEqual(
		summary(await read("?market=Example South&as_of=2026-12-31")),
		["Example South Clinic round 1 rent_per_sf_yr 26 false"],
	);
});

test("blank filters cover every market, and an unknown market has no terms", async () => {
	const all = await read("?market=&use_type=");
	assert.equal(new Set(all.rows.map((row) => row.deal_id)).size, 3);
	assert.deepEqual((await read("?market=Example East")).rows, []);
});

test("leaves out the open deal's own rounds and leases, in its market and across all markets", async () => {
	assert.deepEqual(
		summary(await read(`?market=Example North&exclude_deal_id=${northDeal}`)),
		["Example North Dental round 1 rent_per_sf_yr 29 false"],
	);
	const all = await read(`?exclude_deal_id=${southDeal}`);
	assert.deepEqual([...new Set(all.rows.map((row) => row.deal_name))].sort(), [
		"Example North Clinic",
		"Example North Dental",
	]);
});

test("refuses a date that is not a calendar date, a deal that is not an id, and an unknown field", async () => {
	assert.partialDeepStrictEqual(
		await save(user, "market-terms?as_of=2026-02-30", {}, "GET"),
		[400, { error: "invalid_field_value", fields: ["as_of"] }],
	);
	assert.partialDeepStrictEqual(
		await save(user, "market-terms?exclude_deal_id=example-deal", {}, "GET"),
		[400, { error: "invalid_field_value", fields: ["exclude_deal_id"] }],
	);
	assert.partialDeepStrictEqual(
		await save(user, "market-terms?submarket=Example North", {}, "GET"),
		[400, {}],
	);
});
