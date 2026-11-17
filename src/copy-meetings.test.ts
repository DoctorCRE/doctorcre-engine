import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (f: string) =>
	readFile(new URL(`../schema/${f}`, import.meta.url), "utf8");
const [schema, attribution, copy, activityCopy] = await Promise.all([
	read("next.sql"),
	read("copy-attribution.sql"),
	read("copy-meetings.sql"),
	read("copy-activity.sql"),
]);
const name = `copy_meetings_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const connection = {
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
};
let db: pg.Client;
const rows = async (text: string) =>
	(await db.query({ text, rowMode: "array" })).rows;
const run = async (mapping = "", script = copy): Promise<unknown[][]> => {
	await db.query("begin");
	try {
		if (mapping)
			await db.query(
				`create temp table copy_meeting_activity (meeting_id uuid primary key, activity_id uuid not null unique) on commit drop; create temp table copy_meeting_distinct (meeting_id uuid, activity_id uuid, primary key (meeting_id,activity_id)) on commit drop; ${mapping}`,
			);
		const result = await db.query(script);
		assert.ok(Array.isArray(result));
		await db.query("commit");
		return (result.at(-1)?.rows ?? []).map(Object.values);
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
};
const snapshot = () =>
	rows(
		"select jsonb_agg(a order by id) from activity a union all select jsonb_agg(i order by id) from imported_change i union all select jsonb_agg(c order by id) from change c",
	);
const baseline = [
	[id(10), "activity", id(10), "about_nothing_copied"],
	[id(11), "activity_id", id(50), "possible_duplicate"],
	[id(11), "activity_id", id(51), "possible_duplicate"],
	[id(12), "meeting", id(12), "author_not_copied"],
	[id(13), "activity", id(13), "about_nothing_copied"],
	[id(21), "changed_for_user_id", null, "agent_user_unknown"],
];
const expected = (removed: number[], ...issues: unknown[][]) =>
	[
		...baseline.filter((r) => !removed.some((n) => r[0] === id(n))),
		...issues,
	].sort(
		(a, b) =>
			String(a[0]).localeCompare(String(b[0])) ||
			String(a[1]).localeCompare(String(b[1])) ||
			String(a[2]).localeCompare(String(b[2])),
	);
const mapping = `insert into copy_meeting_activity values ('${id(11)}','${id(50)}')`;

beforeEach(async () => {
	db = new pg.Client(connection);
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into public.actor (id,slug,kind,display_name) values
 ('${id(1)}','example_user','human','Example User'), ('${id(2)}','codex','automation','Example Agent'),
 ('${id(3)}','example_uncopied','human','Example Uncopied');
 insert into party (id,kind,name) values ('${id(1)}','person','Example User');
 insert into app_user values ('${id(1)}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(1)}','${id(1)}');
 insert into public.contact_state (slug,label,contactable,sort) values ('active','Example active',true,1);
 insert into public.party (id,kind,name,created_by,updated_by) values ('${id(1)}','person','Example User','${id(1)}','${id(1)}');
 insert into public.activity_kind (slug,label,is_contact) values ('meeting','Example meeting',true), ('tour','Example tour',true);
 insert into public.activity (id,kind,occurred_at,recorded_at,updated_at,actor_id,summary,party_id) values
 ('${id(50)}','tour','2025-01-02','2025-01-02','2025-01-05','${id(1)}','Example logged visit','${id(1)}'),
 ('${id(51)}','meeting','2025-01-02','2025-01-02','2025-01-02','${id(1)}','Example second candidate','${id(1)}');
 create table ops.meeting (id uuid primary key, title text not null, started_by_actor uuid not null references public.actor,
 started_at timestamptz not null, ended_at timestamptz, ended_by_actor uuid references public.actor);
 create table ops.meeting_note (id uuid primary key, meeting_id uuid not null references ops.meeting,
 note_number integer not null check (note_number >= 1), revision integer not null check (revision >= 1),
 body text not null, author_actor uuid not null references public.actor, created_at timestamptz not null,
 unique (meeting_id,note_number,revision));
 insert into ops.meeting values
 ('${id(10)}','Example discussion','${id(1)}','2025-01-01',null,null),
 ('${id(11)}','Example visit','${id(1)}','2025-01-02','2025-01-03','${id(1)}'),
 ('${id(12)}','Example unknown author','${id(3)}','2025-01-03',null,null),
 ('${id(13)}','Example no notes','${id(1)}','2025-01-04',null,null);
 insert into ops.meeting_note values
 ('${id(20)}','${id(10)}',1,1,'Example original','${id(1)}','2025-01-01 01:00Z'),
 ('${id(21)}','${id(10)}',2,1,'Example second note','${id(2)}','2025-01-01 02:00Z'),
 ('${id(22)}','${id(10)}',1,2,'Example corrected','${id(1)}','2025-01-01 03:00Z'),
 ('${id(23)}','${id(11)}',1,1,'Example visit note','${id(1)}','2025-01-02 01:00Z');
 commit;`);
	await run("", activityCopy);
});
afterEach(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("current summaries keep note order; imported edits keep source ids, authors, times and replaced text", async () => {
	const report = await run();
	assert.deepEqual(report, baseline);
	assert.deepEqual(
		await rows(
			`select id,kind,summary,happened_at::text,changed_at::text,changed_by_user_id,from_party_id from activity where id in ('${id(10)}','${id(13)}') order by id`,
		),
		[
			[
				id(10),
				"meeting",
				"Example discussion\n\nNote 1\nExample corrected\n\nNote 2\nExample second note",
				"2025-01-01 00:00:00+00",
				"2025-01-01 03:00:00+00",
				id(1),
				null,
			],
			[
				id(13),
				"meeting",
				"Example no notes",
				"2025-01-04 00:00:00+00",
				"2025-01-04 00:00:00+00",
				id(1),
				null,
			],
		],
	);
	const history = await rows(
		`select id,source_event->'old_value'->>'summary',source_event->'new_value'->>'summary',source_event->>'source_table',source_event->>'revision',changed_by_user_id,changed_by_job,changed_at::text from imported_change where record = '{"id":"${id(10)}"}' order by changed_at`,
	);
	// biome-ignore format: one row per historical edit
	assert.deepEqual(history, [
 [id(10), null, "Example discussion", "ops.meeting", null, id(1), null, "2025-01-01 00:00:00+00"],
 [id(20), "Example discussion", "Example discussion\n\nNote 1\nExample original", "ops.meeting_note", "1", id(1), null, "2025-01-01 01:00:00+00"],
 [id(21), "Example discussion\n\nNote 1\nExample original", "Example discussion\n\nNote 1\nExample original\n\nNote 2\nExample second note", "ops.meeting_note", "1", null, "agent", "2025-01-01 02:00:00+00"],
 [id(22), "Example discussion\n\nNote 1\nExample original\n\nNote 2\nExample second note", "Example discussion\n\nNote 1\nExample corrected\n\nNote 2\nExample second note", "ops.meeting_note", "2", id(1), null, "2025-01-01 03:00:00+00"],
 ]);
	const before = await snapshot();
	await db.query("set time zone 'America/Chicago'");
	assert.deepEqual(await run(), report);
	await db.query("set time zone 'UTC'");
	assert.deepEqual(await snapshot(), before);
});

test("a reviewed tour mapping reuses the copied activity and links, and survives a later activity rerun", async () => {
	await run();
	const stamp = await rows(
		`select changed_at, changed_by_user_id, changed_by_job, changed_for_user_id from activity where id = '${id(50)}'`,
	);
	const links = await rows(
		`select * from activity_about where activity_id = '${id(50)}'`,
	);
	await run(mapping);
	assert.deepEqual(
		await rows(
			`select id,summary from activity where id in ('${id(11)}','${id(50)}')`,
		),
		[
			[
				id(50),
				"Example visit\n\nExample logged visit\n\nNote 1\nExample visit note",
			],
		],
	);
	assert.deepEqual(
		await rows(`select * from activity_about where activity_id = '${id(50)}'`),
		links,
	);
	assert.deepEqual(
		await rows(
			`select changed_at, changed_by_user_id, changed_by_job, changed_for_user_id from activity where id = '${id(50)}'`,
		),
		stamp,
	);
	const before = await snapshot();
	await run("", activityCopy);
	await run();
	assert.deepEqual(await snapshot(), before);
});

test("invalid mappings and changed source history are listed without rewriting copied records", async () => {
	await run();
	const before = await snapshot();
	const report = await run(
		`insert into copy_meeting_activity values ('${id(12)}','${id(999)}')`,
	);
	assert.deepEqual(
		report,
		expected([12], [id(12), "meeting", id(12), "mapping_not_a_logged_meeting"]),
	);
	await db.query(
		`update ops.meeting_note set body = 'Example changed source' where id = '${id(20)}'`,
	);
	assert.deepEqual(
		await run(),
		expected(
			[10, 21],
			[id(10), "meeting", id(10), "existing_history_conflicts"],
		),
	);
	assert.deepEqual(await snapshot(), before);
	await db.query(
		`update ops.meeting_note set body = 'Example original' where id = '${id(20)}'`,
	);
	await db.query(
		`insert into ops.meeting_note values ('${id(24)}','${id(10)}',3,1,'Example later note','${id(1)}','2025-01-01 04:00Z')`,
	);
	assert.deepEqual(
		await run(),
		expected(
			[10, 21],
			[id(10), "meeting", id(10), "meeting_changed_since_copy"],
		),
	);
	assert.deepEqual(await snapshot(), before);
});

test("database constraints and engine grants still protect imported meeting history", async () => {
	await run();
	for (const statement of [
		`update imported_change set table_name = 'not_a_record' where id = '${id(10)}'`,
		`update imported_change set source_event = '{}' where id = '${id(10)}'`,
		`update imported_change set changed_by_job = 'agent' where id = '${id(10)}'`,
		`set local role engine; delete from imported_change where id = '${id(10)}'`,
	]) {
		await db.query("begin");
		await assert.rejects(db.query(statement));
		await db.query("rollback");
	}
	assert.deepEqual(
		await rows(
			"select tgname from pg_trigger where tgrelid in ('next.activity'::regclass,'next.imported_change'::regclass) and tgenabled <> 'O'",
		),
		[],
	);
});

test("uncopied mapping targets, reused targets and reversed revisions wait; later user edits survive", async () => {
	await run(mapping);
	await db.query(
		`insert into ops.meeting values ('${id(14)}','Example other meeting','${id(1)}','2025-02-01',null,null)`,
	);
	assert.deepEqual(
		await run(
			`insert into copy_meeting_activity values ('${id(14)}','${id(50)}')`,
		),
		expected([11], [id(14), "meeting", id(14), "activity_already_has_meeting"]),
	);
	await db.query(
		`insert into public.activity (id,kind,occurred_at,actor_id,summary) values ('${id(52)}','meeting','2025-02-02','${id(1)}','Example unlinked')`,
	);
	assert.deepEqual(
		await run(
			`insert into copy_meeting_activity values ('${id(12)}','${id(52)}')`,
		),
		expected(
			[11, 12],
			[id(12), "meeting", id(12), "mapped_activity_not_copied"],
			[id(14), "activity", id(14), "about_nothing_copied"],
		),
	);
	await db.query(
		`update ops.meeting_note set created_at = '2025-01-01 00:30Z' where id = '${id(22)}'`,
	);
	assert.deepEqual(
		await run(),
		expected(
			[10, 11, 21],
			[id(10), "meeting", id(10), "note_history_out_of_order"],
			[id(14), "activity", id(14), "about_nothing_copied"],
		),
	);
	await db.query(`update ops.meeting_note set created_at = '2025-01-01 03:00Z' where id = '${id(22)}';
 begin; select set_config('engine.user_id','${id(1)}',true); update activity set summary = 'Example user correction' where id = '${id(10)}'; commit`);
	const before = await snapshot();
	await run();
	assert.deepEqual(await snapshot(), before);
});

test("same Chicago day lists every candidate despite different titles and times; reviewed distinct pairs unblock copying", async () => {
	await db.query(`update ops.meeting set started_at = '2025-02-01' where id = '${id(12)}';
 update public.activity set occurred_at = '2025-01-02 00:03Z' where id = '${id(50)}';
 update public.activity set occurred_at = '2025-01-02 05:59Z' where id = '${id(51)}';
 insert into public.activity (id,kind,occurred_at,actor_id,summary) values ('${id(52)}','meeting','2025-01-02 06:01Z','${id(1)}','Example next Chicago day')`);
	assert.deepEqual(await run(), baseline);
	const distinct = `insert into copy_meeting_distinct values ('${id(11)}','${id(50)}')`;
	assert.deepEqual(
		await run(distinct),
		baseline.filter((r) => r[2] !== id(50)),
	);
	const report = await run(
		`${distinct}; insert into copy_meeting_distinct values ('${id(11)}','${id(51)}')`,
	);
	assert.deepEqual(report, [
		baseline[0],
		[id(11), "activity", id(11), "about_nothing_copied"],
		...baseline.slice(3),
	]);
	assert.deepEqual(
		await rows(
			`select id from activity where id in ('${id(11)}','${id(50)}','${id(51)}') order by id`,
		),
		[[id(11)], [id(50)], [id(51)]],
	);
	const before = await snapshot();
	assert.deepEqual(await run(), report);
	assert.deepEqual(await snapshot(), before);
});
