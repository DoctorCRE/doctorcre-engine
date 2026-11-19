import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { readSchema } from "./test-copy.ts";
import { doorTest } from "./test-door.ts";
import {
	assertCompletionDates,
	completionEvents,
	id,
	stepsAndHistory,
} from "./test-step-completions.ts";

const { db, setup, cleanup, save } = doorTest();
const copy = await readSchema("copy-leads-clients.sql");
const rows = async (sql: string) => (await db.query(sql)).rows;
const clients = async () => {
	const copied = await rows(
		"select party_id, owner_user_id, changed_at, changed_by_user_id from client order by party_id",
	);
	return {
		owners: copied.map((r) => [r.party_id, r.owner_user_id]),
		stamps: copied.map((r) => [r.party_id, r.changed_at, r.changed_by_user_id]),
	};
};
const history = () => rows("select * from change order by id");
// A copy starts clear of every temp table, so it supplies the source mappings again before sql.
const freshCopy = async (sql = ""): Promise<pg.QueryResultRow[]> => {
	const result =
		await db.query(`discard temp; create temp table copy_how_found (old_type text, source text, how_found text, primary key (old_type, source)) on commit drop;
 insert into copy_how_found values ('lead','Example referral','referral'), ('client','Example client source','vendor'), ('candidate_pool','Example pool','public_records');
 ${sql}; ${copy}`);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const run = async (
	setup = "",
	keepOpen = false,
): Promise<pg.QueryResultRow[]> => {
	await db.query("begin; select set_config('engine.job','old_system',true)");
	try {
		const report = await freshCopy(
			setup && `${setup}; set constraints all immediate`,
		);
		if (keepOpen) return report;
		await db.query("commit");
		assert.deepEqual(
			await rows(
				"select relname from pg_class where relnamespace = pg_my_temp_schema()",
			),
			[],
			"no copier temp table outlives its transaction",
		);
		return report;
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
};
let report: pg.QueryResultRow[];
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id,slug,kind,display_name) values ('${id(1)}','example_user','human','Example User');
 insert into party (id,kind,name) values ('${id(1)}','person','Example User');
 insert into app_user (id, slug) values ('${id(1)}', 'user-${id(1)}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(1)}','${id(1)}');
 insert into public.contact_state (slug,label,contactable,sort) values ('active','Example active',true,1);
 insert into public.lead_stage (slug,label) select s,s from unnest(array['new','qualified','nurture_drip','closed_lost','closed_won','active_deal','do_not_contact','engaged','opportunity','other']) s;
 insert into public.client_status (slug,label) select s,s from unnest(array['roster','active_deal','past_client','cold','prospect']) s;
 insert into public.client_type (slug,label) values ('franchise','Example franchise'),('national_account','Example account'), ('group','Example group'), ('other','Example unknown');
 insert into public.lead_lane (slug,label) values ('example_lane','Example lane');
 ${Array.from({ length: 17 }, (_, i) => {
		const n = i + 10;
		return `insert into public.party (id,kind,name,created_by,updated_by) values ('${id(n)}','${n === 11 || n === 12 ? "org" : "person"}','Example ${n}','${id(1)}','${id(1)}');
 insert into party (id,kind,name) values ('${id(n)}','${n === 11 || n === 12 ? "company" : "person"}','Example ${n}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(n)}','${id(n)}');`;
 }).join("\n")}
 insert into public.lead (id,party_id,stage,source_type,created_by,updated_by,created_at,updated_at,owner_id,source_detail,notes,next_action_date,lane,segment,est_lease_event,event_source,event_confidence,last_touch,notes_path) values
 ('${id(30)}','${id(10)}','qualified','Example referral','${id(1)}','${id(1)}','2024-01-01','2025-02-01','${id(1)}','Example lead detail','Example note from 2025-01-04.','2026-12-01','example_lane','Example segment','2027-01-01','Example lease source','high','2025-01-01','example/file.md');
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
 ('${id(65)}','${id(26)}','opportunity','Example referral',null,null,null,'${id(1)}','${id(1)}'),
 ('${id(64)}','${id(12)}','new','Example referral','Unrelated source detail',null,null,'${id(1)}','${id(1)}');
 insert into public.candidate_pool (id,source,source_key,source_row,name,status,promoted_lead_id,score_basis,est_lease_event,est_basis,created_by,updated_by) values
 ('${id(70)}','Example pool','example-key','{}','Example candidate','promoted','${id(63)}','Example qualification','2027-02-01','Example basis','${id(1)}','${id(1)}');
 update public.lead set est_lease_event = '2027-02-01' where id = '${id(63)}';`);
	await db.query(`begin; select set_config('engine.job','old_system',true); alter table party disable trigger stamp_change;
 update party set changed_at = '2030-01-01' where id = '${id(10)}'; alter table party enable trigger stamp_change; commit;`);
	report = await run();
});
after(cleanup);

test("old converted leads with no deal link stay out of the Prospects lane", async () => {
	const [status, lane] = await save(
		{ user: `user-${id(1)}` },
		"prospects",
		{},
		"GET",
	);
	assert.equal(status, 200);
	assert.equal(lane.count, 1);
	assert.ok(Array.isArray(lane.prospects));
	assert.deepEqual(
		lane.prospects.map((row) => row.party_id),
		[id(26)],
	);
	assert.deepEqual(
		await rows(`select r.party_id, r.stage, c.new_value->>'reason' as reason
 from party_role r join change c on c.record = jsonb_build_object('party_id', r.party_id, 'role', r.role)
 where r.role = 'lead' and r.party_id in ('${id(16)}','${id(17)}')
 and c.table_name = 'party_role' and c.action = 'insert' order by r.party_id`),
		[16, 17].map((n) => ({
			party_id: id(n),
			stage: "archived",
			reason: "became a deal in the old system",
		})),
	);
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
				["archived"],
				["archived"],
				["engaged"],
			],
		],
		[
			"select summary from activity order by summary",
			[
				["Example lead detail"],
				["Example note from January 4, 2025."],
				["Unrelated source detail"],
			],
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
	assert.deepEqual(await rows("select party_id, reason from do_not_contact"), [
		{ party_id: id(13), reason: "not recorded before this system" },
	]);
	for (const table of ["client_brand", "national_account_owner"])
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

const waitingParties = (ids: number[]) =>
	ids
		.map(
			(
				n,
			) => `insert into public.party (id,kind,name,created_by,updated_by) values ('${id(n)}','person','Example waiting party','${id(1)}','${id(1)}');
 insert into party (id,kind,name) values ('${id(n)}','person','Example waiting party');
 insert into outside_id (source,value,party_id) values ('old_system','${id(n)}','${id(n)}');`,
		)
		.join("\n");
const extraParties = waitingParties([80, 81, 82]);

test("an unmapped client source waits, and mapping it later matches mapping it at once", async () => {
	const setup = `${extraParties}
 insert into public.lead (id,party_id,stage,source_type,source_detail,created_by,updated_by) values ('${id(83)}','${id(80)}','new','Example referral','Lead waiting detail','${id(1)}','${id(1)}');
 insert into public.client (id,party_id,status,client_type,acquisition_source,acquisition_detail,created_by,updated_by) values ('${id(84)}','${id(80)}','roster','franchise','Unmapped client source','Client waiting detail','${id(1)}','${id(1)}');
 insert into public.actor (id,slug,kind,display_name) values ('${id(89)}','example_source_job','automation','Example source job');
 update public.lead set owner_id = '${id(89)}' where id = '${id(83)}';
 update public.client set owner_id = '${id(89)}' where id = '${id(84)}';`;
	const mapping =
		"insert into copy_how_found values ('client','Unmapped client source','vendor');";
	const answer = () =>
		rows(
			`select how_found,how_found_detail,(select count(*)::int from party_role where party_id = p.id) as roles from party p where id = '${id(80)}'`,
		);
	let staged: pg.QueryResultRow[];
	try {
		const waiting = await run(setup, true);
		assert.ok(
			waiting.some(
				(r) =>
					r.old_id === id(83) &&
					r.reason === "client_source_needs_mapping" &&
					r.field === "how_found" &&
					r.value === "Unmapped client source",
			),
		);
		assert.ok(
			!waiting.some(
				(r) =>
					[id(83), id(84)].includes(r.old_id) &&
					r.reason === "existing_source_differs",
			),
		);
		assert.deepEqual(
			waiting
				.filter((r) => r.old_id === id(84) && r.field === "owner_id")
				.map((r) => r.reason),
			["deal_owner_unresolved"],
		);
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
		await freshCopy(mapping);
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
	try {
		const waiting = await run(
			setup +
				`update party set how_found='referral' where id='${id(80)}';
  insert into party_role (party_id,role,stage) values ('${id(80)}','lead','new');
  update public.lead set notes='Waiting existing note' where id='${id(83)}';`,
			true,
		);
		assert.deepEqual(await answer(), [
			{ how_found: "referral", how_found_detail: null, roles: 1 },
		]);
		assert.ok(
			waiting.some(
				(r) =>
					r.old_id === id(83) && r.reason === "client_source_needs_mapping",
			),
		);
		assert.deepEqual(
			await rows(
				"select * from activity where summary='Waiting existing note'",
			),
			[],
		);
	} finally {
		await db.query("rollback");
	}
});

test("a lead or client with no source copies as not recorded, waits while another source needs mapping, and a recorded source replaces it", async () => {
	const setup = `${extraParties}
 insert into public.lead (id,party_id,stage,source_type,created_by,updated_by) values
 ('${id(83)}','${id(80)}','new',null,'${id(1)}','${id(1)}'),
 ('${id(86)}','${id(81)}','new','Example referral','${id(1)}','${id(1)}'),
 ('${id(87)}','${id(82)}','new','Unmapped lead source','${id(1)}','${id(1)}');
 insert into public.client (id,party_id,status,client_type,acquisition_source,created_by,updated_by) values
 ('${id(84)}','${id(81)}','roster','franchise','  ','${id(1)}','${id(1)}'),
 ('${id(85)}','${id(82)}','roster','franchise',null,'${id(1)}','${id(1)}');`;
	const answer = () =>
		rows(
			`select id,how_found,(select count(*)::int from party_role where party_id = p.id) as roles from party p
			where id in ('${id(80)}','${id(81)}','${id(82)}') order by id`,
		);
	try {
		const listed = await run(setup, true);
		assert.deepEqual(await answer(), [
			{ id: id(80), how_found: "not_recorded", roles: 1 },
			{ id: id(81), how_found: "referral", roles: 2 },
			{ id: id(82), how_found: null, roles: 0 },
		]);
		assert.ok(
			!listed.some(
				(r) =>
					[id(84), id(86)].includes(r.old_id) &&
					["sources_disagree", "existing_source_differs"].includes(r.reason),
			),
		);
		for (const [held, reason] of [
			[id(85), "waits_for_other_source"],
			[id(87), "source_needs_mapping"],
		])
			assert.ok(listed.some((r) => r.old_id === held && r.reason === reason));
		await freshCopy(
			"insert into copy_how_found values ('lead','Unmapped lead source','vendor')",
		);
		assert.deepEqual((await answer())[2], {
			id: id(82),
			how_found: "vendor",
			roles: 2,
		});
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
		await freshCopy(
			`update public.lead set stage='new' where id in ('${id(87)}','${id(88)}')`,
		);
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

test("next actions, reference numbers and roster wording are copied once or listed, never invented", async () => {
	const setup = `${[90, 91, 92]
		.map(
			(
				n,
			) => `insert into public.party (id,kind,name,created_by,updated_by) values ('${id(n)}','person','Example party ${n}','${id(1)}','${id(1)}');
 insert into party (id,kind,name) values ('${id(n)}','person','Example party ${n}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(n)}','${id(n)}');`,
		)
		.join("\n")}
 insert into public.actor (id,slug,kind,display_name) values ('${id(119)}','example_bot','automation','Example bot');
 insert into public.lead (id,party_id,stage,source_type,registry_ref,next_action_date,created_at,updated_at,created_by,updated_by) values
 ('${id(100)}','${id(90)}','new','Example referral',' L-EX-1 ','2027-03-01','2025-01-01','2025-03-01','${id(1)}','${id(1)}'),
 ('${id(101)}','${id(90)}','new','Example referral','L-EX-2',null,'2024-01-01','2024-01-01','${id(1)}','${id(1)}'),
 ('${id(102)}','${id(91)}','new','Example referral','L-EX-1',null,'2025-01-01','2025-01-01','${id(1)}','${id(1)}');
 insert into public.client (id,party_id,status,client_type,acquisition_source,roster_ref,owner_id,owner_label,contact_label,deal_type_label,possible_duplicate_label,specialty_type_label,prospect_engagement_status,created_by,updated_by) values
 ('${id(103)}','${id(92)}','roster','franchise','Example client source','C-EX-1','${id(1)}','Example owner','Example contact','Example type','Example duplicate','Example specialty','inactive','${id(1)}','${id(1)}');
 insert into public.next_action (id,subject_type,subject_id,owner_id,description,due_on,status,hold_until,source_ref,created_at,updated_at,created_by) values
 ('${id(110)}','lead','${id(100)}','${id(1)}','Call back','2027-01-05','open',null,null,'2025-01-01','2025-01-01','${id(1)}'),
 ('${id(111)}','lead','${id(101)}','${id(1)}',E'\\t Call back\\n','2027-01-05','open',null,null,'2025-02-01','2025-02-01','${id(1)}'),
 ('${id(116)}','lead','${id(101)}','${id(1)}','Call back','2027-01-05','done',null,null,'2024-06-01','2024-07-01','${id(1)}'),
 ('${id(112)}','lead','${id(100)}','${id(1)}','Call back','2027-02-05','done',null,null,'2025-01-01','2025-06-01','${id(1)}'),
 ('${id(113)}','lead','${id(100)}','${id(1)}','Old plan',null,'dropped',null,null,'2025-01-01','2025-01-01','${id(1)}'),
 ('${id(114)}','lead','${id(100)}','${id(119)}',E'\\t\\n',null,'open',null,null,'2025-01-01','2025-01-01','${id(1)}'),
 ('${id(109)}','client','${id(103)}','${id(119)}','Earlier proposal follow-up 2025-01-04.',null,'open',null,null,'2024-12-31','2025-01-01','${id(1)}'),
 ('${id(115)}','client','${id(103)}','${id(1)}','Send proposal','2027-04-01','open','2027-03-01','example-ref','2025-01-01','2025-01-01','${id(1)}'),
 ('${id(105)}','client','${id(103)}','${id(1)}','Example lapsed',null,'expired',null,null,'2025-01-01','2025-01-01','${id(1)}'),
 ('${id(106)}','lead','${id(100)}','${id(1)}','Example replaced',null,'dropped',null,null,'2025-01-01','2025-01-01','${id(1)}'),
 ('${id(107)}','lead','${id(100)}','${id(1)}','Example finished',null,'done',null,null,'2025-01-01','2025-08-01','${id(1)}'),
 ('${id(118)}','lead','${id(100)}','${id(1)}','Example expired',null,'expired',null,null,'2025-01-01','2025-01-01','${id(1)}');
 insert into public.event (id,subject_type,subject_id,field,new_value,human_quote,actor_id,verb,cause,occurred_at) values
 ('${id(600)}','lead','${id(100)}','status','{"next_action_id":"${id(112)}","status":"done","version":1}',null,'${id(1)}','complete-one-action','human_stated','2025-05-15'),
 ('${id(601)}','lead','${id(100)}','status','{"next_action_id":"${id(113)}","status":"dropped","version":1,"reason":"Example no longer needed"}','Example no longer needed','${id(1)}','drop-action','human_stated','2025-02-01'),
 ('${id(602)}','clear_the_deck','${id(602)}',null,'{"kind":"next_action","action":"drop","rows":[{"id":"${id(118)}","status":"open"}]}',null,'${id(1)}','clear-the-deck-apply','human_stated','2025-03-01');`;
	const steps = () =>
		rows(
			`select id,party_id,what,due_on::text,owner_party_id,done_at::text from next_step where party_id in ('${id(90)}','${id(91)}','${id(92)}') order by party_id,due_on,id`,
		);
	const listed = (report: pg.QueryResultRow[]) =>
		report
			.filter(
				(r) =>
					r.old_id >= id(100) &&
					r.old_id <= id(119) &&
					!/several_records|client_owner/.test(r.reason),
			)
			.map((r) => [r.old_id, r.field, r.value, r.reason]);
	try {
		const report = await run(setup, true);
		// biome-ignore format: one row per copied action
		const copied = [
			[id(110), id(90), "Call back", "2027-01-05", id(1), null],
			[id(112), id(90), "Call back", "2027-02-05", id(1), "2025-05-15 00:00:00+00"],
			[id(106), id(90), "Example replaced", null, id(1), null],
			[id(107), id(90), "Example finished", null, id(1), null],
			[id(113), id(90), "Old plan", null, id(1), null],
			[id(118), id(90), "Example expired", null, id(1), null],
			[id(115), id(92), "Send proposal", "2027-04-01", id(1), null],
			[id(105), id(92), "Example lapsed", null, id(1), null],
			[id(109), id(92), "Earlier proposal follow-up January 4, 2025.", null, id(1), null],
		];
		assert.deepEqual((await steps()).map(Object.values), copied);
		assert.deepEqual(
			await rows(
				"select id, hold_until::text from next_step where hold_until is not null",
			),
			[{ id: id(115), hold_until: "2027-03-01" }],
		);
		// biome-ignore format: one row per ended action
		assert.deepEqual((await rows(`select id,status,resolved_at::text,resolution_reason,resolution_event_id from next_step where party_id in ('${id(90)}','${id(92)}') and status <> 'open' order by id`)).map(Object.values), [
			[id(105), "expired", null, null, null],
			[id(106), "cancelled", null, "not recorded before this system", null],
			[id(107), "done", null, null, null],
			[id(109), "cancelled", null, "replaced at the move", null],
			[id(112), "done", null, null, null],
			[id(113), "cancelled", "2025-02-01 00:00:00+00", "Example no longer needed", id(601)],
			[id(118), "expired", "2025-03-01 00:00:00+00", null, id(602)],
		]);
		assert.deepEqual(
			(
				await rows(
					`select value,party_id from outside_id where source = 'old_system_ref' and value like '_-EX-%' order by value`,
				)
			).map(Object.values),
			[
				["C-EX-1", id(92)],
				["L-EX-1", id(90)],
				["L-EX-2", id(90)],
			],
		);
		const expected = [
			[id(102), "registry_ref", "L-EX-1", `also the id of ${id(90)}`],
			[
				id(103),
				"contact_label",
				"Example contact",
				"verbatim_label_not_stored",
			],
			[id(103), "deal_type_label", "Example type", "verbatim_label_not_stored"],
			[id(103), "owner_label", "Example owner", "verbatim_label_not_stored"],
			[
				id(103),
				"possible_duplicate_label",
				"Example duplicate",
				"verbatim_label_not_stored",
			],
			[
				id(103),
				"prospect_engagement_status",
				"inactive",
				"engagement_status_not_stored",
			],
			[
				id(103),
				"specialty_type_label",
				"Example specialty",
				"verbatim_label_not_stored",
			],
			[id(105), "resolution_event_id", null, "expiry_unproven"],
			[id(111), "next_step", id(110), "open_step_exists"],
			[id(114), "description", "\t\n", "blank_next_action"],
			[id(115), "source_ref", "example-ref", "reference_not_copied"],
		];
		assert.deepEqual(listed(report), expected);
		assert.deepEqual(listed(await freshCopy()), expected);
		assert.deepEqual((await steps()).map(Object.values), copied);
		await freshCopy(`insert into public.lead (id,party_id,stage,source_type,created_at,updated_at,created_by,updated_by) values ('${id(104)}','${id(90)}','new','Example referral','2025-04-01','2025-04-01','${id(1)}','${id(1)}');
 insert into public.next_action (id,subject_type,subject_id,owner_id,description,due_on,created_at,created_by) values ('${id(117)}','lead','${id(104)}','${id(1)}','Call back','2027-01-05','2020-01-01','${id(1)}');`);
		assert.deepEqual((await steps()).map(Object.values), copied);
		const corrected = [
			...copied.slice(0, 5),
			[id(114), id(90), "Ask for plans", null, null, null],
			...copied.slice(5),
		];
		for (const correction of [
			`update public.next_action set description = 'Ask for plans' where id = '${id(114)}'`,
			"",
		]) {
			await freshCopy(correction);
			assert.deepEqual((await steps()).map(Object.values), corrected);
		}
	} finally {
		await db.query("rollback");
	}
});

test("a converted lead keeps the recorded client action over a date-only follow-up", async () => {
	const party = id(93);
	const lead = id(120);
	const client = id(121);
	const action = id(122);
	const owner = id(1);
	try {
		const report = await run(
			`insert into public.party (id,kind,name,created_by,updated_by) values ('${party}','person','Example converted lead','${owner}','${owner}');
 insert into party (id,kind,name) values ('${party}','person','Example converted lead');
 insert into outside_id (source,value,party_id) values ('old_system','${party}','${party}');
 insert into public.client (id,party_id,status,client_type,acquisition_source,created_by,updated_by) values
 ('${client}','${party}','roster','franchise','Example client source','${owner}','${owner}');
 insert into public.lead (id,party_id,client_id,stage,source_type,owner_id,next_action_date,created_at,updated_at,created_by,updated_by) values
 ('${lead}','${party}','${client}','new','Example referral','${owner}','2027-03-01','2025-01-01','2025-01-01','${owner}','${owner}');
 insert into public.next_action (id,subject_type,subject_id,owner_id,description,due_on,created_at,updated_at,created_by) values
 ('${action}','client','${client}','${owner}','Send proposal','2027-04-01','2025-02-01','2025-02-01','${owner}');`,
			true,
		);
		assert.deepEqual(
			await rows(
				`select what, status, owner_party_id, resolution_reason from next_step where party_id = '${party}' order by status desc`,
			),
			[
				{
					what: "Send proposal",
					status: "open",
					owner_party_id: owner,
					resolution_reason: null,
				},
				{
					what: "Imported lead follow-up",
					status: "cancelled",
					owner_party_id: owner,
					resolution_reason: "replaced at the move",
				},
			],
		);
		assert.deepEqual(
			report.filter((row) => row.old_id === lead && row.field === "next_step"),
			[],
		);
		const nextAction = id(123);
		const retried = await freshCopy(
			`insert into public.next_action (id,subject_type,subject_id,owner_id,description,created_by) values
 ('${nextAction}','lead','${lead}','${owner}','Example recorded lead action','${owner}')`,
		);
		assert.deepEqual(
			retried.filter((row) => row.old_id === nextAction),
			[
				{
					old_id: nextAction,
					field: "next_step",
					value: action,
					reason: "open_step_exists",
				},
			],
		);
		assert.deepEqual(
			await rows(
				`select id, status from next_step where id in ('${action}', '${nextAction}') order by id`,
			),
			[{ id: action, status: "open" }],
		);
	} finally {
		await db.query("rollback");
	}
});

for (const [subject, record] of [
	["lead", 30],
	["client", 40],
] as const) {
	test(`${subject} completion events date only the named done actions and survive reruns`, async () => {
		try {
			await run(completionEvents(subject, record), true);
			await assertCompletionDates(rows);
			const snapshot = () => rows(stepsAndHistory);
			const before = await snapshot();
			await freshCopy();
			assert.deepEqual(await snapshot(), before);
		} finally {
			await db.query("rollback");
		}
	});
}

test("a first client copy records only its insert with the agreed owner", async () => {
	try {
		await run(
			`${extraParties}
 insert into public.client (id,party_id,status,acquisition_source,owner_id,created_by,updated_by,created_at,updated_at) values
 ('${id(900)}','${id(80)}','prospect','Example client source','${id(1)}','${id(1)}','${id(1)}','2020-01-01','2024-01-01'),
 ('${id(901)}','${id(80)}','roster','Example client source',null,'${id(1)}','${id(1)}','2020-01-01','2025-01-01');`,
			true,
		);
		assert.deepEqual(
			await rows(
				`select action, new_value ->> 'owner_user_id' as owner from change where table_name = 'client' and record = jsonb_build_object('party_id', '${id(80)}'::text) order by id`,
			),
			[{ action: "insert", owner: id(1) }],
		);
	} finally {
		await db.query("rollback");
	}
});

test("event leads from automation stay unclaimed and clients take their deal or reviewed owner", async () => {
	try {
		const listed = await run(
			`${waitingParties([80, 81, 82, 83, 84])}
 insert into public.actor (id,slug,kind,display_name) values
 ('${id(2)}','example_deal_owner','human','Example Deal Owner'),
 ('${id(3)}','example_unmapped_owner','human','Example Unmapped Owner'),
 ('${id(89)}','example_automation','automation','Example Automation');
 insert into party (id,kind,name) values ('${id(2)}','person','Example Deal Owner');
 insert into app_user (id,slug) values ('${id(2)}','example_deal_owner');
 insert into outside_id (source,value,party_id) values ('old_system','${id(2)}','${id(2)}');
 insert into public.lead (id,party_id,stage,source_type,owner_id,created_by,updated_by)
 values ('${id(900)}','${id(80)}','new','Example convention','${id(89)}','${id(1)}','${id(1)}');
 insert into copy_how_found values ('lead','Example convention','event');
 insert into public.client (id,party_id,status,owner_id,owner_label,created_by,updated_by) values
 ('${id(901)}','${id(81)}','roster','${id(89)}',null,'${id(1)}','${id(1)}'),
 ('${id(902)}','${id(82)}','roster',null,'Example shared label','${id(1)}','${id(1)}'),
 ('${id(903)}','${id(80)}','roster','${id(89)}',null,'${id(1)}','${id(1)}'),
 ('${id(904)}','${id(83)}','roster','${id(89)}',null,'${id(1)}','${id(1)}'),
 ('${id(905)}','${id(84)}','roster','${id(89)}',null,'${id(1)}','${id(1)}');
 insert into public.deal_type_ref (slug,label,sort) values ('lease','Example lease',1);
 insert into public.deal_phase (slug,label) values ('negotiation','Example negotiation');
 insert into public.deal (client_id,name,deal_type,phase,owner,created_by,updated_by) values
 ('${id(901)}','Example deal','lease','negotiation','example_deal_owner','${id(1)}','${id(1)}'),
 ('${id(901)}','Example second deal','lease','negotiation','example_deal_owner','${id(1)}','${id(1)}'),
 ('${id(903)}','Example disputed deal','lease','negotiation','example_deal_owner','${id(1)}','${id(1)}'),
 ('${id(903)}','Example other deal','lease','negotiation','example_user','${id(1)}','${id(1)}'),
 ('${id(904)}','Example deal with a mapped owner','lease','negotiation','example_deal_owner','${id(1)}','${id(1)}'),
 ('${id(904)}','Example deal without an owner','lease','negotiation',null,'${id(1)}','${id(1)}'),
 ('${id(905)}','Example deal with a mapped owner','lease','negotiation','example_deal_owner','${id(1)}','${id(1)}'),
 ('${id(905)}','Example deal with an unmapped owner','lease','negotiation','example_unmapped_owner','${id(1)}','${id(1)}');
 create temp table copy_client_owner (old_id uuid primary key, owner_actor_id uuid not null) on commit drop;
 insert into copy_client_owner values ('${id(902)}','${id(1)}');`,
			true,
		);
		assert.deepEqual(
			await rows(`select p.how_found, r.owner_user_id from party p join party_role r on r.party_id = p.id
 where p.id = '${id(80)}' and r.role = 'lead'`),
			[{ how_found: "event", owner_user_id: null }],
		);
		assert.deepEqual(
			(await clients()).owners.filter(([party]) =>
				[id(80), id(81), id(82), id(83), id(84)].includes(party),
			),
			[
				[id(80), null],
				[id(81), id(2)],
				[id(82), id(1)],
				[id(83), null],
				[id(84), null],
			],
		);
		assert.deepEqual(
			listed
				.filter(
					(r) =>
						[id(900), id(901), id(902), id(903), id(904), id(905)].includes(
							r.old_id,
						) && r.field.startsWith("owner"),
				)
				.map((r) => [r.old_id, r.reason]),
			[
				[id(903), "deal_owner_unresolved"],
				[id(904), "deal_owner_unresolved"],
				[id(905), "deal_owner_unresolved"],
			],
		);
	} finally {
		await db.query("rollback");
	}
});

test("client responsibility maps known users, retries unknown owners, and leaves account ownership alone", async () => {
	try {
		const waiting = await run(
			`
 insert into public.actor (id,slug,kind,display_name) values ('${id(89)}','example_unknown_owner','human','Example unknown user');
 update public.client set owner_id = '${id(1)}', owner_label = 'Example display label' where id = '${id(40)}';
 insert into public.client (id,party_id,status,acquisition_source,owner_id,created_by,updated_by,created_at,updated_at) values
 ('${id(901)}','${id(11)}','prospect','Example client source','${id(89)}','${id(1)}','${id(1)}','2020-01-01','2024-01-01');
 update public.client set owner_label = 'Example User' where id = '${id(42)}';`,
			true,
		);
		assert.deepEqual((await clients()).owners, [
			[id(10), id(1)],
			[id(11), null],
			[id(12), null],
			[id(21), null],
		]);
		assert.ok(
			waiting.some(
				(r) => r.old_id === id(901) && r.reason === "owner_not_a_user",
			),
		);
		assert.ok(
			waiting.some(
				(r) => r.old_id === id(42) && r.reason === "owner_label_only",
			),
		);
		assert.deepEqual(await rows("select * from national_account_owner"), []);

		const stamps = (await clients()).stamps;
		const beforeRerun = await history();
		assert.deepEqual(await freshCopy(), waiting);
		assert.deepEqual(await history(), beforeRerun);
		await freshCopy(
			`insert into outside_id (source,value,party_id) values ('old_system','${id(89)}','${id(1)}')`,
		);
		assert.deepEqual((await clients()).owners, [
			[id(10), id(1)],
			[id(11), id(1)],
			[id(12), null],
			[id(21), null],
		]);
		assert.deepEqual((await clients()).stamps, stamps);
		const afterCorrection = await history();
		await freshCopy();
		assert.deepEqual(await history(), afterCorrection);
		assert.equal((await clients()).owners[1]?.[1], id(1));
	} finally {
		await db.query("rollback");
	}
});

test("conflicting client owners wait, a corrected conflict retries, and an existing owner is never replaced", async () => {
	try {
		const waiting = await run(
			`${extraParties}
 insert into public.actor (id,slug,kind,display_name) values ('${id(2)}','example_second_user','human','Example second user'), ('${id(89)}','example_unmapped_user','human','Example unmapped user');
 insert into party (id,kind,name) values ('${id(2)}','person','Example second user');
 insert into app_user (id, slug) values ('${id(2)}', 'user-${id(2)}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(2)}','${id(2)}');
 insert into public.client (id,party_id,status,acquisition_source,owner_id,created_by,updated_by) values
 ${(
		[
			[900, 80, 1],
			[901, 80, 2],
			[902, 81, 1],
			[903, 81, 89],
			[904, 82, 1],
			[905, 82, null],
		] satisfies [number, number, number | null][]
 )
		.map(
			([client, party, owner]) =>
				`('${id(client)}','${id(party)}','roster','Example client source',${owner === null ? "null" : `'${id(owner)}'`},'${id(1)}','${id(1)}')`,
		)
		.join(",")};`,
			true,
		);
		const reasons = (report: pg.QueryResultRow[], n: number) =>
			report
				.filter((r) => r.old_id === id(n) && r.field === "owner_id")
				.map((r) => r.reason);
		assert.deepEqual(reasons(waiting, 900), ["client_owners_disagree"]);
		assert.deepEqual(reasons(waiting, 901), ["client_owners_disagree"]);
		assert.deepEqual(reasons(waiting, 902), ["client_owners_disagree"]);
		assert.deepEqual(reasons(waiting, 903), ["owner_not_a_user"]);
		assert.deepEqual(reasons(waiting, 904), []);
		assert.deepEqual(reasons(waiting, 905), []);
		assert.deepEqual(
			(await clients()).owners.filter(
				([party]) => party >= id(80) && party <= id(82),
			),
			[
				[id(80), null],
				[id(81), null],
				[id(82), id(1)],
			],
		);
		assert.deepEqual(await freshCopy(), waiting);
		await freshCopy(
			`update public.client set owner_id = '${id(1)}' where id = '${id(901)}'`,
		);
		assert.deepEqual(
			(await clients()).owners.filter(
				([party]) => party >= id(80) && party <= id(82),
			),
			[
				[id(80), id(1)],
				[id(81), null],
				[id(82), id(1)],
			],
		);
		const conflict = await freshCopy(
			`update public.client set owner_id = '${id(2)}' where id in ('${id(900)}','${id(901)}')`,
		);
		assert.deepEqual(reasons(conflict, 900), ["existing_client_owner_differs"]);
		assert.deepEqual(reasons(conflict, 901), ["existing_client_owner_differs"]);
		assert.deepEqual(
			(await clients()).owners.filter(
				([party]) => party >= id(80) && party <= id(82),
			),
			[
				[id(80), id(1)],
				[id(81), null],
				[id(82), id(1)],
			],
		);
	} finally {
		await db.query("rollback");
	}
});

test("the database refuses a client owner who is not a user", async () => {
	await db.query("begin; select set_config('engine.job','old_system',true)");
	try {
		await assert.rejects(
			db.query(
				`update client set owner_user_id = '${id(10)}' where party_id = '${id(10)}'`,
			),
			{ code: "23503", constraint: "client_owner_user_id_fkey" },
		);
	} finally {
		await db.query("rollback");
	}
});
