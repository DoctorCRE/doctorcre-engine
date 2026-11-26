import assert from "node:assert/strict";
import { test } from "node:test";
import { copyTest, readSchema } from "./test-copy.ts";

const shore = "00000000-0000-4000-8000-000000000001";
const towns =
	"select m.name, c.city, c.changed_by_job from market_city c join market m on m.id = c.market_id order by c.city";

test("an existing schema gains market towns, and the seed lists them only for markets that exist", async (t) => {
	const { db, setup, cleanup } = copyTest();
	await setup();
	t.after(cleanup);
	await db.query("drop table market_city");
	const migration = await readSchema("add-market-cities.sql");
	const seed = await readSchema("seed-market-cities.sql");
	await db.query(migration);
	await db.query(migration);

	await db.query(seed);
	assert.deepEqual((await db.query(towns)).rows, []);

	await db.query(`begin; set local engine.job = 'old_system';
		insert into market (id, name) values ('${shore}', 'Eastern Shore'), (gen_random_uuid(), 'Example Bay');
		commit;`);
	await db.query(seed);
	await db.query(seed);
	assert.deepEqual(
		(await db.query(towns)).rows,
		["Daphne", "Fairhope", "Montrose", "Point Clear", "Spanish Fort"].map(
			(city) => ({ name: "Eastern Shore", city, changed_by_job: "agent" }),
		),
	);

	await db.query("set role engine; set engine.job = 'agent'");
	await assert.rejects(
		db.query(`insert into market_city values ('${shore}', 'FAIRHOPE')`),
		{ code: "23505", constraint: "market_city_once" },
	);
	await assert.rejects(
		db.query(`insert into market_city values ('${shore}', ' Example Town')`),
		{ code: "23514" },
	);
	await db.query(`delete from market_city where city = 'Montrose';
		insert into market_city values ('${shore}', 'Example Town')`);
	await db.query("set role engine_reader");
	assert.equal((await db.query(towns)).rows.length, 5);
});
