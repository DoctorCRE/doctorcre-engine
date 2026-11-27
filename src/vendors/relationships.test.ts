import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";
import type { VendorRelationships } from "./relationships.ts";

const { db, setup, cleanup, request } = doorTest();
const [joe, dell, helper] = [randomUUID(), randomUUID(), randomUUID()];
const [lender, otherLender] = [randomUUID(), randomUUID()];
const [sentDeal, sentLoose, chosen, passed, unknown, worked] = [
	randomUUID(),
	randomUUID(),
	randomUUID(),
	randomUUID(),
	randomUUID(),
	randomUUID(),
];
const [friend, exFriend, contact] = [randomUUID(), randomUUID(), randomUUID()];
const [sentSuite, chosenSuite, passedSuite, workedSuite] = [
	randomUUID(),
	randomUUID(),
	randomUUID(),
	randomUUID(),
];
const intro = {
	sent: randomUUID(),
	loose: randomUUID(),
	chosen: randomUUID(),
	passed: randomUUID(),
	unknown: randomUUID(),
	other: randomUUID(),
};

before(async () => {
	await setup();
	const clients = [sentDeal, sentLoose, chosen, passed, unknown, worked];
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into phase values ('negotiation', 'Negotiation'), ('closed', 'Closed');
		insert into how_found values ('referral', 'Referral');
		insert into role values ('client', 'Client', null), ('vendor', 'Vendor', null),
			('lender', 'Lender', 'vendor');
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example Partner One'), ('${dell}', 'person', 'Example Partner Two'),
			('${helper}', 'person', 'Example Helper'),
			('${lender}', 'company', 'Example Bank'), ('${otherLender}', 'company', 'Example Credit Union'),
			('${sentDeal}', 'company', 'Example Alder Dental'), ('${sentLoose}', 'person', 'Example Birch'),
			('${chosen}', 'company', 'Example Cedar Vision'), ('${passed}', 'company', 'Example Dogwood Vet'),
			('${unknown}', 'person', 'Example Elm'), ('${worked}', 'company', 'Example Fir Clinic'),
			('${friend}', 'person', 'Example Friend'), ('${exFriend}', 'person', 'Example Former Friend'),
			('${contact}', 'person', 'Example Contact');
		update party set how_found = 'referral' where id in (${clients.map((id) => `'${id}'`)});
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell'), ('${helper}', 'helper');
		insert into party_role (party_id, role, owner_user_id) values
			('${lender}', 'vendor', '${dell}'), ('${lender}', 'lender', null),
			('${otherLender}', 'vendor', null), ('${otherLender}', 'lender', null),
			${clients.map((id) => `('${id}', 'client', null)`)};
		insert into deal (id, name, owner_user_id) values
			('${sentSuite}', 'Example Alder Suite', '${joe}'), ('${chosenSuite}', 'Example Cedar Suite', '${dell}'),
			('${passedSuite}', 'Example Dogwood Suite', '${joe}'), ('${workedSuite}', 'Example Fir Suite', '${joe}');
		insert into deal_party (deal_id, party_id, role) values
			('${sentSuite}', '${sentDeal}', 'client'), ('${chosenSuite}', '${chosen}', 'client'),
			('${passedSuite}', '${passed}', 'client'), ('${workedSuite}', '${worked}', 'client'),
			('${chosenSuite}', '${lender}', 'lender'), ('${workedSuite}', '${lender}', 'lender'),
			('${passedSuite}', '${otherLender}', 'lender');
		insert into deal_phase_change (deal_id, happened_at, phase) values
			('${sentSuite}', '2026-01-01', 'negotiation'), ('${chosenSuite}', '2026-01-01', 'negotiation'),
			('${passedSuite}', '2026-01-01', 'negotiation'), ('${workedSuite}', '2026-01-01', 'negotiation'),
			('${workedSuite}', '2026-02-02 18:00Z', 'closed');
		insert into introduction (id, vendor_id, made_by, introduced_by_user_id, introduced_party_id, introduced_on, deal_id, note) values
			('${intro.sent}', '${lender}', 'vendor', null, '${sentDeal}', '2026-01-02', '${sentSuite}', 'Example note one'),
			('${intro.loose}', '${lender}', 'vendor', null, '${sentLoose}', '2026-01-03', null, 'Example note two'),
			('${intro.chosen}', '${lender}', 'team', '${joe}', '${chosen}', '2026-01-04', '${chosenSuite}', 'Example note three'),
			('${intro.passed}', '${lender}', 'team', '${dell}', '${passed}', '2026-01-05', '${passedSuite}', 'Example note four'),
			('${intro.unknown}', '${lender}', 'team', '${helper}', '${unknown}', null, null, 'Example note five'),
			('${intro.other}', '${otherLender}', 'vendor', null, '${sentLoose}', '2026-01-06', null, 'Example note six');
		insert into party_link (kind, party_id, other_party_id, started_on, ended_on) values
			('knows', '${friend}', '${lender}', null, null),
			('knows', '${lender}', '${exFriend}', '2025-01-01', '2025-06-01'),
			('knows', '${otherLender}', '${contact}', null, null),
			('can_introduce', '${lender}', '${contact}', null, null),
			('can_introduce', '${friend}', '${lender}', null, null);
		commit;`);
});
after(cleanup);

const read = (vendor: string) =>
	request({ user: "joe" }, `vendors/${vendor}/relationships`, {
		method: "GET",
	});
const party = (party_id: string, name: string) => ({ party_id, name });
const deal = (id: string, name: string, open: boolean) => ({ id, name, open });

test("a vendor's relationships: who it sent us, who we sent it, where it was chosen, and who it knows", async () => {
	const response = await read(lender);
	assert.equal(response.status, 200, await response.clone().text());
	assert.deepEqual(await response.json(), {
		relationship_partner: "dell",
		sent_us: [
			{
				introduction_id: intro.loose,
				client: party(sentLoose, "Example Birch"),
				deal: null,
				introduced_on: "2026-01-03",
			},
			{
				introduction_id: intro.sent,
				client: party(sentDeal, "Example Alder Dental"),
				deal: deal(sentSuite, "Example Alder Suite", true),
				introduced_on: "2026-01-02",
			},
		],
		we_sent_them: [
			{
				introduction_id: intro.passed,
				client: party(passed, "Example Dogwood Vet"),
				deal: deal(passedSuite, "Example Dogwood Suite", true),
				introduced_on: "2026-01-05",
				introduced_by: "dell",
				chosen: false,
			},
			{
				introduction_id: intro.chosen,
				client: party(chosen, "Example Cedar Vision"),
				deal: deal(chosenSuite, "Example Cedar Suite", true),
				introduced_on: "2026-01-04",
				introduced_by: "joe",
				chosen: true,
			},
			{
				introduction_id: intro.unknown,
				client: party(unknown, "Example Elm"),
				deal: null,
				introduced_on: null,
				introduced_by: null,
				chosen: false,
			},
		],
		worked_with: [
			{
				...deal(workedSuite, "Example Fir Suite", false),
				client: party(worked, "Example Fir Clinic"),
			},
		],
		knows: [party(friend, "Example Friend")],
		can_introduce: [party(contact, "Example Contact")],
		counts: { sent_us: 2, we_sent_them: 3, chosen: 1, knows: 1 },
	});
});

test("another vendor keeps its own rows, has no partner, and a non-vendor is not found", async () => {
	const response = await read(otherLender);
	assert.equal(response.status, 200, await response.clone().text());
	const { relationship_partner, sent_us, worked_with, knows } =
		(await response.json()) as VendorRelationships;
	assert.equal(relationship_partner, null);
	assert.deepEqual(
		sent_us.map((i) => i.introduction_id),
		[intro.other],
	);
	assert.deepEqual(worked_with, [
		{
			...deal(passedSuite, "Example Dogwood Suite", true),
			client: party(passed, "Example Dogwood Vet"),
		},
	]);
	assert.deepEqual(knows, [party(contact, "Example Contact")]);
	assert.equal((await read(chosen)).status, 404);
	assert.equal((await read("not-a-uuid")).status, 404);
});
