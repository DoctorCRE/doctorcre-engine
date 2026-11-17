import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const { db, setup, cleanup } = copyTest();
const copy = await readSchema("copy-lead-stage-moves.sql");
const rows = async (sql: string) => (await db.query(sql)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	await db.query("begin");
	try {
		const results = await db.query(copy);
		assert.ok(Array.isArray(results));
		await db.query("commit");
		return results.at(-1)?.rows ?? [];
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
};
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into public.actor (id,slug,kind,display_name) values ('${id(1)}','example_user','human','Example User'), ('${id(2)}','example_job','automation','Example Job'), ('${id(3)}','example_missing_user','human','Example Missing User');
 insert into party (id,kind,name) values ('${id(1)}','person','Example User'); insert into app_user values ('${id(1)}');
 insert into public.contact_state (slug,label,contactable,sort) values ('active','Example active',true,1);
 insert into public.activity_kind (slug,label,is_contact) values ('call','Example call',true);
 insert into role (slug,label) values ('lead','Lead');
 insert into how_found (slug,label) values ('referral','Example referral');
 insert into stage (role,slug,label) select 'lead',s,s from unnest(array['new','qualified','outreach_active','engaged','nurture','opportunity','archived']) s;
 insert into public.lead_stage (slug,label) select s,s from unnest(array['new','qualified','outreach_active','engaged','nurture_drip','opportunity','archived']) s;
 alter table party_role disable trigger lead_stage_needs_evidence;
 ${Array.from({ length: 8 }, (_, i) => {
		const n = i + 10;
		return `insert into public.party (id,kind,name,created_by,updated_by) values ('${id(n)}','person','Example Lead','${id(2)}','${id(2)}');
 insert into public.lead (id,party_id,stage,created_by,updated_by) values ('${id(n + 20)}','${id(n)}','engaged','${id(2)}','${id(2)}');
 insert into party (id,kind,name,how_found) values ('${id(n)}','person','Example Lead','referral');
 insert into party_role (party_id,role,stage) values ('${id(n)}','lead','engaged');
 insert into outside_id (source,value,party_id) values ('old_system','${id(n + 20)}','${id(n)}');
 insert into public.activity (id,kind,occurred_at,actor_id,summary) values ('${id(n + 40)}','call','2024-01-01','${id(2)}','Example call');
 insert into activity (id,kind,happened_at) values ('${id(n + 40)}','call','2024-01-01');
 insert into activity_about (activity_id,party_id) values ('${id(n + 40)}','${id(n)}');`;
 }).join("\n")}
 set constraints all immediate;
 alter table party_role enable trigger lead_stage_needs_evidence;
 insert into public.lead_stage_move (id,lead_id,from_stage,to_stage,activity_id,evidence_ref,strength,status,created_by,created_at,approved_by,approved_at,undone_by,undone_at,reason) values
 ('${id(70)}','${id(30)}','new','qualified','${id(50)}','Example strong evidence','strong','applied','${id(2)}','2024-01-01',null,null,null,null,'Example reason'),
 ('${id(71)}','${id(31)}','engaged','nurture_drip','${id(51)}','Example pending evidence','weak','proposed','${id(2)}','2024-02-01',null,null,null,null,'Example pending reason'),
 ('${id(72)}','${id(32)}','engaged','opportunity','${id(52)}','Example undo evidence','weak','undone','${id(2)}','2024-03-01','${id(1)}','2024-03-02','${id(1)}','2024-03-03','Example undo reason'),
 ('${id(73)}','${id(33)}','engaged','archived','${id(53)}','Example archive evidence','strong','applied','${id(2)}','2024-04-01','${id(1)}','2024-04-02',null,null,'Example archive reason'),
 ('${id(74)}','${id(34)}','new','qualified','${id(54)}',' ','strong','applied','${id(2)}','2024-05-01',null,null,null,null,E'\\t'),
 ('${id(75)}','${id(35)}','engaged','opportunity','${id(55)}','Example missing activity','weak','proposed','${id(2)}','2024-06-01',null,null,null,null,'Example reason'),
 ('${id(76)}','${id(36)}','engaged','opportunity','${id(56)}','Example missing user','weak','applied','${id(2)}','2024-07-01','${id(3)}','2024-07-02',null,null,'Example reason'),
 ('${id(77)}','${id(37)}','new','qualified','${id(57)}','Example stale proposal','weak','proposed','${id(2)}','2024-08-01',null,null,null,null,'Example reason'),
 ('${id(78)}','${id(37)}','qualified','outreach_active','${id(57)}','Example earlier move','strong','applied','${id(2)}','2024-07-01',null,null,null,null,'Example reason');
 insert into public.event (id,occurred_at,actor_id,verb,subject_type,subject_id,field,old_value,new_value,cause) values ('${id(90)}','2025-01-01','${id(1)}','example-stage-edit','lead','${id(30)}','stage','{"stage":"qualified"}','{"stage":"engaged"}','human_stated');
 commit;`);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 delete from activity_about where activity_id='${id(55)}'; delete from activity where id='${id(55)}';
 delete from app_user where id='${id(3)}'; commit;`);
});
after(cleanup);

