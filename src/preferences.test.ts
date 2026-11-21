import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const alex = { user: "joe" };
const blair = { user: "dell" };

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${randomUUID()}', 'person', 'Alex Example');
		insert into app_user (id, slug) select id, '${alex.user}' from party where name = 'Alex Example';
		insert into party (id, kind, name) values ('${randomUUID()}', 'person', 'Blair Example');
		insert into app_user (id, slug) select id, '${blair.user}' from party where name = 'Blair Example';
		commit;`);
});
after(cleanup);

const read = async (caller: typeof alex) => {
	const [status, body] = await save(caller, "preferences", {}, "GET");
	assert.equal(status, 200);
	return body;
};

const preferences = {
	time_zone: "America/New_York",
	quiet_from: "22:00",
	quiet_until: "07:00",
	push_to_device: true,
};

test("A partner with no saved preferences reads the defaults", async () => {
	assert.deepEqual(await read(blair), {
		time_zone: "America/Chicago",
		quiet_from: null,
		quiet_until: null,
		push_to_device: false,
		base_version: 0,
	});
});

test("Saving preferences checks the zone, quiet hours and version", async () => {
	const refused = async (change: object, error: string, status = 400) => {
		const [code, body] = await save(alex, "preferences", {
			idempotency_key: randomUUID(),
			base_version: 0,
			...preferences,
			...change,
		});
		assert.equal(code, status);
		assert.equal(body.error, error);
		return body;
	};
	assert.deepEqual(
		(await refused({ time_zone: "Mars/Olympus" }, "invalid_field_value"))
			.fields,
		["time_zone"],
	);
	await refused({ quiet_until: "22:00" }, "invalid_field_value");
	await refused({ quiet_until: null }, "invalid_field_value");
	await refused({ quiet_from: "24:00" }, "invalid_field_value");

	const [status, saved] = await save(alex, "preferences", {
		idempotency_key: randomUUID(),
		base_version: 0,
		...preferences,
	});
	assert.equal(status, 200);
	assert.equal(typeof saved.base_version, "number");
	assert.deepEqual(await read(alex), {
		...preferences,
		base_version: saved.base_version,
	});
	assert.deepEqual((await read(blair)).time_zone, "America/Chicago");

	assert.deepEqual(
		(await refused({ push_to_device: false }, "version_conflict", 409))
			.current_version,
		saved.base_version,
	);
	const [, cleared] = await save(alex, "preferences", {
		idempotency_key: randomUUID(),
		base_version: saved.base_version,
		...preferences,
		quiet_from: null,
		quiet_until: null,
	});
	assert.equal((await read(alex)).quiet_from, null);
	assert.ok(Number(cleared.base_version) > Number(saved.base_version));
});
