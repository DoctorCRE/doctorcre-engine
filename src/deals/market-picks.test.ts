import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save, request } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ACCOUNT, EMPTY, PERSON, COMPANY, FORMER, FUTURE, OTHER, ALPHA, ZULU] = [
	id(1),
	id(2),
	id(3),
	id(4),
	id(5),
	id(6),
	id(7),
	id(8),
	id(9),
];
const firstPartner = { user: "partner_one" };
const partners = [firstPartner, { user: "partner_two" }];
const locations = (account: string) => `national-accounts/${account}/locations`;

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into role values ('client', 'Client'), ('national_account', 'National account');
		insert into how_found values ('referral', 'Referral');
		insert into party (id, kind, name) values
			('${id(10)}', 'person', 'Example First Partner'), ('${id(11)}', 'person', 'Example Second Partner'),
			('${ACCOUNT}', 'company', 'Example Account'), ('${EMPTY}', 'company', 'Example Empty Account'),
			('${OTHER}', 'company', 'Example Other Account');
		insert into party (id, kind, name, how_found) values
			('${PERSON}', 'person', 'Zulu Location', 'referral'), ('${COMPANY}', 'company', 'Alpha Location', 'referral'),
			('${FORMER}', 'company', 'Example Former Location', 'referral'), ('${FUTURE}', 'person', 'Example Future Location', 'referral');
		insert into app_user (id, slug) values ('${id(10)}', 'partner_one'), ('${id(11)}', 'partner_two');
		insert into party_role (party_id, role)
		select id, case when id in ('${ACCOUNT}', '${EMPTY}', '${OTHER}') then 'national_account' else 'client' end
		from party where id not in (select id from app_user);
		insert into national_account (party_id)
		select party_id from party_role where role = 'national_account';
		insert into client (party_id) select party_id from party_role where role = 'client';
		insert into client_brand (location_id, brand_id, started_on, ended_on) values
			('${PERSON}', '${ACCOUNT}', '2020-01-01', null),
			('${COMPANY}', '${ACCOUNT}', '2020-01-01', null),
			('${FORMER}', '${ACCOUNT}', '2020-01-01', '2021-01-01'),
			('${FORMER}', '${OTHER}', '2021-01-01', null),
			('${FUTURE}', '${ACCOUNT}', '2999-01-01', null);
		commit;`);
});
after(cleanup);

test("both partners can read every market in name order, even without any deals", async () => {
	for (const partner of partners)
		assert.deepEqual(await save(partner, "markets", {}, "GET"), [200, []]);

	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into market (id, name) values ('${ZULU}', 'Zulu Market'), ('${ALPHA}', 'Alpha Market');
		commit;`);
	for (const partner of partners)
		assert.deepEqual(await save(partner, "markets", {}, "GET"), [
			200,
			[
				{ market_id: ALPHA, name: "Alpha Market" },
				{ market_id: ZULU, name: "Zulu Market" },
			],
		]);
});

test("both partners see only the account's current people and companies, ordered by name", async () => {
	for (const partner of partners) {
		assert.deepEqual(await save(partner, locations(ACCOUNT), {}, "GET"), [
			200,
			[
				{ party_id: COMPANY, name: "Alpha Location", kind: "company" },
				{ party_id: PERSON, name: "Zulu Location", kind: "person" },
			],
		]);
		assert.deepEqual(await save(partner, locations(EMPTY), {}, "GET"), [
			200,
			[],
		]);
	}
});

test("the market deal choices require a signed-in partner", async () => {
	for (const path of ["markets", locations(ACCOUNT)]) {
		const response = await request(firstPartner, path, {
			method: "GET",
			headers: { Cookie: "" },
		});
		assert.equal(response.status, 401);
	}
});
