import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sql = (file: string) =>
	readFile(new URL(`../schema/${file}`, import.meta.url), "utf8");
const schema = await sql("next.sql");
const attribution = await sql("copy-attribution.sql");
const copy = await sql("copy-deal-next-steps.sql");
const name = `copy_steps_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (text: string) => (await db.query(text)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	const result = await db.query(copy);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const reasons = (report: pg.QueryResultRow[], n: number) =>
	report.filter((r) => r.old_id === id(n)).map((r) => r.reason);
let report: pg.QueryResultRow[];
const copyOnce = async () => {
	await db.query("begin");
	try {
		const result = await run();
		await db.query("commit");
		return result;
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
};
before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User');
 insert into app_user (id) values ('${id(1)}');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(1)}', '${id(1)}');
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User'),
 ('${id(2)}', 'claude', 'automation', 'Example Agent');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) values ('${id(6)}', 'org', 'Example Client', '${id(1)}', '${id(1)}');
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(3)}', '${id(6)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('closed', 'Example closed');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, next_date, created_by, updated_by)
 select v, '${id(3)}', 'Example deal', 'lease', 'closed', 'partner_one', '2026-03-01', '${id(1)}', '${id(1)}'
 from unnest(array[${Array.from({ length: 8 }, (_, i) => `'${id(10 + i)}'::uuid`).join(",")}]) v;
 insert into deal (id, name, owner_user_id) select id, name, '${id(1)}' from public.deal where id <> '${id(17)}';
 insert into outside_id (source, value, deal_id) select 'old_system', id::text, id from deal;
 insert into public.next_action (id, subject_type, subject_id, owner_id, description, status, due_on, created_at, updated_at, created_by) values
 ${[
		[100, 10, 1, "Example open", "open", "'2026-02-01'"],
		[101, 10, 1, "Example done", "done", "null"],
		[102, 10, 2, "Example dropped", "dropped", "null"],
		[103, 10, 1, "Example expired", "expired", "null"],
		[104, 15, 1, "  ", "open", "null"],
		[105, 17, 1, "Example missing deal", "open", "null"],
		[106, 10, 2, "Example unknown owner", "open", "null"],
 ]
		.map(
			([n, d, o, text, status, due]) =>
				`('${id(Number(n))}', 'deal', '${id(Number(d))}', '${id(Number(o))}', '${text}', '${status}', ${due}, '2025-01-01', '2025-02-01', '${id(1)}')`,
		)
		.join(",")};
 update public.next_action set hold_until='2026-04-01', source_ref='example:source', item_title='Example display', item_bullets='["Example bullet"]' where id='${id(100)}';
 insert into public.deal_note (id, deal_id, kind, text, actor_id, created_at) values
 ('${id(200)}','${id(11)}','next_step','Example old note','${id(1)}','2025-01-01'),
 ('${id(201)}','${id(11)}','next_step','Example current note','${id(2)}','2025-02-01'),
 ('${id(202)}','${id(12)}','next_step','Example superseded','${id(1)}','2025-01-01'),
 ('${id(203)}','${id(10)}','next_step','Example hidden note','${id(1)}','2025-01-01'),
 ('${id(204)}','${id(14)}','next_step','Example undated note','${id(1)}','2025-01-01'),
 ('${id(205)}','${id(11)}','note','Example ordinary note','${id(1)}','2025-01-01');
 update public.deal set next_date=null where id='${id(14)}';
 insert into public.event (subject_type, subject_id, field, new_value, occurred_at, recorded_at, actor_id, verb, cause, sponsoring_human_slug) values
 ('deal','${id(12)}','next_step','{"superseded_action_ids":[]}', '2025-02-01','2025-02-01','${id(1)}','replace-step','human_stated',null),
 ('deal','${id(11)}','note','{"note":"Example current note"}', '2025-02-01','2025-02-01','${id(2)}','add-deal-note','automation_job','partner_one');
 insert into public.activity_kind (slug, label, is_contact) values ('task','Example task',false);
 insert into public.activity (id, kind, occurred_at, recorded_at, actor_id, summary, detail, deal_id, party_id) values
 ('${id(300)}','task','2025-01-01','2025-02-01','${id(2)}','Example task','Example details','${id(10)}',null),
 ('${id(301)}','task','2025-01-01','2025-02-01','${id(1)}','Example ambiguous',null,'${id(10)}',null),
 ('${id(302)}','task','2025-01-01','2025-02-01','${id(1)}','Example unlinked',null,null,null),
 ('${id(303)}','task','2025-01-01','2025-02-01','${id(1)}','Example structured','{"example":true}','${id(10)}',null),
 ('${id(304)}','task','2025-01-01','2025-02-01','${id(1)}','Example party task',null,null,'${id(6)}');
 update public.activity set client_id='${id(3)}' where id='${id(301)}';
 insert into party (id,kind,name) values ('${id(7)}','company','Example surviving company');
 insert into outside_id (source,value,party_id) values ('old_system','${id(6)}','${id(7)}');
 insert into public.event (subject_type, subject_id, new_value, actor_id, verb, cause, sponsoring_human_slug, occurred_at)
 values ('deal','${id(10)}','{"activity":"${id(300)}"}','${id(2)}','log-activity','automation_job','partner_one','2025-01-01');
 commit;`);
	await db.query(`begin; ${await sql("copy-activity.sql")}; commit`);
	report = await copyOnce();
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("actions keep their own due dates and done time, never the deal date", async () => {
	// biome-ignore format: one row per source action
	assert.deepEqual((await rows(`select id, due_on::text, done_at::text, owner_party_id, created_at::text from next_step where id in ('${id(100)}','${id(101)}','${id(106)}') order by id`)).map(Object.values), [
 [id(100), "2026-02-01", null, id(1), "2025-01-01 00:00:00+00"],
 [id(101), null, "2025-02-01 00:00:00+00", id(1), "2025-01-01 00:00:00+00"],
 [id(106), null, null, null, "2025-01-01 00:00:00+00"],
 ]);
	assert.deepEqual(
		await rows(
			"select n.id from next_step n join public.next_action a using (id) where n.changed_at <> a.updated_at",
		),
		[],
	);
});
test("the board fallback keeps only the newest unsuperseded note and its date", async () => {
	assert.deepEqual(
		(
			await rows(
				`select id,what,due_on::text,done_at,changed_by_job,changed_for_user_id from next_step where id between '${id(200)}' and '${id(205)}' order by id`,
			)
		).map(Object.values),
		[
			[id(201), "Example current note", "2026-03-01", null, "agent", id(1)],
			[id(204), "Example undated note", null, null, null, null],
		],
	);
	assert.equal(
		(
			await rows(
				"select count(*) from next_step where what='Imported deal follow-up'",
			)
		)[0]?.count,
		"2",
	);
	assert.deepEqual(reasons(report, 200), ["older_next_step_note"]);
	assert.deepEqual(reasons(report, 202), ["superseded_note"]);
	assert.deepEqual(reasons(report, 203), ["note_hidden_by_action"]);
});
test("tasks become undated next steps with one mapped record, preserving detail and sponsorship", async () => {
	assert.deepEqual(
		(
			await rows(
				`select id,what,deal_id,party_id,due_on,done_at,owner_party_id,changed_by_job,changed_for_user_id from next_step where id >= '${id(300)}' and what like 'Example%' order by id`,
			)
		).map(Object.values),
		[
			[
				id(300),
				"Example task\n\nExample details",
				id(10),
				null,
				null,
				null,
				null,
				"agent",
				id(1),
			],
			[
				id(303),
				"Example structured",
				id(10),
				null,
				null,
				null,
				null,
				null,
				null,
			],
			[
				id(304),
				"Example party task",
				null,
				id(7),
				null,
				null,
				null,
				null,
				null,
			],
		],
	);
	assert.deepEqual(reasons(report, 301), ["task_needs_one_record"]);
	assert.deepEqual(reasons(report, 302), ["task_needs_one_record"]);
	assert.deepEqual(reasons(report, 303), ["structured_detail_not_copied"]);
});
test("unmappable values are listed and refused rows never appear", async () => {
	assert.deepEqual(reasons(report, 100), [
		"hold_has_no_place",
		"display_bullets_not_copied",
		"display_title_not_copied",
		"reference_not_copied",
	]);
	for (const n of [102, 103])
		assert.deepEqual(
			reasons(report, n),
			n === 102
				? ["owner_not_a_user", "closed_without_doing"]
				: ["closed_without_doing"],
		);
	assert.deepEqual(reasons(report, 104), ["blank_next_step"]);
	assert.deepEqual(reasons(report, 105), ["deal_not_copied"]);
	assert.deepEqual(reasons(report, 106), ["owner_not_a_user"]);
	assert.deepEqual(reasons(report, 10), ["date_without_fallback"]);
	assert.deepEqual(
		await rows(
			`select id from next_step where id in ('${id(102)}','${id(103)}','${id(104)}','${id(105)}','${id(202)}','${id(203)}','${id(205)}')`,
		),
		[],
	);
});
test("the activity copy never also copies next-step notes or tasks", async () => {
	assert.deepEqual(
		(await rows("select id from activity order by id")).map((r) => r.id),
		[id(205)],
	);
});

