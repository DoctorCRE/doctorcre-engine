import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
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
	read("copy-change-history.sql"),
]);
const name = `copy_history_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (sql: string) => (await db.query(sql)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	await db.query("begin");
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
const event = async (
	n: number,
	subject: string,
	subjectId: number,
	field: string | null,
	actor = 1,
	sponsor: string | null = null,
) => {
	await db.query(
		`insert into public.event (id, actor_id, verb, subject_type, subject_id, field, old_value, new_value,
 cause, occurred_at, recorded_at, sponsoring_human_slug) values ($1,$2,'example-edit',$3,$4,$5,$6,$7,
 'human_correction','2024-01-01','2024-01-02',$8)`,
		[
			id(n),
			id(actor),
			subject,
			id(subjectId),
			field,
			{ [field ?? "creation"]: "Example old" },
			{ [field ?? "creation"]: null },
			sponsor,
		],
	);
};
const snapshot = () =>
	rows(`select jsonb_agg(x order by x::text) as snapshot from (
 select jsonb_build_object('table',t,'rows',jsonb_agg(v order by v::text)) x from (
 select 'party' t, to_jsonb(p) v from party p union all select 'deal',to_jsonb(d) from deal d
 union all select 'role',to_jsonb(r) from party_role r union all select 'client',to_jsonb(c) from client c
 union all select 'lease',to_jsonb(l) from lease l union all select 'version',to_jsonb(l) from lease_version l
 union all select 'change',to_jsonb(c) from change c) v group by t) s`);

before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 alter table public.event drop constraint event_sponsoring_human_slug_check;
 insert into public.actor (id,slug,kind,display_name) values
 ('${id(1)}','partner_one','human','Example User'), ('${id(2)}','codex','automation','Example Agent'),
 ('${id(3)}','example-system','system','Example System'), ('${id(4)}','partner_two','human','Example Other User'),
 ('${id(5)}','example-mail','automation','Example Mail');
 insert into how_found values ('referral','Referral');
 insert into party (id,kind,name,how_found) values ('${id(1)}','person','Example User',null),
 ('${id(10)}','person','Example Party','referral');
 insert into app_user (id) values ('${id(1)}');
 insert into role (slug,label) values ('lead','Lead'),('client','Client'),('vendor','Vendor');
 insert into stage values ('lead','new','New');
 insert into party_role (party_id,role,stage) values ('${id(10)}','lead','new'),('${id(10)}','client',null),('${id(10)}','vendor',null);
 insert into client (party_id) values ('${id(10)}');
 insert into deal (id,name,owner_user_id) values ('${id(20)}','Example Deal','${id(1)}');
 insert into outside_id (source,value,party_id) select 'old_system',v,'${id(10)}'
 from unnest(array['${id(10)}','${id(11)}','${id(12)}','${id(13)}','${id(14)}']) v;
 insert into outside_id (source,value,deal_id) values ('old_system','${id(20)}','${id(20)}');
 insert into property (id,address) values ('${id(30)}','100 Example Way');
 insert into document (id,name,r2_bucket,r2_key,content_type,sha256,bytes)
 values ('${id(31)}','Example Lease','deal_documents','example.pdf','application/pdf',repeat('a',64),10);
 insert into lease (id,party_id,property_id) values ('${id(40)}','${id(10)}','${id(30)}');
 insert into lease_version (id,lease_id,version,document_id,expiration_on)
 values ('${id(41)}','${id(40)}',1,'${id(31)}','2030-01-01');
 commit;`);
});
beforeEach(async () => {
	await db.query(`begin; select set_config('engine.job','old_system',true); delete from imported_change; delete from public.event;
 delete from outside_id where source = 'old_system' and value = '${id(99)}';
 insert into party_role (party_id,role) values ('${id(10)}','vendor') on conflict do nothing; commit`);
});
const baseline = async () => {
	await event(100, "party", 11, "name");
	await run();
};
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("copies field evidence for every supported record kind without replay or invented snapshots", async () => {
	const cases: [string, number, string, string, object, string][] = [
		["party", 11, "name", "party", { id: id(10) }, "name"],
		["deal", 20, "owner", "deal", { id: id(20) }, "owner_user_id"],
		[
			"lead",
			12,
			"stage",
			"party_role",
			{ party_id: id(10), role: "lead" },
			"stage",
		],
		["client", 13, "status", "client", { party_id: id(10) }, "status"],
		[
			"vendor",
			14,
			"offers",
			"party_role",
			{ party_id: id(10), role: "vendor" },
			"offers",
		],
		[
			"lease",
			41,
			"rate_norm_sf_yr",
			"lease_version",
			{ id: id(41) },
			"rent_per_sf_yr",
		],
	];
	for (const [i, c] of cases.entries())
		await event(
			100 + i,
			c[0],
			c[1],
			c[2],
			i === 2 ? 2 : 1,
			i === 2 ? "partner_one" : null,
		);
	await event(106, "party", 10, "npi", 3);
	await db.query(
		`update public.event set old_value = null, new_value = 'null'::jsonb where id = '${id(106)}'`,
	);
	await event(107, "party", 10, "name", 2);
	await event(108, "party", 10, "name", 5, "partner_one");
	await event(109, "party", 10, "name", 1, "missing");
	await db.query(
		`update public.event set cause = 'ingest_email' where id = '${id(108)}'`,
	);
	const before = await snapshot();
	assert.deepEqual(await run(), [
		{ old_id: id(107), field: "name", reason: "agent_user_unknown" },
	]);
	assert.deepEqual(await snapshot(), before);
	for (const [i, c] of cases.entries()) {
		const [actual] =
			await rows(`select table_name,record,field,source_event = (select to_jsonb(e) from public.event e
   where e.id = i.id) as exact, changed_at::text,changed_by_user_id,changed_by_job,changed_for_user_id
   from imported_change i where id = '${id(100 + i)}'`);
		assert.deepEqual(actual, {
			table_name: c[3],
			record: c[4],
			field: c[5],
			exact: true,
			changed_at: "2024-01-01 00:00:00+00",
			changed_by_user_id: i === 2 ? null : id(1),
			changed_by_job: i === 2 ? "agent" : null,
			changed_for_user_id: i === 2 ? id(1) : null,
		});
	}
	assert.deepEqual(
		(
			await rows(`select changed_by_user_id,changed_by_job,changed_for_user_id from imported_change
  where id in ('${id(106)}','${id(107)}','${id(108)}') order by id`)
		).map(Object.values),
		[
			[null, "old_system", null],
			[null, "agent", null],
			[null, "mail_capture", id(1)],
		],
	);
	assert.deepEqual(
		await rows(
			`select old_value_absent, new_value_absent from imported_change where id = '${id(106)}'`,
		),
		[{ old_value_absent: true, new_value_absent: false }],
	);
	assert.equal(
		(
			await rows(
				`select changed_by_user_id from imported_change where id = '${id(109)}'`,
			)
		)[0].changed_by_user_id,
		id(1),
	);
	const imported = await rows("select * from imported_change order by id");
	await db.query("set time zone 'America/Chicago'");
	assert.deepEqual(await run(), [
		{ old_id: id(107), field: "name", reason: "agent_user_unknown" },
	]);
	await db.query("set time zone 'UTC'");
	assert.deepEqual(
		await rows("select * from imported_change order by id"),
		imported,
	);
	assert.deepEqual(await snapshot(), before);
});

