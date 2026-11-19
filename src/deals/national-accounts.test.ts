import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save, request, writerUrl } = doorTest();
const joe = { user: "joe" };
const accounts = "national-accounts";
const [JOE, DELL, OTHER, BRAND, SAME_OWNER_BRAND, MATCHING_COMPANY] =
	Array.from({ length: 6 }, randomUUID);
const matchingName = "Example Matching Company";

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${JOE}', 'person', 'Example One'),
			('${DELL}', 'person', 'Example Two'), ('${OTHER}', 'person', 'Example Other'),
			('${BRAND}', 'company', 'Example Established Brand'),
			('${SAME_OWNER_BRAND}', 'company', 'Example Second Brand'),
			('${MATCHING_COMPANY}', 'company', '${matchingName}');
		insert into app_user (id, slug) values ('${JOE}', 'joe'), ('${DELL}', 'dell'), ('${OTHER}', 'example');
		insert into role (slug, label) values ('national_account', 'National account');
		insert into party_role (party_id, role) values ('${BRAND}', 'national_account'),
			('${SAME_OWNER_BRAND}', 'national_account');
		insert into national_account (party_id) values ('${BRAND}'), ('${SAME_OWNER_BRAND}');
		insert into national_account_owner (account_id, owner_id, started_on)
			values ('${BRAND}', '${JOE}', '2020-01-01'),
				('${SAME_OWNER_BRAND}', '${JOE}', '2020-01-01');
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

test("choosing a matching company saves while its name lock is held and replays the first save", async () => {
	const fields = { name: matchingName.toLowerCase(), owner: "dell" };
	const [conflict, matches] = await add(args(fields));
	assert.equal(conflict, 409);
	assert.deepEqual(matches.candidates, [
		{ id: MATCHING_COMPANY, name: matchingName },
	]);
	const picked = args({ ...fields, company_id: MATCHING_COMPANY });
	const answer = {
		account_client_id: MATCHING_COMPANY,
		name: matchingName,
		owner: "dell",
	};
	const writer = new URL(writerUrl).username;
	await db.query(`alter role ${writer} set lock_timeout = '2s'`);
	try {
		await db.query("begin");
		await db.query(
			"select pg_advisory_xact_lock(hashtextextended('national account name:' || lower($1), 0))",
			[matchingName],
		);
		assert.deepEqual(await add(picked), [201, answer]);
	} finally {
		await db.query(`rollback; alter role ${writer} reset lock_timeout`);
	}
	assert.deepEqual(await add(picked), [200, { ...answer, replayed: true }]);
	assert.equal((await boardAccount(MATCHING_COMPANY)).account_owner, "dell");
	const companies = await db.query(
		"select id from party where kind = 'company' and lower(name) = lower($1)",
		[matchingName],
	);
	assert.deepEqual(companies.rows, [{ id: MATCHING_COMPANY }]);
});

test("choosing a person or an unknown company returns not_found", async () => {
	for (const company_id of [JOE, randomUUID()]) {
		const [status, refusal] = await add(
			args({ name: "Example Unavailable Company", owner: "joe", company_id }),
		);
		assert.equal(status, 404);
		assert.equal(refusal.error, "not_found");
	}
});

test("choosing a merged-away company returns not_found", async () => {
	const duplicate = randomUUID();
	const survivor = randomUUID();
	const name = "Example Merged Company";
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${duplicate}', 'company', '${name}'),
			('${survivor}', 'company', 'Example Surviving Company');
		select merge_party('${duplicate}', '${survivor}'); commit;`);
	const [status, refusal] = await add(
		args({ name, owner: "joe", company_id: duplicate }),
	);
	assert.equal(status, 404);
	assert.equal(refusal.error, "not_found");
});

test("choosing an existing national account leaves its owner in place", async () => {
	const [status, refusal] = await add(
		args({
			name: "Example Second Brand",
			owner: "dell",
			company_id: SAME_OWNER_BRAND,
		}),
	);
	assert.equal(status, 409);
	assert.equal(refusal.error, "already_national_account");
	assert.equal((await boardAccount(SAME_OWNER_BRAND)).account_owner, "joe");
});

test("a company choice is exclusive with force_new", async () => {
	for (const force_new of [true, false]) {
		const [status, refusal] = await add(
			args({
				name: "Example Second Brand",
				owner: "joe",
				company_id: SAME_OWNER_BRAND,
				force_new,
			}),
		);
		assert.equal(status, 400);
		assert.equal(refusal.error, "invalid_field_value");
		assert.deepEqual(refusal.fields, ["company_id", "force_new"]);
	}
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
		and action = 'delete' and old_value->>'owner_id' = $1 and old_value->>'account_id' = $2`,
		[DELL, BRAND],
	);
	assert.equal(history.rowCount, 1);
});

test("a handoff to the current owner leaves the dated ownership rows unchanged", async () => {
	const { base_version } = await boardAccount(SAME_OWNER_BRAND);
	const [status] = await save(
		joe,
		`${accounts}/${SAME_OWNER_BRAND}/owner`,
		args({ owner: "joe", base_version }),
	);
	assert.equal(status, 200);

	const dates = await db.query(
		`select owner_id, started_on::text, ended_on::text
		from national_account_owner where account_id = $1 order by started_on`,
		[SAME_OWNER_BRAND],
	);
	assert.deepEqual(dates.rows, [
		{ owner_id: JOE, started_on: "2020-01-01", ended_on: null },
	]);
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
