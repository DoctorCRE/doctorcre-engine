import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { copyTest, readSchema } from "../test-copy.ts";
import { type Caller, doorTest } from "../test-door.ts";

const { db, setup, cleanup, save, request } = doorTest();
const alex = randomUUID();
const blair = randomUUID();
const client = randomUUID();
const starred = randomUUID();
const plain = randomUUID();
const alexCaller = { user: "alex" };
const blairCaller = { user: "blair" };
const key = () => ({ idempotency_key: randomUUID() });

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into how_found (slug, label) values ('inbound', 'Inbound');
		insert into role (slug, label) values ('client', 'Client');
		insert into party (id, kind, name) values
			('${alex}', 'person', 'Alex Example'), ('${blair}', 'person', 'Blair Example');
		insert into party (id, kind, name, how_found) values ('${client}', 'company', 'Example Clinic', 'inbound');
		insert into party_role (party_id, role) values ('${client}', 'client');
		insert into app_user (id, slug) values ('${alex}', 'alex'), ('${blair}', 'blair');
		insert into deal (id, name, owner_user_id) values
			('${starred}', 'Example Starred Deal', '${alex}'), ('${plain}', 'Example Plain Deal', '${blair}');
		insert into deal_party (deal_id, party_id, role) values
			('${starred}', '${client}', 'client'), ('${plain}', '${client}', 'client');
		commit;`);
});
after(cleanup);

async function stars(caller: Caller) {
	const response = await request(
		caller,
		"deals",
		{ method: "GET" },
		{ DEALS_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const board = (await response.json()) as {
		deals: { id: string; starred: boolean }[];
	};
	return Object.fromEntries(board.deals.map((d) => [d.id, d.starred]));
}

test("a partner's star shows only on their own board and repeats leave the same state", async () => {
	assert.deepEqual(await stars(alexCaller), {
		[starred]: false,
		[plain]: false,
	});
	for (let i = 0; i < 2; i++)
		assert.deepEqual(
			await save(alexCaller, `deals/${starred.toUpperCase()}/star`, key()),
			[200, { deal_id: starred, starred: true }],
		);
	assert.deepEqual(await stars(alexCaller), {
		[starred]: true,
		[plain]: false,
	});
	assert.deepEqual(await stars(blairCaller), {
		[starred]: false,
		[plain]: false,
	});

	await save(blairCaller, `deals/${plain}/star`, key());
	for (let i = 0; i < 2; i++)
		assert.deepEqual(await save(alexCaller, `deals/${starred}/unstar`, key()), [
			200,
			{ deal_id: starred, starred: false },
		]);
	assert.deepEqual(await stars(alexCaller), {
		[starred]: false,
		[plain]: false,
	});
	assert.deepEqual(await stars(blairCaller), {
		[starred]: false,
		[plain]: true,
	});
});

test("a retried star replays its answer and a missing deal or key is refused", async () => {
	const retry = key();
	await save(alexCaller, `deals/${starred}/star`, retry);
	assert.deepEqual(await save(alexCaller, `deals/${starred}/star`, retry), [
		200,
		{ replayed: true, deal_id: starred, starred: true },
	]);
	assert.equal(
		(await save(alexCaller, `deals/${randomUUID()}/star`, key()))[0],
		404,
	);
	assert.equal(
		(await save(alexCaller, "deals/not-a-deal/star", key()))[0],
		404,
	);
	assert.equal((await save(alexCaller, `deals/${starred}/star`, {}))[0], 400);
	assert.equal(
		(await save({ job: "agent" }, `deals/${starred}/star`, key()))[0],
		404,
	);
});

for (const migrated of [false, true]) {
	test(
		migrated
			? "the star migration gives an existing schema the same rules"
			: "the database keeps one star per partner and deal and removes it with the deal",
		async (t) => {
			const copy = copyTest();
			await copy.setup();
			t.after(copy.cleanup);
			const rules = copy.db;
			if (migrated) {
				const migration = await readSchema("add-deal-stars.sql");
				await rules.query("drop table deal_star");
				await rules.query(migration);
				await rules.query(migration);
			}
			await rules.query(`begin; set local engine.job = 'old_system';
				insert into party (id, kind, name) values
					('${alex}', 'person', 'Alex Example'), ('${blair}', 'person', 'Blair Example');
				insert into app_user (id, slug) values ('${alex}', 'alex'), ('${blair}', 'blair');
				insert into deal (id, name, owner_user_id) values ('${starred}', 'Example Starred Deal', '${alex}');
				commit;`);
			await rules.query(`set role engine; set engine.user_id = '${alex}'`);
			const add = (user: string) =>
				rules.query(
					`insert into deal_star (user_id, deal_id) values ('${user}', '${starred}')`,
				);
			await add(alex);
			await assert.rejects(add(alex), { code: "23505" });
			await assert.rejects(add(blair), {
				code: "23514",
				constraint: "deal_star_by_its_user",
			});
			await rules.query("set engine.job = 'agent'");
			await assert.rejects(add(alex), {
				code: "23514",
				constraint: "deal_star_by_its_user",
			});
			await rules.query(
				`set engine.job = ''; delete from deal where id = '${starred}'`,
			);
			const { rows } = await rules.query(
				"select action from change where table_name = 'deal_star' order by id",
			);
			assert.deepEqual(
				rows.map((row) => row.action),
				["insert", "delete"],
			);
			assert.equal((await rules.query("select from deal_star")).rowCount, 0);
		},
	);
}
