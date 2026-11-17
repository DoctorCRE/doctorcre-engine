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
const run = async (
	setup = "",
	keepOpen = false,
): Promise<pg.QueryResultRow[]> => {
	await db.query(
		"begin; select set_config('engine.job','old_system',true); create temp table copy_how_found (old_type text, source text, how_found text, primary key (old_type, source)) on commit drop; insert into copy_how_found values ('lead','Example referral','referral'), ('client','Example client source','vendor'), ('candidate_pool','Example pool','public_records');",
	);
	try {
		if (setup) await db.query(`${setup}; set constraints all immediate`);
		const result = await db.query(copy);
		assert.ok(Array.isArray(result));
		if (!keepOpen) await db.query("commit");
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
 insert into public.lead_stage (slug,label) select s,s from unnest(array['new','qualified','nurture_drip','closed_lost','closed_won','active_deal','do_not_contact','engaged','other']) s;
 insert into public.client_status (slug,label) select s,s from unnest(array['roster','active_deal','past_client','cold','prospect']) s;
 insert into public.client_type (slug,label) values ('franchise','Example franchise'),('national_account','Example account'), ('group','Example group'), ('other','Example unknown');
 insert into public.lead_lane (slug,label) values ('example_lane','Example lane');
 ${Array.from({ length: 16 }, (_, i) => {
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
	await db.query(`insert into public.client (id,party_id,status,client_type,acquisition_source,created_by,updated_by) values
 ('${id(43)}','${id(21)}','roster','group','Example client source','${id(1)}','${id(1)}'),
 ('${id(44)}','${id(22)}','prospect','franchise','Example client source','${id(1)}','${id(1)}'),
 ('${id(45)}','${id(23)}','roster','other','Example client source','${id(1)}','${id(1)}');
 insert into public.lead (id,party_id,stage,source_type,source_detail,notes,next_action_date,created_by,updated_by) values
 ('${id(62)}','${id(24)}','other','Example referral',null,'Refused note','2027-01-01','${id(1)}','${id(1)}'),
 ('${id(63)}','${id(25)}','new','prospect-pool','  Pool detail  ',null,null,'${id(1)}','${id(1)}'),
 ('${id(64)}','${id(12)}','new','Example referral','Unrelated source detail',null,null,'${id(1)}','${id(1)}');
 insert into public.candidate_pool (id,source,source_key,source_row,name,status,promoted_lead_id,score_basis,est_lease_event,est_basis,created_by,updated_by) values
 ('${id(70)}','Example pool','example-key','{}','Example candidate','promoted','${id(63)}','Example qualification','2027-02-01','Example basis','${id(1)}','${id(1)}');
 update public.lead set est_lease_event = '2027-02-01' where id = '${id(63)}';`);
	await db.query(`begin; select set_config('engine.job','old_system',true); alter table party disable trigger stamp_change;
 update party set changed_at = '2030-01-01' where id = '${id(10)}'; alter table party enable trigger stamp_change; commit;`);
	report = await run();
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("roles, profiles, details and estimates follow the old records without inventing missing facts", async () => {
	assert.deepEqual(
		await rows(
			`select * from party_role where party_id = '${id(11)}' and role = 'lead'`,
		),
		[],
	);
	const expected: [string, unknown[][]][] = [
		[
			`select stage,owner_user_id,lane,segment,estimated_lease_on::text,lease_estimate_source,lease_estimate_confidence,created_at::text,changed_by_user_id from party_role where party_id = '${id(10)}' and role = 'lead'`,
			[
				[
					"qualified",
					id(1),
					"example_lane",
					"Example segment",
					"2027-01-01",
					"Example lease source",
					"high",
					"2023-01-01 00:00:00+00",
					id(1),
				],
			],
		],
		[
			`select how_found,how_found_detail,changed_at::text from party where id = '${id(10)}'`,
			[["vendor", "Example client detail", "2030-01-01 00:00:00+00"]],
		],
		[
			"select status from client order by party_id",
			[["roster"], ["roster"], ["cold"], ["roster"]],
		],
		["select party_id from national_account", [[id(12)]]],
		[
			`select stage from party_role where role = 'lead' and party_id between '${id(13)}' and '${id(19)}' order by party_id`,
			[
				["archived"],
				["nurture"],
				["nurture"],
				["opportunity"],
				["opportunity"],
				["engaged"],
			],
		],
		[
			"select summary from activity order by summary",
			[["Example lead detail"], ["Example note"], ["Unrelated source detail"]],
		],
		[
			"select what,due_on::text,owner_party_id from next_step",
			[["Imported lead follow-up", "2026-12-01", id(1)]],
		],
		[`select how_found_detail from party where id = '${id(12)}'`, [[null]]],
		[
			`select client_type from client where party_id = '${id(21)}'`,
			[["group_practice"]],
		],
		[
			`select how_found,how_found_detail from party where id = '${id(25)}'`,
			[["public_records", "Pool detail"]],
		],
		[
			`select lease_estimate_source from party_role where party_id = '${id(25)}'`,
			[["Example basis"]],
		],
	];
	for (const [sql, result] of expected)
		assert.deepEqual((await rows(sql)).map(Object.values), result, sql);
	for (const table of [
		"client_brand",
		"national_account_owner",
		"do_not_contact",
	])
		assert.deepEqual(await rows(`select * from ${table}`), []);
	for (const table of ["party_role", "activity_about", "next_step"])
		assert.deepEqual(
			await rows(
				`select * from ${table} where party_id between '${id(22)}' and '${id(24)}'`,
			),
			[],
		);
	assert.deepEqual(
		await rows(
			`select tgname from pg_trigger where tgrelid in (select oid from pg_class where relnamespace = 'next'::regnamespace) and tgname in ('stamp_change','lead_stage_needs_evidence') and tgenabled <> 'O'`,
		),
		[],
	);
});
test("unresolved facts remain listed on every rerun and copied rows and stamps stay unchanged", async () => {
	for (const reason of [
		"sources_disagree",
		"several_records_on_one_party",
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
		"unknown_stage",
		"unknown_client_status",
		"unknown_client_type",
		"existing_source_differs",
	])
		assert.ok(
			report.some((r) => r.reason === reason),
			reason,
		);
	const snapshot = () =>
		rows(
			`select jsonb_build_object('parties',(select jsonb_agg(p order by id) from party p),'roles',(select jsonb_agg(r order by party_id,role) from party_role r),'notes',(select jsonb_agg(a order by id) from activity a),'steps',(select jsonb_agg(s order by id) from next_step s),'profiles',(select jsonb_agg(c order by party_id) from client c),'history',(select jsonb_agg(c order by id) from change c)) as snapshot`,
		);
	const original = await snapshot();
	assert.deepEqual(await run(), report);
	assert.deepEqual(await snapshot(), original);
});
test("a correction can supply a missing source without changing already copied leads", async () => {
	await run(
		`update public.lead set source_type = 'Example referral' where id = '${id(55)}'`,
		true,
	);
	try {
		assert.deepEqual(
			await rows(
				`select stage,owner_user_id from party_role where party_id = '${id(18)}'`,
			),
			[{ stage: "new", owner_user_id: null }],
		);
	} finally {
		await db.query("rollback");
	}
});

const extraParties = [80, 81, 82]
	.map(
		(
			n,
		) => `insert into public.party (id,kind,name,created_by,updated_by) values ('${id(n)}','person','Example waiting party','${id(1)}','${id(1)}');
 insert into party (id,kind,name) values ('${id(n)}','person','Example waiting party');
 insert into outside_id (source,value,party_id) values ('old_system','${id(n)}','${id(n)}');`,
	)
	.join("\n");

test("an unmapped client source waits, and mapping it later matches mapping it at once", async () => {
	const setup = `${extraParties}
 insert into public.lead (id,party_id,stage,source_type,source_detail,created_by,updated_by) values ('${id(83)}','${id(80)}','new','Example referral','Lead waiting detail','${id(1)}','${id(1)}');
 insert into public.client (id,party_id,status,client_type,acquisition_source,acquisition_detail,created_by,updated_by) values ('${id(84)}','${id(80)}','roster','franchise','Unmapped client source','Client waiting detail','${id(1)}','${id(1)}');`;
	const mapping =
		"insert into copy_how_found values ('client','Unmapped client source','vendor');";
	const answer = () =>
		rows(
			`select how_found,how_found_detail,(select count(*)::int from party_role where party_id = p.id) as roles from party p where id = '${id(80)}'`,
		);
	let staged: pg.QueryResultRow[];
	try {
		const waiting = await run(setup, true);
		assert.deepEqual(await answer(), [
			{ how_found: null, how_found_detail: null, roles: 0 },
		]);
		assert.ok(
			waiting.some(
				(r) => r.old_id === id(84) && r.reason === "source_needs_mapping",
			),
		);
		assert.ok(
			waiting.some(
				(r) =>
					r.value === "Client waiting detail" &&
					r.reason === "detail_needs_source_mapping",
			),
		);
		assert.ok(
			!waiting.some(
				(r) =>
					[id(83), id(84)].includes(r.old_id) &&
					r.reason === "sources_disagree",
			),
		);
		await db.query(
			`drop table not_copied,old_relationship,relationship_source,mapped_source,waiting_client_source,examined_relationship,classified_relationship,ready_relationship,relationship_note; ${mapping}`,
		);
		await db.query(copy);
		staged = await answer();
		assert.deepEqual(staged, [
			{
				how_found: "vendor",
				how_found_detail: "Client waiting detail",
				roles: 2,
			},
		]);
	} finally {
		await db.query("rollback");
	}
	try {
		await run(setup + mapping, true);
		assert.deepEqual(await answer(), staged);
	} finally {
		await db.query("rollback");
	}
});

test("person accounts and older duplicates wait, and refused rows stay retryable even with an existing role", async () => {
	const setup = `${extraParties}
 insert into public.client (id,party_id,status,client_type,acquisition_source,created_by,updated_by) values ('${id(85)}','${id(80)}','roster','national_account','Example client source','${id(1)}','${id(1)}');
 insert into public.lead (id,party_id,stage,source_type,notes,next_action_date,created_at,updated_at,created_by,updated_by) values
 ('${id(86)}','${id(81)}','new','Example referral','Older waiting note','2027-01-01','2024-01-01','2024-01-01','${id(1)}','${id(1)}'),
 ('${id(87)}','${id(81)}','other','Example referral',null,null,'2025-01-01','2025-01-01','${id(1)}','${id(1)}'),
 ('${id(88)}','${id(82)}','other','Example referral','Retryable note',null,'2025-01-01','2025-01-01','${id(1)}','${id(1)}');
 update party set how_found = 'referral' where id = '${id(82)}';
 insert into party_role (party_id,role,stage,changed_by_user_id) values ('${id(82)}','lead','new','${id(1)}');`;
	try {
		const waiting = await run(setup, true);
		assert.ok(
			waiting.some(
				(r) =>
					r.old_id === id(85) && r.reason === "national_account_needs_company",
			),
		);
		for (const table of ["party_role", "activity_about", "next_step"])
			assert.deepEqual(
				await rows(
					`select * from ${table} where party_id in ('${id(80)}','${id(81)}')`,
				),
				[],
			);
		assert.deepEqual(
			await rows(
				`select * from outside_id where value in ('${id(86)}','${id(87)}','${id(88)}')`,
			),
			[],
		);
		await db.query(`drop table not_copied,old_relationship,relationship_source,mapped_source,waiting_client_source,examined_relationship,classified_relationship,ready_relationship,relationship_note;
  update public.lead set stage='new' where id in ('${id(87)}','${id(88)}');`);
		await db.query(copy);
		assert.deepEqual(
			await rows(
				`select summary from activity where summary in ('Older waiting note','Retryable note') order by summary`,
			),
			[{ summary: "Older waiting note" }, { summary: "Retryable note" }],
		);
	} finally {
		await db.query("rollback");
	}
});
