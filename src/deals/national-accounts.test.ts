import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save, request } = doorTest();
const joe = { user: "joe" };
const accounts = "national-accounts";
const [JOE, DELL, OTHER, BRAND] = Array.from({ length: 4 }, randomUUID);

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${JOE}', 'person', 'Example One'),
			('${DELL}', 'person', 'Example Two'), ('${OTHER}', 'person', 'Example Other'),
			('${BRAND}', 'company', 'Example Established Brand');
		insert into app_user (id, slug) values ('${JOE}', 'joe'), ('${DELL}', 'dell'), ('${OTHER}', 'example');
		insert into role (slug, label) values ('national_account', 'National account');
		insert into party_role (party_id, role) values ('${BRAND}', 'national_account');
		insert into national_account (party_id) values ('${BRAND}');
		insert into national_account_owner (account_id, owner_id, started_on)
			values ('${BRAND}', '${JOE}', '2020-01-01');
		commit;`);
});
after(cleanup);

const args = (fields: object) => ({ idempotency_key: randomUUID(), ...fields });
const add = (fields: object) => save(joe, accounts, fields);
const handOff = (fields: object) =>
	save(joe, `${accounts}/${BRAND}/owner`, fields);

type Account = {
	account_client_id: string;
	account_owner: string;
	base_version: number;
};

async function boardAccount(id: unknown) {
	const response = await request(
		joe,
		"deals?workspace=national_account",
		{ method: "GET" },
		{
			DEALS_READ_SCHEMA: "next",
		},
	);
	assert.equal(response.status, 200);
	const board: { accounts: Account[] } = await response.json();
	const account = board.accounts.find((row) => row.account_client_id === id);
	assert.ok(account);
	return account;
}

test("adding an account saves its owner once and checks for duplicate company names", async () => {
	const name = "Example New Brand";
	const create = args({ name: ` ${name} `, owner: "joe" });
	const [status, added] = await add(create);
	assert.equal(status, 201);
	assert.equal(added.name, name);
	const card = await boardAccount(added.account_client_id);
	assert.equal(card.account_owner, "joe");
	assert.deepEqual(await add(create), [200, { ...added, replayed: true }]);

	const sameName = { name: name.toLowerCase(), owner: "dell" };
	const [duplicate, conflict] = await add(args(sameName));
	assert.equal(duplicate, 409);
	assert.equal(conflict.error, "account_name_exists");
	assert.deepEqual(conflict.candidates, [{ id: card.account_client_id, name }]);
	assert.equal((await add(args({ ...sameName, force_new: true })))[0], 201);
});

test("a handoff keeps the last period and stale board versions cannot undo it", async () => {
	const { base_version } = await boardAccount(BRAND);
	const first = args({ owner: "dell", base_version });
	assert.equal((await handOff(first))[0], 200);
	const [replay, receipt] = await handOff(first);
	assert.equal(replay, 200);
	assert.deepEqual(receipt, {
		account_client_id: BRAND,
		owner: "dell",
		replayed: true,
	});

	const handedOff = await boardAccount(BRAND);
	assert.equal(handedOff.account_owner, "dell");
	const [stale, refusal] = await handOff(args({ owner: "joe", base_version }));
	assert.equal(stale, 409);
	assert.equal(refusal.current_version, handedOff.base_version);
	const back = args({ owner: "joe", base_version: handedOff.base_version });
	assert.equal((await handOff(back))[0], 200);
	assert.equal((await boardAccount(BRAND)).account_owner, "joe");

	const dates = await db.query(
		`select owner_id, ended_on is null as current
		from national_account_owner where account_id = $1 order by started_on`,
		[BRAND],
	);
	assert.deepEqual(dates.rows, [
		{ owner_id: JOE, current: false },
		{ owner_id: JOE, current: true },
	]);
	const history = await db.query(
		`select id from change where table_name = 'national_account_owner'
		and old_value->>'owner_id' = $1 and new_value->>'owner_id' = $2`,
		[DELL, JOE],
	);
	assert.equal(history.rowCount, 1);
});

test("the door and the database reject an app user outside Joe and Dell", async () => {
	assert.equal(
		(await add(args({ name: "Example Refused", owner: "example" })))[0],
		400,
	);
	const refusal = {
		constraint: "national_account_owner_owner_id_owner_is_partner_fkey",
	};
	await assert
		.rejects(
			db.query(`begin; select set_config('engine.job', 'old_system', true);
		update national_account_owner set owner_id = '${OTHER}' where account_id = '${BRAND}'`),
			refusal,
		)
		.finally(() => db.query("rollback"));
	await assert.rejects(
		db.query(
			`update app_user set slug = 'example_renamed' where id = '${JOE}'`,
		),
		refusal,
	);
});
