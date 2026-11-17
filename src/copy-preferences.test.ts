import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number) => `next_action:${id(n)}`;
const read = (f: string) =>
	readFile(new URL(`../schema/${f}`, import.meta.url), "utf8");
const [schema, attribution, leads, copy] = await Promise.all([
	read("next.sql"),
	read("copy-attribution.sql"),
	read("copy-leads-clients.sql"),
	read("copy-preferences.sql"),
]);
const name = `copy_preferences_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (sql: string) =>
	(await db.query({ text: sql, rowMode: "array" })).rows;
const run = async (sql = copy, setup = "", keepOpen = false) => {
	await db.query(
		"begin; select set_config('engine.job','old_system',true); create temp table if not exists copy_how_found (old_type text, source text, how_found text, primary key (old_type, source)) on commit drop; insert into copy_how_found values ('lead','Example referral','referral') on conflict do nothing",
	);
	try {
		if (setup) await db.query(setup);
		const result = await db.query(sql);
		assert.ok(Array.isArray(result));
		if (!keepOpen) await db.query("commit");
		return (result.at(-1)?.rows ?? []).map(Object.values);
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
};
const users = [1, 3, 4];
const actions = [100, 101, 102, 103, 104, 105, 106, 107, 108];
const marks = () =>
	rows(
		"select next_step_id, disposition, snoozed_until::text, waiting_on_party_id, waiting_reason, created_at::text, changed_at::text, changed_by_user_id, changed_by_job from home_mark order by next_step_id",
	);
const preferences = () =>
	rows(
		"select user_id, time_zone, quiet_from::text, quiet_until::text, push_to_device, changed_by_user_id, changed_by_job, changed_at = created_at from user_preference order by user_id",
	);
let report: unknown[][];
before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id,slug,kind,display_name) values ${[1, 2, 3, 4].map((n) => `('${id(n)}','example_${n}','human','Example User ${n}')`).join(",")};
 ${users
		.map(
			(
				n,
			) => `insert into party (id,kind,name) values ('${id(n)}','person','Example User ${n}');
 insert into app_user values ('${id(n)}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(n)}','${id(n)}');`,
		)
		.join("\n")}
 insert into public.contact_state (slug,label,contactable,sort) values ('active','Example active',true,1);
 insert into public.party (id,kind,name,created_by,updated_by) values
 ('${id(10)}','person','Example Lead','${id(1)}','${id(1)}'),
 ('${id(11)}','person','Example Landlord','${id(1)}','${id(1)}'),
 ('${id(12)}','person','Example Uncopied','${id(1)}','${id(1)}');
 insert into party (id,kind,name) values ('${id(10)}','person','Example Lead'), ('${id(11)}','person','Example Landlord');
 insert into outside_id (source,value,party_id) values ('old_system','${id(10)}','${id(10)}'), ('old_system','${id(11)}','${id(11)}');
 insert into public.lead_stage (slug,label) values ('new','new');
 insert into public.lead (id,party_id,stage,source_type,created_by,updated_by) values ('${id(30)}','${id(10)}','new','Example referral','${id(1)}','${id(1)}');
 insert into public.next_action (id,subject_type,subject_id,owner_id,description,status,created_by) values
 ${actions.map((n) => `('${id(n)}','lead','${id(30)}','${id(1)}','Example step ${n}','${n === 100 ? "open" : n === 105 ? "dropped" : "done"}','${id(1)}')`).join(",")};
 insert into ops.notification_preference (actor,device_opt_in,quiet_hours_start,quiet_hours_end,timezone,version) values
 ('${id(1)}',true,'22:00','06:00','America/Chicago',3),
 ('${id(2)}',false,null,null,'UTC',1),
 ('${id(3)}',false,null,null,'Example/Nowhere',1),
 ('${id(4)}',true,'08:00','08:00','UTC',2);
 insert into ops.home_inbox_disposition (actor_id,item_id,disposition,snoozed_until,source_version,material_version,updated_at) values
 ('${id(1)}','${item(100)}','snoozed','2026-12-01','1','m','2026-10-01'),
 ('${id(1)}','${item(101)}','settled',null,'1','m','2026-10-02'),
 ('${id(1)}','${item(102)}','inbox',null,'1','m','2026-10-03'),
 ('${id(1)}','${item(103)}','inbox',null,'1','m','2026-10-03'),
 ('${id(1)}','${item(104)}','settled',null,'1','m','2026-10-04'),
 ('${id(1)}','${item(105)}','settled',null,'1','m','2026-10-04'),
 ('${id(1)}','${item(108)}','settled',null,'1','m','2026-10-04'),
 ('${id(1)}','capture_session:${id(200)}','settled',null,'1','m','2026-10-04'),
 ('${id(2)}','${item(101)}','settled',null,'1','m','2026-10-04');
 insert into ops.home_waiting (actor_id,item_id,identity_kind,identity_id,reason,evidence,version,updated_at) values
 ('${id(1)}','${item(100)}','party','${id(11)}','Example landlord reply','["Example evidence"]',1,'2026-10-05'),
 ('${id(1)}','${item(102)}','actor','${id(3)}','Example partner review','["Example evidence"]',1,'2026-10-06'),
 ('${id(1)}','${item(104)}',null,null,'Example cleared','["Example evidence"]',2,'2026-10-07'),
 ('${id(1)}','${item(106)}','party','${id(12)}','Example uncopied wait','["Example evidence"]',1,'2026-10-06'),
 ('${id(1)}','${item(107)}','party','${id(11)}','  ','["Example evidence"]',1,'2026-10-06');
 insert into next_step (id,party_id,what) values ('${id(108)}','${id(11)}','Example other record');
 commit;`);
	await run(leads);
	report = await run();
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("each user's settings become their preferences, and unknown zones and equal quiet hours wait for that user", async () => {
	assert.deepEqual(await preferences(), [
		[id(1), "America/Chicago", "22:00:00", "06:00:00", true, id(1), null, true],
	]);
	assert.deepEqual(
		report.filter(([, , , reason]) =>
			[
				"actor_not_a_user",
				"unknown_time_zone",
				"quiet_hours_start_equals_end",
			].includes(reason as string),
		),
		[
			[id(2), "actor", id(2), "actor_not_a_user"],
			[id(2), "actor_id", id(2), "actor_not_a_user"],
			[id(3), "timezone", "Example/Nowhere", "unknown_time_zone"],
			[id(4), "quiet_hours_start", "08:00:00", "quiet_hours_start_equals_end"],
		],
	);
});

