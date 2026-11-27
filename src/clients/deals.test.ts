import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";
import type { ClientDeal } from "./deals.ts";

const { db, setup, cleanup, request } = doorTest();
const joe = randomUUID();
const dell = randomUUID();
const practice = randomUUID();
const doctor = randomUUID();
const other = randomUUID();
const lender = randomUUID();
const passedLender = randomUUID();
const attorney = randomUUID();
const openDeal = randomUUID();
const closedDeal = randomUUID();
const doctorDeal = randomUUID();
const otherDeal = randomUUID();
const chosenIntro = randomUUID();
const passedIntro = randomUUID();
const dealless = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into phase values ('negotiation', 'Negotiation'), ('closed', 'Closed');
		insert into how_found values ('referral', 'Referral');
		insert into role values ('client', 'Client', null), ('vendor', 'Vendor', null),
			('lender', 'Lender', 'vendor'), ('attorney', 'Attorney', 'vendor');
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example Partner One'), ('${dell}', 'person', 'Example Partner Two'),
			('${practice}', 'company', 'Example Birch Dental'), ('${doctor}', 'person', 'Example Reed'),
			('${other}', 'company', 'Example Other Clinic'), ('${lender}', 'company', 'Example Bank'),
			('${passedLender}', 'company', 'Example Credit Union'), ('${attorney}', 'person', 'Example Counsel');
		update party set how_found = 'referral' where id in ('${practice}', '${doctor}', '${other}', '${lender}');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into party_role (party_id, role) values ('${practice}', 'client'), ('${doctor}', 'client'),
			('${other}', 'client'), ('${lender}', 'vendor'), ('${passedLender}', 'vendor'), ('${attorney}', 'vendor');
		insert into client (party_id) values ('${practice}'), ('${other}');
		insert into party_company (person_id, company_id) values ('${doctor}', '${practice}');
		insert into deal (id, name, owner_user_id) values
			('${openDeal}', 'Example Open Suite', '${joe}'), ('${closedDeal}', 'Example Closed Suite', '${dell}'),
			('${doctorDeal}', 'Example Reed Office', '${joe}'), ('${otherDeal}', 'Example Other Suite', '${joe}');
		insert into deal_party (deal_id, party_id, role) values
			('${openDeal}', '${practice}', 'client'), ('${closedDeal}', '${practice}', 'client'),
			('${doctorDeal}', '${doctor}', 'client'), ('${otherDeal}', '${other}', 'client'),
			('${openDeal}', '${lender}', 'lender'), ('${openDeal}', '${attorney}', 'attorney'),
			('${otherDeal}', '${passedLender}', 'lender');
		insert into deal_phase_change (deal_id, happened_at, phase) values
			('${openDeal}', '2026-01-01', 'negotiation'), ('${doctorDeal}', '2026-01-01', 'negotiation'),
			('${closedDeal}', '2026-01-01', 'negotiation'), ('${closedDeal}', '2026-02-02 18:00Z', 'closed');
		insert into introduction (id, vendor_id, made_by, introduced_by_user_id, introduced_party_id, introduced_on, deal_id, note) values
			('${chosenIntro}', '${lender}', 'team', '${dell}', '${practice}', '2026-01-05', '${openDeal}', 'Example note one'),
			('${passedIntro}', '${passedLender}', 'team', '${joe}', '${practice}', '2026-01-06', '${openDeal}', 'Example note two'),
			('${dealless}', '${attorney}', 'team', '${joe}', '${practice}', '2026-01-07', null, 'Example note three');
		commit;`);
});
after(cleanup);

const read = (client: string) =>
	request({ user: "joe" }, `clients/${client}/deals`, { method: "GET" });

const introduction = (
	id: string,
	vendor: [string, string],
	partner: string,
	on: string,
	note: string,
	chosen: boolean,
) => ({
	id,
	vendor_id: vendor[0],
	vendor_name: vendor[1],
	made_by: "team",
	introduced_by: partner,
	introduced_party_id: practice,
	introduced_party_name: "Example Birch Dental",
	introduced_on: on,
	note,
	chosen,
});

test("a client's deals, its linked people's too, carry their vendors and the introductions made for them", async () => {
	const response = await read(practice);
	assert.equal(response.status, 200, await response.clone().text());
	const { deals } = (await response.json()) as { deals: ClientDeal[] };
	const deal = (id: string, name: string, owner: string) => ({
		id,
		name,
		owner,
	});
	assert.deepEqual(deals, [
		{
			...deal(openDeal, "Example Open Suite", "joe"),
			phase: "negotiation",
			phase_label: "Negotiation",
			open: true,
			closed_on: null,
			vendors: [
				{
					party_id: lender,
					name: "Example Bank",
					roles: [{ role: "lender", label: "Lender" }],
					introduction_id: chosenIntro,
				},
				{
					party_id: attorney,
					name: "Example Counsel",
					roles: [{ role: "attorney", label: "Attorney" }],
					introduction_id: null,
				},
			],
			introductions: [
				introduction(
					chosenIntro,
					[lender, "Example Bank"],
					"dell",
					"2026-01-05",
					"Example note one",
					true,
				),
				introduction(
					passedIntro,
					[passedLender, "Example Credit Union"],
					"joe",
					"2026-01-06",
					"Example note two",
					false,
				),
			],
		},
		{
			...deal(doctorDeal, "Example Reed Office", "joe"),
			phase: "negotiation",
			phase_label: "Negotiation",
			open: true,
			closed_on: null,
			vendors: [],
			introductions: [],
		},
		{
			...deal(closedDeal, "Example Closed Suite", "dell"),
			phase: "closed",
			phase_label: "Closed",
			open: false,
			closed_on: "2026-02-02",
			vendors: [],
			introductions: [],
		},
	]);
});

test("a party that is not a client is not found, and a client with no deals has none", async () => {
	assert.equal((await read(lender)).status, 404);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party_role (party_id, role) values ('${lender}', 'client');
		insert into client (party_id) values ('${lender}'); commit;`);
	const response = await read(lender);
	assert.equal(response.status, 200, await response.clone().text());
	assert.deepEqual(await response.json(), { deals: [] });
});
