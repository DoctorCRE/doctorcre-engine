import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { type Caller, doorTest } from "./test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const property = randomUUID();
const alex = randomUUID();
const blair = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into party (id, kind, name) values
			('${alex}', 'person', 'Alex Example'), ('${blair}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${alex}', 'alex'), ('${blair}', 'blair');
		insert into property (id, address) values ('${property}', '10 Example Way');
		insert into property (name, address)
		select 'Sample Pavilion ' || n, n || ' Search Court' from generate_series(1, 30) n;
		commit;`);
});
after(cleanup);

const search = (caller: Caller, query: string) =>
	save(caller, `properties/search?query=${query}`, {}, "GET");

test("both partners can find properties by name and address", async () => {
	const [status, named] = await search({ user: "alex" }, "pAVILION");
	assert.equal(status, 200);
	assert.ok(Array.isArray(named.properties));
	assert.equal(named.properties.length, 25);
	assert.deepEqual(await search({ user: "blair" }, "10%20EXAMPLE"), [
		200,
		{ properties: [{ id: property, name: null, address: "10 Example Way" }] },
	]);
});

test("search uses literal text and requires one bounded query and a partner", async () => {
	const partner = { user: "alex" };
	assert.deepEqual(await search(partner, "%25"), [200, { properties: [] }]);
	for (const query of ["", "a".repeat(101), "pavilion&query=court"]) {
		const [status, body] = await search(partner, query);
		assert.deepEqual([status, body.error], [400, "invalid_field_value"]);
	}
	assert.equal((await search({ job: "agent" }, "pavilion"))[0], 404);
});