test("copies market and estimate evidence unchanged on rerun", async () => {
	const cases = [
		["deal", 20, "city", "deal", { id: id(20) }, "market_id"],
		[
			"lead",
			12,
			"event_source",
			"party_role",
			{ party_id: id(10), role: "lead" },
			"lease_estimate_source",
		],
		[
			"lead",
			12,
			"event_confidence",
			"party_role",
			{ party_id: id(10), role: "lead" },
			"lease_estimate_confidence",
		],
	] as const;
	for (const [i, [subject, subjectId, field]] of cases.entries())
		await event(150 + i, subject, subjectId, field);
	assert.deepEqual(await run(), []);
	for (const [i, [, , , table, record, field]] of cases.entries()) {
		assert.deepEqual(
			await rows(`select table_name, record, field,
 source_event = (select to_jsonb(e) from public.event e where e.id = i.id) as exact
 from imported_change i where id = '${id(150 + i)}'`),
			[{ table_name: table, record, field, exact: true }],
		);
	}
	const imported = await rows("select * from imported_change order by id");
	assert.deepEqual(await run(), []);
	assert.deepEqual(
		await rows("select * from imported_change order by id"),
		imported,
	);
});

test("lists unsupported shapes, missing records and unresolved actors; retries preserve conflicting imports", async () => {
	await baseline();
	await event(120, "party", 10, "score");
	await event(121, "deal", 20, null);
	await event(122, "party", 99, "name");
	await event(123, "other", 10, "name");
	await event(124, "party", 10, "name", 4);
	await event(125, "party", 10, "name", 2, "partner_two");
	await event(126, "party", 10, "name", 2, "missing");
	// An unknown actor cannot normally pass the old foreign key, but the copy must refuse it if a source is incomplete.
	await db.query(`alter table public.event disable trigger all`);
	await event(127, "party", 10, "name", 99);
	await db.query(`alter table public.event enable trigger all`);
	const before = await rows(
		`select * from imported_change where id = '${id(100)}'`,
	);
	await db.query(
		`update public.event set cause = 'system' where id = '${id(100)}'`,
	);
	const report = await run();
	for (const [n, reason] of [
		[100, "existing_history_conflicts"],
		[120, "field_has_no_mapping"],
		[121, "field_has_no_mapping"],
		[122, "record_not_copied"],
		[123, "field_has_no_mapping"],
		[124, "user_not_copied"],
		[125, "sponsor_not_copied"],
		[126, "unknown_sponsor"],
		[127, "unknown_actor"],
	] as const) {
		assert.ok(
			report.some((r) => r.old_id === id(n) && r.reason === reason),
			`${n} ${reason}`,
		);
	}
	assert.equal(
		(
			await rows(
				`select count(*)::int n from imported_change where id >= '${id(120)}'`,
			)
		)[0].n,
		0,
	);
	assert.deepEqual(
		await rows(`select * from imported_change where id = '${id(100)}'`),
		before,
	);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into outside_id (source,value,party_id) values ('old_system','${id(99)}','${id(10)}'); commit`);
	await run();
	assert.equal(
		(
			await rows(`select record from imported_change where id = '${id(122)}'`)
		)[0].record.id,
		id(10),
	);
});

test("history constraints and privileges hold and a failed load restores its trigger", async () => {
	await baseline();
	assert.deepEqual(
		await rows(`select has_table_privilege('engine','imported_change','SELECT') as read,
 has_table_privilege('engine','imported_change','INSERT') as add,
 has_table_privilege('engine','imported_change','UPDATE') as edit,
 has_table_privilege('engine','imported_change','DELETE') as remove`),
		[{ read: true, add: false, edit: false, remove: false }],
	);
	for (const update of [
		"changed_by_user_id = null, changed_by_job = null",
		"changed_by_job = 'agent'",
		`changed_by_user_id = '${id(99)}'`,
		"record = '{}'",
		"source_event = '{}'",
		"table_name = 'unknown'",
	]) {
		await db.query("begin");
		await assert.rejects(
			db.query(`update imported_change set ${update} where id = '${id(100)}'`),
		);
		await db.query("rollback");
	}
	await db.query("begin");
	await assert.rejects(db.query(`${copy}select 1/0;`));
	await db.query("rollback");
	assert.deepEqual(
		await rows(`select tgenabled from pg_trigger where tgrelid = 'imported_change'::regclass
 and tgname = 'stamp_imported_change'`),
		[{ tgenabled: "O" }],
	);
});

test("an owner erase removes imported words and cannot be undone by a copy or repeated erase", async () => {
	await event(140, "vendor", 14, "offers");
	await event(141, "vendor", 14, "seeking");
	await db.query(`update public.event set human_quote = 'Example private words', agent_rationale = 'Example private reasoning'
 where id in ('${id(140)}','${id(141)}')`);
	await run();
	const before = await rows(
		"select id,changed_at,changed_by_user_id from imported_change order by id",
	);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 delete from party_role where party_id = '${id(10)}' and role = 'vendor';
 select erase_change((select max(id) from change where table_name = 'party_role' and action = 'delete'), array['offers']); commit`);
	assert.deepEqual(
		await rows(`select source_event ? 'old_value' as old,source_event ? 'new_value' as new,
 source_event ? 'human_quote' as quote,source_event ? 'agent_rationale' as rationale from imported_change order by id`),
		[
			{ old: false, new: false, quote: false, rationale: false },
			{ old: true, new: true, quote: false, rationale: false },
		],
	);
	assert.deepEqual(
		await rows(
			"select id,changed_at,changed_by_user_id from imported_change order by id",
		),
		before,
	);
	const erased = await rows("select * from imported_change order by id");
	const history = await rows("select * from change order by id");
	await run();
	await db.query(`begin; select set_config('engine.job','old_system',true);
 select erase_change((select max(id) from change where table_name = 'party_role' and action = 'delete'), array['offers']); commit`);
	assert.deepEqual(
		await rows("select * from imported_change order by id"),
		erased,
	);
	assert.deepEqual(await rows("select * from change order by id"), history);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into party_role (party_id,role) values ('${id(10)}','vendor'); commit`);
	assert.deepEqual(await run(), []);
	assert.deepEqual(
		await rows("select * from imported_change order by id"),
		erased,
	);
});

test("copies Deal Room parking, revival, note and attention evidence without replay", async () => {
	const active = { state: "active", reason: null, note: null };
	const parked = { state: "parked", reason: "client_paused", note: null };
	const noted = { ...parked, note: "Example parking note" };
	const cases = [
		["operating_state", active, parked, "parking_reason"],
		["operating_state", parked, active, "parking_reason"],
		["operating_state", parked, noted, "parking_note"],
		["operating_state", noted, parked, "parking_note"],
		["operating_state", noted, active, "parking_note"],
		["operating_state", active, { ...noted, reason: "other" }, "parking_note"],
		[
			"operating_state",
			parked,
			{ ...parked, reason: "prospect_never_active" },
			"parking_reason",
		],
		["operating_state", noted, { ...noted, reason: "other" }, "parking_note"],
		["attention", false, true, "needs_attention"],
		["attention", true, false, "needs_attention"],
	] satisfies [string, object | boolean, object | boolean, string][];
	for (const [i, [field, oldValue, newValue]] of cases.entries()) {
		await event(200 + i, "deal", 20, field, 2, "partner_one");
		await db.query(
			"update public.event set old_value = $1, new_value = $2 where id = $3",
			[{ [field]: oldValue }, { [field]: newValue }, id(200 + i)],
		);
	}
	const before = await snapshot();
	assert.deepEqual(await run(), []);
	for (const [i, [, , , field]] of cases.entries()) {
		assert.deepEqual(
			await rows(`select table_name, record, field, changed_at::text, changed_by_job, changed_for_user_id,
 changed_by_user_id, old_value_absent, new_value_absent,
 source_event = (select to_jsonb(e) from public.event e where e.id = i.id) as exact
 from imported_change i where id = '${id(200 + i)}'`),
			[
				{
					table_name: "deal",
					record: { id: id(20) },
					field,
					changed_at: "2024-01-01 00:00:00+00",
					changed_by_job: "agent",
					changed_for_user_id: id(1),
					changed_by_user_id: null,
					old_value_absent: false,
					new_value_absent: false,
					exact: true,
				},
			],
		);
	}
	const imported = await rows("select * from imported_change order by id");
	assert.deepEqual(await run(), []);
	assert.deepEqual(
		await rows("select * from imported_change order by id"),
		imported,
	);
	assert.deepEqual(await snapshot(), before);
});

test("lists unknown Deal Room payloads on either side instead of guessing", async () => {
	const active = {
		operating_state: { state: "active", reason: null, note: null },
	};
	const malformed = [
		null,
		"null",
		JSON.stringify("active"),
		JSON.stringify({}),
		JSON.stringify({ operating_state: "parked" }),
		JSON.stringify({
			operating_state: { state: "unknown", reason: null, note: null },
		}),
		JSON.stringify({
			operating_state: { state: "active", reason: "other", note: null },
		}),
		JSON.stringify({
			operating_state: { state: "active", reason: null, note: "Example" },
		}),
		JSON.stringify({
			operating_state: { state: "parked", reason: "unknown", note: null },
		}),
		JSON.stringify({
			operating_state: { state: "parked", reason: "other", note: 3 },
		}),
		JSON.stringify({ operating_state: { state: "parked", reason: "other" } }),
		JSON.stringify({
			operating_state: { ...active.operating_state, extra: true },
		}),
		JSON.stringify({ ...active, extra: true }),
	];
	const cases = [
		...malformed.map((value) => ({
			field: "operating_state",
			valid: JSON.stringify(active),
			value,
		})),
		...[
			null,
			"null",
			"true",
			"{}",
			'{"attention":null}',
			'{"attention":"false"}',
			'{"attention":false,"extra":true}',
		].map((value) => ({
			field: "attention",
			valid: '{"attention":false}',
			value,
		})),
	];
	const expected = [];
	for (const [i, { field, valid, value }] of cases.entries()) {
		for (const side of [0, 1]) {
			const n = 300 + i * 2 + side;
			await event(n, "deal", 20, field);
			await db.query(
				"update public.event set old_value = $1::jsonb, new_value = $2::jsonb where id = $3",
				side === 0 ? [value, valid, id(n)] : [valid, value, id(n)],
			);
			expected.push({ old_id: id(n), field, reason: "payload_shape_unknown" });
		}
	}
	assert.deepEqual(await run(), expected);
	assert.deepEqual(await rows("select id from imported_change"), []);
	assert.deepEqual(await run(), expected);
});