test("reruns preserve every row and history entry, and retry a deal copied later", async () => {
	const snapshot = async () => [
		await rows("select * from next_step order by id"),
		await rows("select * from change order by id"),
	];
	const before = await snapshot();
	assert.deepEqual(await copyOnce(), report);
	assert.deepEqual(await snapshot(), before);
	await db.query(
		`begin; select set_config('engine.job','old_system',true); insert into deal (id,name,owner_user_id) values ('${id(17)}','Example late deal','${id(1)}'); commit`,
	);
	await copyOnce();
	assert.equal(
		(await rows(`select what from next_step where id='${id(105)}'`))[0]?.what,
		"Example missing deal",
	);
});
test("an id on another record is listed without changing its row", async () => {
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into next_step (id,deal_id,what) values ('${id(999)}','${id(11)}','Example existing');
 insert into public.next_action (id,subject_type,subject_id,owner_id,description,status,created_by) values ('${id(999)}','deal','${id(10)}','${id(1)}','Example conflict','done','${id(1)}');`);
	try {
		assert.deepEqual(reasons(await run(), 999), ["id_taken"]);
		assert.equal(
			(await rows(`select what from next_step where id='${id(999)}'`))[0]?.what,
			"Example existing",
		);
	} finally {
		await db.query("rollback");
	}
});

test("the record constraint and stamp still apply after copying", async () => {
	await db.query("begin; select set_config('engine.job','old_system',true)");
	await assert.rejects(
		db.query("insert into next_step (what) values ('Example invalid')"),
		{ constraint: "next_step_one_record" },
	);
	await db.query("rollback");
	await db.query(
		`begin; select set_config('engine.job','agent',true); update next_step set what='Example edited' where id='${id(100)}'`,
	);
	assert.equal(
		(
			await rows(`select changed_by_job from next_step where id='${id(100)}'`)
		)[0]?.changed_by_job,
		"agent",
	);
	await db.query("rollback");
});
