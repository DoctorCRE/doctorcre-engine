import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { URL } from "node:url";
import pg from "pg";
import { asAdmin } from "../scripts/test-database.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (f: string) =>
	readFile(new URL(`../schema/${f}`, import.meta.url), "utf8");
const [schema, attribution, copy] = await Promise.all([
	read("next.sql"),
	read("copy-attribution.sql"),
	read("copy-leads-clients.sql"),
]);
const name = `copy_relationships_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (sql: string) => (await db.query(sql)).rows;
const run = async () => {
	await db.query(
		"begin; create temp table copy_how_found (old_type text, source text, how_found text, primary key (old_type, source)) on commit drop; insert into copy_how_found values ('lead','Example referral','referral'), ('client','Example client source','vendor');",
	);
	try {
		const result = await db.query(copy);
		assert.ok(Array.isArray(result));
		await db.query("commit");
		return result.at(-1)?.rows ?? [];
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
};
let report: pg.QueryResultRow[];
before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id,slug,kind,display_name) values ('${id(1)}','example_user','human','Example User');
 insert into party (id,kind,name) values ('${id(1)}','person','Example User');
 insert into app_user values ('${id(1)}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(1)}','${id(1)}');
 insert into public.contact_state (slug,label,contactable,sort) values ('active','Example active',true,1);
 insert into public.lead_stage (slug,label) select s,s from unnest(array['new','qualified','nurture_drip','closed_lost','closed_won','active_deal','do_not_contact','engaged']) s;
 insert into public.client_status (slug,label) select s,s from unnest(array['roster','active_deal','past_client','cold']) s;
 insert into public.client_type (slug,label) values ('franchise','Example franchise'),('national_account','Example account');
 insert into public.lead_lane (slug,label) values ('example_lane','Example lane');
 ${Array.from({ length: 12 }, (_, i) => {
		const n = i + 10;
		return `insert into public.party (id,kind,name,created_by,updated_by) values ('${id(n)}','${n === 11 || n === 12 ? "org" : "person"}','Example ${n}','${id(1)}','${id(1)}');
 insert into party (id,kind,name) values ('${id(n)}','${n === 11 || n === 12 ? "company" : "person"}','Example ${n}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(n)}','${id(n)}');`;
 }).join("\n")}
 insert into public.lead (id,party_id,stage,source_type,created_by,updated_by,created_at,updated_at,owner_id,source_detail,notes,next_action_date,lane,segment,est_lease_event,event_source,event_confidence,last_touch,notes_path) values
 ('${id(30)}','${id(10)}','qualified','Example referral','${id(1)}','${id(1)}','2024-01-01','2025-02-01','${id(1)}','Example lead detail','Example note','2026-12-01','example_lane','Example segment','2027-01-01','Example lease source','high','2025-01-01','example/file.md');
 insert into public.client (id,party_id,status,client_type,acquisition_source,acquisition_detail,created_by,updated_by,created_at) values
 ('${id(40)}','${id(10)}','active_deal','franchise','Example client source','Example client detail','${id(1)}','${id(1)}','2024-02-01'),
 ('${id(41)}','${id(11)}','past_client','franchise','Example client source',null,'${id(1)}','${id(1)}','2024-01-01'),
 ('${id(42)}','${id(12)}','cold','national_account','Example client source',null,'${id(1)}','${id(1)}','2024-01-01');
 update public.party set org_id = '${id(12)}' where id = '${id(11)}';
 insert into public.national_account_owner (account_client_id,owner_actor_id,set_by) values ('${id(42)}','${id(1)}','${id(1)}');
 insert into public.lead (id,party_id,stage,source_type,created_by,updated_by,suppressed) select
 '${id(50)}', '${id(13)}','do_not_contact','Example referral','${id(1)}','${id(1)}',true;
 commit;`);
	for (const [i, stage] of [
		"nurture_drip",
		"closed_lost",
		"closed_won",
		"active_deal",
		"new",
		"engaged",
	].entries()) {
		await db.query(
			`insert into public.lead (id,party_id,stage,source_type,created_by,updated_by) values ($1,$2,$3,$4,$5,$5)`,
			[
				id(51 + i),
				id(14 + i),
				stage,
				i === 4 ? "Unmapped source" : "Example referral",
				id(1),
			],
		);
	}
	await db.query(
		`insert into public.lead (id,party_id,stage,source_type,created_by,updated_by,created_at,updated_at) values ('${id(60)}','${id(10)}','new','Example referral','${id(1)}','${id(1)}','2023-01-01','2024-01-01');`,
	);
	await db.query(`update public.lead set client_id = '${id(41)}' where id = '${id(30)}';
 insert into public.lead (id,party_id,stage,source_type,created_by,updated_by,owner_label,segment,est_lease_event,event_confidence) values
 ('${id(61)}','${id(20)}','new','Example referral','${id(1)}','${id(1)}','Shared','   ','2027-01-01','unknown');`);
	report = await run();
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("roles use earliest creation and latest lead details without turning a doctor into their practice", async () => {
	assert.deepEqual(
		await rows(
			`select stage, owner_user_id, lane, segment, estimated_lease_on::text, lease_estimate_source, lease_estimate_confidence, created_at::text, changed_by_user_id from party_role where party_id = '${id(10)}' and role = 'lead'`,
		),
		[
			{
				stage: "qualified",
				owner_user_id: id(1),
				lane: "example_lane",
				segment: "Example segment",
				estimated_lease_on: "2027-01-01",
				lease_estimate_source: "Example lease source",
				lease_estimate_confidence: "high",
				created_at: "2023-01-01 00:00:00+00",
				changed_by_user_id: id(1),
			},
		],
	);
	assert.deepEqual(
		await rows(
			`select how_found,how_found_detail from party where id = '${id(10)}'`,
		),
		[{ how_found: "vendor", how_found_detail: "Example client detail" }],
	);
	assert.ok(report.some((r) => r.reason === "sources_disagree"));
	assert.ok(report.some((r) => r.reason === "several_records_on_one_party"));
	assert.equal((await rows("select count(*)::int as n from client"))[0]?.n, 3);
	assert.deepEqual(await rows("select status from client order by party_id"), [
		{ status: "roster" },
		{ status: "roster" },
		{ status: "cold" },
	]);
	assert.deepEqual(await rows("select party_id from national_account"), [
		{ party_id: id(12) },
	]);
});
test("legacy stages map exactly and missing facts are listed without invented contact or dates", async () => {
	assert.deepEqual(
		await rows(
			`select stage from party_role where role = 'lead' and party_id between '${id(13)}' and '${id(19)}' order by party_id`,
		),
		[
			"archived",
			"nurture",
			"nurture",
			"opportunity",
			"opportunity",
			"engaged",
		].map((stage) => ({ stage })),
	);
	for (const reason of [
		"source_needs_mapping",
		"restriction_needs_reason",
		"brand_start_date_required",
		"owner_start_date_required",
		"file_not_copied",
		"contact_activity_copy_required",
		"owner_label_only",
		"blank_segment",
		"estimate_needs_source",
		"invalid_or_unsourced_confidence",
	])
		assert.ok(
			report.some((r) => r.reason === reason),
			reason,
		);
	assert.deepEqual(await rows("select * from client_brand"), []);
	assert.deepEqual(await rows("select * from national_account_owner"), []);
	assert.deepEqual(await rows("select * from do_not_contact"), []);
	assert.deepEqual(
		await rows("select summary from activity order by summary"),
		[{ summary: "Example lead detail" }, { summary: "Example note" }],
	);
	assert.deepEqual(
		await rows("select what,due_on::text,owner_party_id from next_step"),
		[
			{
				what: "Imported lead follow-up",
				due_on: "2026-12-01",
				owner_party_id: id(1),
			},
		],
	);
});
test("rerunning changes no copied row, stamp, activity or follow-up", async () => {
	const snapshot = () =>
		rows(
			`select jsonb_build_object('parties',(select jsonb_agg(p order by id) from party p),'roles',(select jsonb_agg(r order by party_id,role) from party_role r),'notes',(select jsonb_agg(a order by id) from activity a),'steps',(select jsonb_agg(s order by id) from next_step s),'profiles',(select jsonb_agg(c order by party_id) from client c),'history',(select jsonb_agg(c order by id) from change c)) as snapshot`,
		);
	const original = await snapshot();
	await run();
	assert.deepEqual(await snapshot(), original);
});

test("a correction can supply a missing source without changing already copied leads", async () => {
	await db.query(
		`update public.lead set source_type = 'Example referral' where id = '${id(55)}'`,
	);
	await run();
	assert.deepEqual(
		await rows(
			`select stage,owner_user_id from party_role where party_id = '${id(18)}'`,
		),
		[{ stage: "new", owner_user_id: null }],
	);
	assert.equal(
		(
			await rows(
				`select count(*)::int as n from party_role where party_id = '${id(11)}' and role = 'lead'`,
			)
		)[0]?.n,
		0,
	);
});
