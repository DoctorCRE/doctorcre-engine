import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number) => `next_action:${id(n)}`;
const [leads, copy] = await Promise.all([
	readSchema("copy-leads-clients.sql"),
	readSchema("copy-preferences.sql"),
]);
const { db, setup, cleanup } = copyTest();
const rows = async (sql: string) =>
	(await db.query({ text: sql, rowMode: "array" })).rows;
const run = async (sql = copy, fixtureSql = "", keepOpen = false) => {
	await db.query(
		"begin; select set_config('engine.job','old_system',true); create temp table if not exists copy_how_found (old_type text, source text, how_found text, primary key (old_type, source)) on commit drop; insert into copy_how_found values ('lead','Example referral','referral') on conflict do nothing",
	);
	try {
		if (fixtureSql) await db.query(fixtureSql);
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
		"select item_id, disposition, snoozed_until::text, waiting_on_party_id, waiting_reason, created_at::text, changed_at::text, changed_by_user_id, changed_by_job from home_mark order by item_id",
	);
const preferences = () =>
	rows(
		"select user_id, time_zone, quiet_from::text, quiet_until::text, push_to_device, changed_by_user_id, changed_by_job, changed_at = created_at from user_preference order by user_id",
	);
let report: unknown[][];
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id,slug,kind,display_name) values ${[1, 2, 3, 4].map((n) => `('${id(n)}','example_${n}','human','Example User ${n}')`).join(",")};
 ${users
		.map(
			(
				n,
			) => `insert into party (id,kind,name) values ('${id(n)}','person','Example User ${n}');
 insert into app_user (id, slug) values ('${id(n)}', 'user-${id(n)}');
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
after(cleanup);

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

test("the engine can save a copied user's time zone with owner-only defaults", async () => {
	await db.query("begin");
	try {
		await db.query(`set local role engine;
			select set_config('engine.user_id', '${id(1)}', true)`);
		assert.deepEqual(
			await rows(`update user_preference set time_zone = 'America/Denver'
				where user_id = '${id(1)}' returning time_zone`),
			[["America/Denver"]],
		);
	} finally {
		await db.query("rollback");
	}
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

test("call follow-ups and inherited v2 marks keep the old Home's identity and precedence on reruns", async () => {
	const callItem = (n: number) => `capture_post_call_action:${id(n)}`;
	const originalMarks = await marks();
	const setup = `
 insert into public.client (id,party_id,created_by,updated_by) values ('${id(40)}','${id(10)}','${id(1)}','${id(1)}');
 insert into public.deal_type_ref (slug,label,sort) values ('lease','Example lease',1);
 insert into public.deal_phase (slug,label) values ('closed','Example closed');
 insert into public.deal (id,client_id,name,deal_type,phase,created_by,updated_by)
 values ('${id(50)}','${id(40)}','Example deal','lease','closed','${id(1)}','${id(1)}');
 insert into deal (id,name,owner_user_id) values ('${id(50)}','Example deal','${id(1)}');
 insert into public.capture_session (id,nonce,device_id,actor_id,mode,started_at,consent_announced_at,session_token_hash,expires_at,state_at)
 values ('${id(400)}','example-nonce','example-device','${id(1)}','meeting','2025-01-01','2025-01-01','example-hash','2025-01-02','2025-01-01');
 insert into public.capture_post_call_candidate (id,session_id,idempotency_key,batch_hash,item_index,kind,deal_id,assignee_slug,action_description,evidence_quote,confidence)
 select v,'${id(400)}',v::text,'example-batch',row_number() over () - 1,'assigned_action','${id(50)}','partner_one','Example follow-up','Example evidence',1
 from unnest(array[${[501, 502, 503, 504, 505].map((n) => `'${id(n)}'::uuid`).join(",")}]) v;
 insert into public.capture_post_call_action (id,candidate_id,deal_id,owner_id,description,accepted_by)
 select id,id,deal_id,'${id(1)}',action_description,'${id(1)}' from public.capture_post_call_candidate;
 insert into activity (id,kind,happened_at) values ('${id(400)}','call','2025-01-01');
 insert into activity_about (activity_id,deal_id) values ('${id(400)}','${id(50)}');
 insert into next_step (id,deal_id,what,call_activity_id,call_evidence_quote)
 select id,deal_id,description,'${id(400)}','Example evidence' from public.capture_post_call_action where id in ('${id(501)}','${id(502)}','${id(503)}');
 insert into next_step (id,party_id,what) values ('${id(505)}','${id(10)}','Example wrong record');
 insert into public.next_action (id,subject_type,subject_id,owner_id,description,status,created_by)
 select v,'lead','${id(30)}','${id(1)}','Example inherited step','done','${id(1)}'
 from unnest(array[${[110, 111, 112].map((n) => `'${id(n)}'::uuid`).join(",")}]) v;
 insert into next_step (id,party_id,what) select id,'${id(10)}',description from public.next_action where id in ('${id(110)}','${id(111)}','${id(112)}');
 insert into ops.home_inbox_disposition (actor_id,item_id,v2_item_id,disposition,snoozed_until,source_version,material_version,updated_at) values
 ('${id(1)}','${callItem(501)}',null,'snoozed','2026-12-01','1','m','2026-10-01'),
 ('${id(1)}','${callItem(502)}',null,'settled',null,'1','m','2026-10-02'),
 ('${id(1)}','${callItem(504)}',null,'settled',null,'1','m','2026-10-02'),
 ('${id(1)}','${callItem(505)}',null,'settled',null,'1','m','2026-10-02'),
 ('${id(1)}','${callItem(506)}',null,'settled',null,'1','m','2026-10-02'),
 ('${id(1)}','${callItem(503)}',null,'settled',null,'1','m','2026-10-02'),
 ('${id(1)}','${item(120)}','${item(110)}','settled',null,'1','m','2026-10-02'),
 ('${id(1)}','${item(121)}','${item(111)}','settled',null,'1','m','2026-10-03'),
 ('${id(1)}','${item(111)}',null,'inbox',null,'1','m','2026-10-01'),
 ('${id(1)}','${item(122)}','${item(112)}','snoozed','2026-12-01','1','m','2026-10-01'),
 ('${id(1)}','${item(123)}','${item(112)}','settled',null,'1','m','2026-10-02'),
 ('${id(1)}','${item(124)}','${item(112)}','snoozed','2026-12-01','1','m','2026-10-02'),
 ('${id(1)}','${item(125)}','${item(113)}','settled',null,'1','m','2026-10-02');
 insert into ops.home_waiting (actor_id,item_id,identity_kind,identity_id,reason,evidence,version,updated_at) values
 ('${id(1)}','${callItem(501)}','party','${id(11)}','Example reply','[]',1,'2026-10-05'),
 ('${id(1)}','${callItem(503)}','actor','${id(3)}','Example review','[]',1,'2026-10-06'),
 ('${id(1)}','${item(110)}','party','${id(11)}','Example inherited wait','[]',1,'2026-10-05');`;
	try {
		const firstReport = await run(copy, setup, true);
		assert.deepEqual(firstReport, [
			...report.slice(0, 1),
			...[504, 505, 506].map((n) => [
				id(1),
				"item_id",
				callItem(n),
				"next_step_not_copied",
			]),
			...report.slice(1, 4),
			...[113, 120, 121, 122, 123, 124, 125].map((n) => [
				id(1),
				"item_id",
				item(n),
				"next_step_not_copied",
			]),
			...report.slice(4),
		]);
		const addedMarks = (await marks()).filter(
			([step]) => !originalMarks.some(([original]) => original === step),
		);
		assert.deepEqual(
			await rows(
				"select call_follow_up_id from home_mark where call_follow_up_id is not null order by call_follow_up_id",
			),
			[[id(501)], [id(502)], [id(503)]],
		);
		assert.deepEqual(addedMarks, [
			[
				id(110),
				"settled",
				null,
				id(11),
				"Example inherited wait",
				"2026-10-02 00:00:00+00",
				"2026-10-05 00:00:00+00",
				id(1),
				null,
			],
			[
				id(112),
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
				id(501),
				"snoozed",
				"2026-12-01 00:00:00+00",
				id(11),
				"Example reply",
				"2026-10-01 00:00:00+00",
				"2026-10-05 00:00:00+00",
				id(1),
				null,
			],
			[
				id(502),
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
				id(503),
				"settled",
				null,
				id(3),
				"Example review",
				"2026-10-02 00:00:00+00",
				"2026-10-06 00:00:00+00",
				id(1),
				null,
			],
		]);
		const state = async () => [
			await marks(),
			await rows("select count(*) from change"),
		];
		const beforeRerun = await state();
		await db.query("discard temp");
		const rerun = await db.query(copy);
		assert.ok(Array.isArray(rerun));
		assert.deepEqual(rerun.at(-1)?.rows.map(Object.values), firstReport);
		assert.deepEqual(await state(), beforeRerun);
		await db.query(
			`insert into next_step (id,deal_id,what,call_activity_id,call_evidence_quote)
			values ('${id(504)}','${id(50)}','Example later copy','${id(400)}','Example evidence'); discard temp`,
		);
		const corrected = await db.query(copy);
		assert.ok(Array.isArray(corrected));
		assert.deepEqual(
			corrected.at(-1)?.rows.map(Object.values),
			firstReport.filter(([, , value]) => value !== callItem(504)),
		);
		assert.deepEqual((await marks()).at(-1)?.slice(0, 2), [id(504), "settled"]);
	} finally {
		await db.query("rollback");
	}
});
