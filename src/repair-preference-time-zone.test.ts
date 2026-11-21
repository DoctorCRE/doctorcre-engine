import assert from "node:assert/strict";
import { test } from "node:test";
import { copyTest, readSchema } from "./test-copy.ts";

const cases = [
	{
		name: "refuses zero UTC preferences",
		zones: ["America/Denver"],
		error: "Expected 1 UTC preference, found 0",
	},
	{
		name: "updates one copied UTC preference",
		zones: ["UTC", "America/Denver"],
	},
	{
		name: "refuses multiple UTC preferences",
		zones: ["UTC", "UTC"],
		error: "Expected 1 UTC preference, found 2",
	},
	{
		name: "refuses UTC set outside the copy",
		zones: ["America/Chicago"],
		explicitChoice: true,
		error:
			"The UTC preference cannot be safely attributed to the old system copy",
	},
];

cases.push({
	name: "refuses a partner saving the copied UTC preference",
	zones: ["UTC"],
	explicitChoice: false,
	error:
		"The UTC preference cannot be safely attributed to the old system copy",
});

for (const { name, zones, error, explicitChoice } of cases) {
	test(`Central time repair ${name}`, async (t) => {
		const repair = await readSchema("repair-preference-time-zone.sql");
		const { db, setup, cleanup } = copyTest();
		t.after(cleanup);
		await setup();
		await db.query(`begin;
			select set_config('engine.job', 'old_system', true);
			with people as (
				insert into party (kind, name) values ('person', 'Example 1'), ('person', 'Example 2') returning id, name
			) insert into app_user (id, slug) select id, name from people;`);
		await db.query(
			`insert into user_preference (user_id, time_zone, quiet_from, quiet_until, push_to_device)
			select id, zone, '22:00', '07:00', true
			from unnest($1::text[]) with ordinality as fixture(zone, number)
			join app_user on slug = 'Example ' || number`,
			[zones],
		);
		await db.query("commit");
		if (name === "refuses a partner saving the copied UTC preference") {
			await db.query(`insert into save_receipt (idempotency_key, verb, request_hash, answer)
				values (gen_random_uuid(), 'save-preferences', 'example', '{"ok": true}')`);
		}
		if (explicitChoice) {
			await db.query(`begin;
				select set_config('engine.job', '', true), set_config('engine.user_id', id::text, true)
				from app_user where slug = 'Example 1';
				update user_preference set time_zone = 'UTC' where user_id = (select id from app_user where slug = 'Example 1');
				commit;`);
		}
		const preferences = async () =>
			(
				await db.query({
					text: `select time_zone, quiet_from::text, quiet_until::text, push_to_device, changed_by_job
						from user_preference join app_user on app_user.id = user_id order by slug`,
					rowMode: "array",
				})
			).rows;
		const changes = async () =>
			(
				await db.query({
					text: `select old_value, new_value, changed_by_job from change
						where table_name = 'user_preference' and action = 'update' order by id`,
					rowMode: "array",
				})
			).rows;
		const before = await preferences();
		if (error) {
			const previousChanges = await changes();
			await assert.rejects(db.query(repair), { message: error });
			await db.query("rollback");
			assert.deepEqual(await preferences(), before);
			assert.deepEqual(await changes(), previousChanges);
			return;
		}

		await db.query(repair);
		assert.deepEqual(await preferences(), [
			["America/Chicago", "22:00:00", "07:00:00", true, "old_system"],
			before[1],
		]);
		assert.deepEqual(await changes(), [
			[{ time_zone: "UTC" }, { time_zone: "America/Chicago" }, "old_system"],
		]);
	});
}
