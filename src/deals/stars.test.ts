import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { copyTest, readSchema } from "../test-copy.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save, request } = doorTest();
const alex = randomUUID();
const blair = randomUUID();
const client = randomUUID();
const starred = randomUUID();
const plain = randomUUID();
const alexCaller = { user: "alex" };
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

// The doors and the board's mark are gone; the table stays until its drop has the owner's yes.
test("no star door answers and the board marks no deal starred", async () => {
	await db.query(`begin; set local role engine; set local engine.user_id = '${alex}';
		insert into deal_star (user_id, deal_id) values ('${alex}', '${starred}'); commit;`);
	for (const door of ["star", "unstar"])
		assert.equal(
			(await save(alexCaller, `deals/${starred}/${door}`, key()))[0],
			404,
		);
	const response = await request(
		alexCaller,
		"deals",
		{ method: "GET" },
		{ DEALS_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const { deals } = (await response.json()) as { deals: object[] };
	assert.equal(deals.length, 2);
	assert.ok(deals.every((deal) => !("starred" in deal)));
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
