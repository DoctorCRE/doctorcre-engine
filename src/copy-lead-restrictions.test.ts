import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { leadCopyTest } from "./test-lead-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const { db, copy, setup, cleanup } = await leadCopyTest(
	"copy-leads-clients.sql",
);
const rows = async (sql: string) => (await db.query(sql)).rows;
const run = async (input = ""): Promise<pg.QueryResultRow[]> => {
	const result = await db.query(`discard temp;
 create temp table copy_how_found (old_type text, source text, how_found text, primary key (old_type, source)) on commit drop;
 insert into copy_how_found values ('lead','Example referral','referral');
 ${input}; ${copy}`);
	assert.ok(Array.isArray(result));
	const report: pg.QueryResultRow[] = result.at(-1)?.rows ?? [];
	return report.filter((row) => row.field === "do_not_contact");
};
const reviewed = (values: string) =>
	`create temp table copy_lead_restriction (old_id uuid not null, reason text) on commit drop;
 insert into copy_lead_restriction values ${values}`;
const snapshot = () =>
	rows(`select (select jsonb_agg(r order by party_id) from do_not_contact r) as restrictions,
 (select jsonb_agg(c order by id) from change c) as history`);

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into public.actor (id,slug,kind,display_name) values ('${id(1)}','example_user','human','Example User');
 insert into party (id,kind,name) values ('${id(1)}','person','Example User');
 insert into app_user values ('${id(1)}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(1)}','${id(1)}');
 insert into public.lead_stage (slug,label) values ('new','New'),('do_not_contact','Do not contact');
 insert into public.party (id,kind,name,created_by,updated_by)
 values ('${id(10)}','person','Example person','${id(1)}','${id(1)}');
 commit;`);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into public.party (id,kind,name,created_by,updated_by) values ('${id(11)}','person','Example duplicate','${id(1)}','${id(1)}');
 insert into party (id,kind,name) values ('${id(20)}','person','Example survivor');
 insert into outside_id (source,value,party_id) values ('old_system','${id(10)}','${id(20)}'),('old_system','${id(11)}','${id(20)}');
 insert into public.lead (id,party_id,stage,suppressed,source_type,created_by,updated_by,created_at,updated_at) values
 ('${id(30)}','${id(10)}','do_not_contact',true,'Example referral','${id(1)}','${id(1)}','2024-01-01','2025-01-01'),
 ('${id(31)}','${id(11)}','new',true,'Example referral','${id(1)}','${id(1)}','2024-02-01','2025-02-01'),
 ('${id(32)}','${id(10)}','new',false,'Example referral','${id(1)}','${id(1)}','2024-03-01','2025-03-01');
 commit;`);
});
after(cleanup);

test("without reviewed input suppression still waits for reasons", async () => {
	await db.query("begin");
	try {
		const report = await run();
		assert.deepEqual(report.map(Object.values), [
			[id(30), "do_not_contact", "do_not_contact", "restriction_needs_reason"],
			[id(31), "do_not_contact", "new", "restriction_needs_reason"],
		]);
		assert.deepEqual(await rows("select * from do_not_contact"), []);
		assert.deepEqual(await run(), report);
	} finally {
		await db.query("rollback");
	}
});

test("reviewed suppression follows merged parties even after the lead was copied", async () => {
	await db.query("begin");
	try {
		await run();
		const input = reviewed(`('${id(30)}',E' \\tExample request\\n'),
 ('${id(30)}','Example request'), ('${id(31)}','Example request'),
 ('${id(32)}','Ignored unsuppressed lead'), ('${id(99)}','Ignored missing lead')`);
		assert.deepEqual(await run(input), []);
		assert.deepEqual(
			(
				await rows(`select party_id,reason,until_date,created_at::text,changed_at::text,changed_by_user_id
 from do_not_contact`)
			).map(Object.values),
			[
				[
					id(20),
					"Example request",
					null,
					"2025-02-01 00:00:00+00",
					"2025-02-01 00:00:00+00",
					id(1),
				],
			],
		);
		const before = await snapshot();
		assert.deepEqual(await run(input), []);
		assert.deepEqual(await snapshot(), before);
	} finally {
		await db.query("rollback");
	}
});

test("a reviewed restriction copies while the lead source still needs mapping", async () => {
	await db.query("begin");
	try {
		await db.query(
			"update public.lead set source_type = 'Example unknown source'",
		);
		const report = await run(
			reviewed(
				`('${id(30)}','Example request'),('${id(31)}','Example request')`,
			),
		);
		assert.deepEqual(report, []);
		assert.deepEqual(
			(await rows("select party_id,reason from do_not_contact")).map(
				Object.values,
			),
			[[id(20), "Example request"]],
		);
		assert.deepEqual(
			await rows("select * from party_role where role = 'lead'"),
			[],
		);
	} finally {
		await db.query("rollback");
	}
});

for (const [label, values, refusal] of [
	["null", `('${id(30)}',null)`, "restriction_needs_reason"],
	[
		"null beside a valid reason",
		`('${id(30)}',null),('${id(30)}','Example request')`,
		"restriction_needs_reason",
	],
	["blank", `('${id(30)}',E' \\t\\n')`, "restriction_needs_reason"],
	[
		"conflicting lead input",
		`('${id(30)}','Example A'),('${id(30)}','Example B')`,
		"restriction_conflicts",
	],
	[
		"conflicting merged input",
		`('${id(30)}','Example A'),('${id(31)}','Example B')`,
		"restriction_conflicts",
	],
	[
		"ambiguous merged input",
		`('${id(30)}','Example A'),('${id(30)}','Example B'),('${id(31)}','Example A')`,
		"restriction_conflicts",
	],
] as const) {
	test(`${label} stays listed without creating a restriction`, async () => {
		await db.query("begin");
		try {
			const input = reviewed(values);
			const report = await run(input);
			assert.equal(
				report.find((row) => row.old_id === id(30))?.reason,
				refusal,
			);
			assert.deepEqual(await rows("select * from do_not_contact"), []);
			const before = await snapshot();
			assert.deepEqual(await run(input), report);
			assert.deepEqual(await snapshot(), before);
		} finally {
			await db.query("rollback");
		}
	});
}

for (const [reason, end] of [
	["Example existing", "null"],
	["Example reviewed", "'2027-01-01'"],
] as const) {
	test(`existing restriction with reason ${reason} and end ${end} is preserved`, async () => {
		await db.query("begin; select set_config('engine.job','old_system',true)");
		try {
			await db.query(
				`insert into do_not_contact (party_id,reason,until_date) values ('${id(20)}','${reason}',${end})`,
			);
			const input = reviewed(
				`('${id(30)}','Example reviewed'),('${id(31)}','Example reviewed')`,
			);
			const report = await run(input);
			assert.deepEqual(
				report.map((row) => row.reason),
				["restriction_conflicts", "restriction_conflicts"],
			);
			assert.deepEqual(
				(await rows("select reason,until_date::text from do_not_contact")).map(
					Object.values,
				),
				[[reason, end === "null" ? null : "2027-01-01"]],
			);
			const before = await snapshot();
			assert.deepEqual(await run(input), report);
			assert.deepEqual(await snapshot(), before);
		} finally {
			await db.query("rollback");
		}
	});
}