test("copies evidence, pending proposals and creation, approval and undo history without replaying stages", async () => {
	const before = await rows("select * from party_role order by party_id");
	const report = await run();
	assert.deepEqual(
		await rows("select * from party_role order by party_id"),
		before,
	);
	assert.deepEqual(
		(await rows("select id from lead_stage_move order by id")).map((r) => r.id),
		[id(70), id(72), id(73), id(78)],
	);
	assert.deepEqual(
		await rows(
			`select from_stage,to_stage,status,proposed_by_job from proposal where id='${id(71)}'`,
		),
		[
			{
				from_stage: "engaged",
				to_stage: "nurture",
				status: "pending",
				proposed_by_job: "old_system",
			},
		],
	);
	assert.deepEqual(
		(
			await rows(
				`select table_name,action,changed_by_user_id,changed_by_job,changed_at::text from change where record = '{"id":"${id(72)}"}' order by id`,
			)
		).map(Object.values),
		[
			["proposal", "insert", null, "old_system", "2024-03-01 00:00:00+00"],
			["proposal", "update", id(1), null, "2024-03-02 00:00:00+00"],
			["lead_stage_move", "insert", id(1), null, "2024-03-02 00:00:00+00"],
		],
	);
	for (const [n, reason] of [
		[74, "blank_evidence"],
		[74, "blank_reason"],
		[75, "activity_not_copied"],
		[77, "pending_stage_differs"],
		[78, "current_stage_differs"],
		[76, "unknown_actor"],
	] satisfies [number, string][])
		assert.equal(
			report.filter((r) => r.old_id === id(n) && r.reason === reason).length,
			1,
			reason,
		);
	assert.deepEqual(
		(
			await rows(
				`select old_value,new_value->>'status' as new_status,new_value->>'decided_by_user_id' as new_user,new_value->>'decided_at' as new_time from change where table_name='proposal' and record='{"id":"${id(73)}"}' and action='update'`,
			)
		).map(Object.values),
		[
			[
				{ status: "pending", decided_by_user_id: null, decided_at: null },
				"accepted",
				id(1),
				"2024-04-02T00:00:00+00:00",
			],
		],
	);

	assert.equal(
		(
			await rows(
				`select count(*)::int as n from change where table_name='party_role' and changed_at='2024-03-03' and old_value='{"stage":"opportunity"}' and new_value='{"stage":"engaged"}' and changed_by_user_id='${id(1)}'`,
			)
		)[0]?.n,
		1,
	);

	assert.deepEqual(
		await rows(
			"select tgname from pg_trigger where tgrelid in ('next.proposal'::regclass,'next.lead_stage_move'::regclass,'next.change'::regclass) and tgenabled <> 'O'",
		),
		[],
	);
	assert.deepEqual(
		await rows(
			`select old_value->>'stage' as was,new_value->>'stage' as became,changed_by_user_id from change where table_name='party_role' and changed_at='2025-01-01' and record='{"party_id":"${id(10)}","role":"lead"}'`,
		),
		[{ was: "qualified", became: "engaged", changed_by_user_id: id(1) }],
	);

	const snapshot = await rows(
		"select jsonb_agg(c order by id) as history from change c",
	);
	assert.deepEqual(await run(), report);
	assert.deepEqual(
		await rows("select jsonb_agg(c order by id) as history from change c"),
		snapshot,
	);
	await db.query(
		`begin; select set_config('engine.job','old_system',true); insert into activity (id,kind,happened_at) values ('${id(55)}','call','2024-01-01'); insert into activity_about (activity_id,party_id) values ('${id(55)}','${id(15)}'); commit;`,
	);
	await run();
	assert.equal(
		(
			await rows(`select count(*)::int as n from proposal where id='${id(75)}'`)
		)[0]?.n,
		1,
	);
	await db.query(
		`update public.lead_stage_move set evidence_ref='Example conflicting edit' where id='${id(70)}'`,
	);
	const conflicts = await run();
	assert.ok(
		conflicts.some(
			(r) => r.old_id === id(70) && r.reason === "existing_evidence_conflicts",
		),
	);
	assert.equal(
		(
			await rows(
				`select evidence_ref from lead_stage_move where id='${id(70)}'`,
			)
		)[0]?.evidence_ref,
		"Example strong evidence",
	);
	await db.query(
		`update public.lead_stage_move set evidence_ref='Example strong evidence',status='undone',undone_at='2025-02-01',undone_by='${id(1)}' where id='${id(70)}';`,
	);
	await run();
	const undo = `select * from change where table_name='party_role' and record='{"party_id":"${id(10)}","role":"lead"}' and changed_at='2025-02-01'`;
	const history = await rows(undo);
	assert.equal(history.length, 1);
	assert.deepEqual(history[0]?.old_value, { stage: "qualified" });
	assert.deepEqual(history[0]?.new_value, { stage: "new" });
	assert.equal(history[0]?.changed_by_user_id, id(1));
	await db.query(`insert into public.event (id,occurred_at,actor_id,verb,subject_type,subject_id,field,old_value,new_value,cause) values
 ('${id(95)}','2025-02-01','${id(1)}','undo-lead-move','lead','${id(30)}','stage','{"stage":"qualified"}','{"stage":"new","undone_move_id":"${id(70)}"}','human_correction'),
 ('${id(96)}','2025-03-01','${id(1)}','example-edit','lead','${id(30)}','stage','{"stage":"engaged"}','{"stage":"closed_won"}','human_stated'),
 ('${id(97)}','2025-04-01','${id(1)}','example-edit','lead','${id(30)}','stage','{"stage":"closed_won"}','{"stage":"closed_lost"}','human_stated'),
 ('${id(98)}','2025-05-01','${id(1)}','example-edit','lead','${id(30)}','stage','{"stage":"closed_lost"}','{"stage":"nurture_drip"}','human_stated'),
 ('${id(99)}','2025-06-01','${id(1)}','example-edit','lead','${id(30)}','stage','{"stage":"active_deal"}','{"stage":"do_not_contact"}','human_stated');`);
	await run();
	assert.deepEqual(await rows(undo), history);
	assert.deepEqual(
		(
			await rows(
				`select old_value->>'stage' as was,new_value->>'stage' as became from change where table_name='party_role' and changed_at between '2025-03-01' and '2025-06-01' order by changed_at`,
			)
		).map(Object.values),
		[
			["engaged", "opportunity"],
			["opportunity", "nurture"],
			["opportunity", "archived"],
		],
	);
	const final = await rows("select * from change order by id");
	await run();
	assert.deepEqual(await rows("select * from change order by id"), final);
});
