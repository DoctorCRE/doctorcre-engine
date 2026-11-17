import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const noteId = (n: number) => {
	const hex = createHash("md5")
		.update(`old_system:market_agent_source:${id(n)}`)
		.digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const copy = await readSchema("copy-market-agent-sources.sql");
const { db, setup, cleanup } = copyTest();
const rows = async (sql: string) => (await db.query(sql)).rows;
const run = async (): Promise<
	{ old_id: string; field: string; value: string | null; reason: string }[]
> => {
	const result = await db.query(copy);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const restart =
	"drop table not_copied, old_market_agent_source, examined_market_agent_source;";
const transaction = async (check: () => Promise<void>) => {
	await db.query("begin");
	try {
		await check();
	} finally {
		await db.query("rollback");
	}
};
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into public.actor (id,slug,kind,display_name) values
 ('${id(1)}','partner_one','human','Example User'), ('${id(2)}','codex','automation','Example Job');
 insert into party (id,kind,name) values ('${id(1)}','person','Example User');
 insert into app_user values ('${id(1)}');
 insert into public.contact_state (slug,label,contactable,sort) values ('active','Active',true,1);
 insert into public.party (id,kind,name,created_by,updated_by) values ('${id(3)}','org','Example Company','${id(1)}','${id(1)}');
 insert into public.party (id,kind,name,created_by,updated_by) values ('${id(5)}','person','Example Agent','${id(1)}','${id(1)}');
 insert into public.client (id,party_id,created_by,updated_by) values ('${id(4)}','${id(3)}','${id(1)}','${id(1)}');
 insert into public.deal_type_ref (slug,label,sort) values ('lease','Lease',1);
 insert into public.deal_phase (slug,label) values ('negotiation','Negotiating');
 ${[10, 11, 12, 13, 14]
		.map(
			(n) => `insert into public.deal
 (id,client_id,name,deal_type,phase,owner,created_by,updated_by) values
 ('${id(n)}','${id(4)}','Example deal ${n}','lease','negotiation','partner_one','${id(1)}','${id(1)}');
 insert into public.deal_market_assignment (deal_id,agent_name,agent_party_id,source,set_by,set_at) values
 ('${id(n)}','Example Agent',${n === 10 ? `'${id(5)}'` : "null"},E'  Example source ${n}\\nOriginal spacing  ','${id(n === 10 || n === 12 ? 1 : 2)}','2025-02-01');`,
		)
		.join("\n")}
 insert into deal (id,name,owner_user_id) values ('${id(20)}','Example copied deal','${id(1)}'),
 ('${id(21)}','Example copied deal two','${id(1)}'), ('${id(23)}','Example copied deal three','${id(1)}');
 insert into outside_id (source,value,deal_id) values ('old_system','${id(10)}','${id(20)}'),
 ('old_system','${id(11)}','${id(21)}'), ('old_system','${id(13)}','${id(23)}');
 insert into public.event (subject_type,subject_id,field,verb,actor_id,cause,sponsoring_human_slug,occurred_at) values
 ('deal','${id(11)}','market_agent','set-market-agent','${id(2)}','human_stated','partner_one','2025-02-01'),
 ('deal','${id(11)}','market_agent','set-market-agent','${id(2)}','human_stated',null,'2025-03-01'),
 ('deal','${id(14)}',null,'create-national-market-deal','${id(2)}','human_stated','partner_one','2025-02-01'),
 ('deal','${id(14)}',null,'create-national-market-deal','${id(2)}','human_stated',null,'2025-03-01'),
 ('deal','${id(14)}',null,'create-national-market-deal','${id(1)}','human_stated',null,'2025-02-01');
 update public.deal_market_assignment set source='partner stated in Deal Room' where deal_id='${id(14)}';
 insert into deal (id,name,owner_user_id) values ('${id(24)}','Example created deal','${id(1)}');
 insert into outside_id (source,value,deal_id) values ('old_system','${id(14)}','${id(24)}');
 commit;`);
});
after(cleanup);

test("sources retain exact text, dates and setter independently of agent verification", async () => {
	await transaction(async () => {
		const report = await run();
		assert.deepEqual(
			report.map((r) => [r.old_id, r.field, r.reason]),
			[
				[id(12), "market_agent_source", "deal_not_copied"],
				[id(13), "changed_for_user_id", "agent_user_unknown"],
			],
		);
		assert.deepEqual(
			await rows(`select a.id,a.kind,a.summary,a.happened_at::text,a.changed_at::text,
   a.changed_by_user_id,a.changed_by_job,a.changed_for_user_id,b.deal_id,b.created_at::text
   from activity a join activity_about b on b.activity_id=a.id where b.deal_id <> '${id(24)}' order by b.deal_id`),
			[10, 11, 13].map((n) => ({
				id: noteId(n),
				kind: "note",
				summary: `Market agent source\n\n  Example source ${n}\nOriginal spacing  `,
				happened_at: "2025-02-01 00:00:00+00",
				changed_at: "2025-02-01 00:00:00+00",
				changed_by_user_id: n === 10 ? id(1) : null,
				changed_by_job: n === 10 ? null : "agent",
				changed_for_user_id: n === 11 ? id(1) : null,
				deal_id: id(n + 10),
				created_at: "2025-02-01 00:00:00+00",
			})),
		);
		const changes = await rows("select * from change order by id");
		await db.query(restart);
		assert.deepEqual(await run(), report);
		assert.deepEqual(await rows("select * from change order by id"), changes);
		assert.equal((await rows("select * from party")).length, 1);
		assert.equal((await rows("select * from activity")).length, 4);
	});
});

test("deal creation keeps the sponsor from the matching creator and assignment time", async () => {
	await transaction(async () => {
		const report = await run();
		assert.deepEqual(
			report.filter(
				(r) => r.old_id === id(14) && r.field === "changed_for_user_id",
			),
			[],
		);
		assert.deepEqual(
			await rows(`select a.summary,a.changed_by_job,a.changed_for_user_id,
   b.deal_id,b.changed_by_job as link_job,b.changed_for_user_id as link_sponsor
   from activity a join activity_about b on b.activity_id=a.id where a.id='${noteId(14)}'`),
			[
				{
					summary: "Market agent source\n\npartner stated in Deal Room",
					changed_by_job: "agent",
					changed_for_user_id: id(1),
					deal_id: id(24),
					link_job: "agent",
					link_sponsor: id(1),
				},
			],
		);
	});
});

test("changed sources and edited notes are reported without overwriting", async () => {
	await transaction(async () => {
		await run();
		await db.query(`${restart} select set_config('engine.job','old_system',true);
   update activity set summary='Example edited note' where id='${noteId(10)}';
   update public.deal_market_assignment set source='Example newer source' where deal_id='${id(11)}';`);
		const before = await rows("select * from activity order by id");
		const report = await run();
		assert.deepEqual(
			report
				.filter((r) => r.reason === "existing_note_conflict")
				.map((r) => [r.old_id, r.value]),
			[
				[id(10), "  Example source 10\nOriginal spacing  "],
				[id(11), "Example newer source"],
			],
		);
		assert.deepEqual(await rows("select * from activity order by id"), before);
	});
});

test("an unrelated activity or link holding the fixed id is listed", async () => {
	await transaction(async () => {
		await db.query(`select set_config('engine.job','old_system',true);
   insert into activity (id,kind,happened_at,summary) values ('${noteId(10)}','call','2025-02-01','Example call');`);
		let report = await run();
		assert.equal(
			report.find((r) => r.old_id === id(10))?.reason,
			"existing_note_conflict",
		);
		assert.deepEqual(
			await rows(`select kind,summary from activity where id='${noteId(10)}'`),
			[{ kind: "call", summary: "Example call" }],
		);
		assert.equal(
			(
				await rows(
					`select * from activity_about where activity_id='${noteId(10)}'`,
				)
			).length,
			0,
		);
		await db.query(
			`${restart} update activity_about set deal_id='${id(20)}' where activity_id='${noteId(11)}';`,
		);
		report = await run();
		assert.equal(
			report.find(
				(r) => r.old_id === id(11) && r.field === "market_agent_source",
			)?.reason,
			"existing_note_conflict",
		);
		assert.deepEqual(
			await rows(
				`select deal_id from activity_about where activity_id='${noteId(11)}'`,
			),
			[{ deal_id: id(20) }],
		);
	});
});

test("a missing deal can be copied later and blank source text stays exact", async () => {
	await transaction(async () => {
		await run();
		await db.query(`${restart} select set_config('engine.job','old_system',true);
   insert into outside_id (source,value,deal_id) values ('old_system','${id(12)}','${id(20)}');
   update public.deal_market_assignment set source=E' \t ' where deal_id='${id(12)}';`);
		const report = await run();
		assert.equal(
			report.some(
				(r) => r.old_id === id(12) && r.field === "market_agent_source",
			),
			false,
		);
		assert.deepEqual(
			await rows(
				`select a.summary,b.deal_id from activity a join activity_about b on b.activity_id=a.id where a.id='${noteId(12)}'`,
			),
			[{ summary: "Market agent source\n\n \t ", deal_id: id(20) }],
		);
	});
});