test("snoozed, settled and waiting marks land on the next steps the earlier copies made", async () => {
	assert.deepEqual(await marks(), [
		[
			id(100),
			"snoozed",
			"2026-12-01 00:00:00+00",
			id(11),
			"Example landlord reply",
			"2026-10-01 00:00:00+00",
			"2026-10-05 00:00:00+00",
			id(1),
			null,
		],
		[
			id(101),
			"settled",
			null,
			null,
			null,
			"2026-10-02 00:00:00+00",
			"2026-10-02 00:00:00+00",
			id(1),
			null,
		],
		[
			id(102),
			null,
			null,
			id(3),
			"Example partner review",
			"2026-10-06 00:00:00+00",
			"2026-10-06 00:00:00+00",
			id(1),
			null,
		],
		[
			id(104),
			"settled",
			null,
			null,
			null,
			"2026-10-04 00:00:00+00",
			"2026-10-04 00:00:00+00",
			id(1),
			null,
		],
	]);
	assert.deepEqual(
		report.filter(([old]) => old === id(1)),
		[
			[id(1), "identity_id", id(12), "waiting_on_not_copied"],
			[id(1), "item_id", `capture_session:${id(200)}`, "waits_for_its_record"],
			[id(1), "item_id", item(105), "next_step_not_copied"],
			[id(1), "item_id", item(108), "next_step_not_copied"],
			[id(1), "reason", "  ", "waiting_needs_reason"],
		],
	);
});

test("a rerun changes nothing, and picks up a mark once its next step is copied", async () => {
	const history =
		"select count(*) from change where table_name in ('user_preference', 'home_mark')";
	const before = [await preferences(), await marks(), await rows(history)];
	assert.deepEqual(await run(), report);
	assert.deepEqual(
		[await preferences(), await marks(), await rows(history)],
		before,
	);
	try {
		assert.deepEqual(
			await run(
				copy,
				`insert into next_step (id,party_id,what) values ('${id(105)}','${id(10)}','Example later step')`,
				true,
			),
			report.filter(([, , value]) => value !== item(105)),
		);
		assert.deepEqual(
			(await marks()).map(([step, disposition]) => [step, disposition]).at(-1),
			[id(105), "settled"],
		);
	} finally {
		await db.query("rollback");
	}
});
