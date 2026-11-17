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
const copy = await sql("copy-space-needs.sql");
const name = `copy_needs_${randomUUID().replaceAll("-", "")}`;
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
const search = (n: number, spec: object, deal = id(10)) =>
	db.query(
		`insert into public.space_search (id, client_id, deal_id, spec, created_by, created_at) values ($1,$2,$3,$4,$5,'2025-01-01')`,
		[id(n), id(3), deal, JSON.stringify(spec), id(1)],
	);
const saved = (n: number, criteria: object, status = "saved") =>
	db.query(
		`insert into ops.deal_space_search (id, organization_tenant_id, deal_id, name, criteria, requirements, status, updated_at) values ($1,'example-tenant',$2,'Example search',$3,'Near transit',$4,'2025-02-01')`,
		[id(n), id(10), JSON.stringify(criteria), status],
	);
before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into party (id,kind,name) values ('${id(1)}','person','Example User'), ('${id(2)}','company','Example Vendor');
 insert into app_user values ('${id(1)}');
 insert into role (slug,label) values ('vendor','Vendor');
 insert into party_role (party_id,role) values ('${id(2)}','vendor');
 insert into outside_id (source,value,party_id) values ('old_system','${id(6)}','${id(2)}');
 insert into deal (id,name,owner_user_id) values ('${id(11)}','Example deal','${id(1)}');
 insert into outside_id (source,value,deal_id) values ('old_system','${id(10)}','${id(11)}');
 insert into market (id,name) values ('${id(20)}','Example Market');
 insert into market_county (market_id,county_fips) values ('${id(20)}','99001'), ('${id(20)}','99003');
 insert into public.actor (id,slug,kind,display_name) values ('${id(1)}','partner_one','human','Example User');
 insert into public.contact_state (slug,label,contactable,sort) values ('active','Example active',true,1);
 insert into public.party (id,kind,name,created_by,updated_by) values ('${id(6)}','org','Example Vendor','${id(1)}','${id(1)}');
 insert into public.client (id,party_id,created_by,updated_by) values ('${id(3)}','${id(6)}','${id(1)}','${id(1)}');
 insert into public.vendor_disposition (slug,label,sort,workable) values ('active','Active',1,true);
 insert into public.vendor (id,party_id,category,created_by,updated_by) values ('${id(7)}','${id(6)}','Example category','${id(1)}','${id(1)}');
 insert into public.deal_type_ref (slug,label,sort) values ('lease','Example lease',1);
 insert into public.deal_phase (slug,label) values ('closed','Example closed');
 insert into public.deal (id,client_id,name,deal_type,phase,created_by,updated_by) values ('${id(10)}','${id(3)}','Example deal','lease','closed','${id(1)}','${id(1)}');
 insert into public.deal_client_need (id,deal_id,vendor_id,description,applicability,source_ref,source_revision,observed_at,fresh_until,restriction,withdrawn,revision,approved_revision,approved_client_id,approved_by,approved_at,created_by,updated_by,updated_at) select v, '${id(10)}','${id(7)}','Example requirement','For this location','Example source','v1','2025-01-01','2099-01-01','allowed',false,1,1,'${id(3)}','${id(1)}','2025-01-02','${id(1)}','${id(1)}','2025-02-01'
 from unnest(array['${id(300)}'::uuid,'${id(301)}'::uuid,'${id(302)}'::uuid,'${id(303)}'::uuid,'${id(304)}'::uuid]) v;
 update public.deal_client_need set approved_revision = null, approved_client_id = null, approved_by = null, approved_at = null where id = '${id(301)}';
 update public.deal_client_need set fresh_until = '2025-02-01' where id = '${id(302)}';
 update public.deal_client_need set restriction = 'restricted' where id = '${id(303)}';
 update public.deal_client_need set withdrawn = true where id = '${id(304)}';
 update public.deal_client_need set approved_revision=revision,approved_client_id='${id(3)}',approved_by='${id(1)}',approved_at='2025-01-02' where id in ('${id(302)}','${id(303)}','${id(304)}');
 commit;`);
	// biome-ignore format: the complete old filter is one fixture
	await search(100,{min_sf:1000,max_sf:2000,max_rate_sf_yr:0,sub_types:["office"],cities:[],states:[],statuses:["available"]});
	await search(101, { max_sf: 3000, cities: null, states: [] });
	await search(102, { sub_types: ["office", "retail"] });
	await search(103, { mystery: { keep: "this" } });
	await search(104, { cities: ["Example City"], states: ["ZZ"] });
	await search(105, { cities: ["Example City"] });
	await search(106, { min_sf: 2000, max_sf: 1000 });
	await search(107, { min_sf: "invalid" });
	await db.query(
		`update public.space_search set deal_id = null where id = '${id(107)}'`,
	);
	// biome-ignore format: the complete archived filter is one fixture
	await saved(200,{counties:["Example County"],property_types:["office"],min_square_feet:1200},"archived");
	await saved(201, { query: "near hospital" });
	await saved(202, { entrance_verified: true });
	await saved(203, {}, "draft");
	await db.query("begin");
	await db.query(`create temp table copy_space_need_county (source_table text, old_id uuid, county_fips text) on commit drop;
 insert into copy_space_need_county values ('space_search','${id(101)}','99001'),('space_search','${id(101)}','99003'),('ops.deal_space_search','${id(200)}','99001'),('ops.deal_space_search','${id(200)}','99003'),('space_search','${id(104)}','99001');`);
	report = await run();
	await db.query("commit");
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});
test("searches keep bounds, unspecified filters and source authors; archived needs survive", async () => {
	// biome-ignore format: one row per source search
	assert.deepEqual((await rows("select id,deal_id,name,min_sf,max_sf,max_rate_sf_yr,space_type,market_id,must_haves from space_need where id < '00000000-0000-4000-8000-000000000300' order by id")).map(Object.values), [
 [id(100),id(11),"Space need","1000.0","2000.0","0.00","office",null,null],
 [id(101),id(11),"Space need",null,"3000.0",null,null,null,null],
 [id(200),id(11),"Example search","1200.0",null,null,"office",id(20),"Near transit"]]);
	assert.deepEqual(
		await rows(
			`select created_at::text,changed_by_user_id from space_need where id='${id(100)}'`,
		),
		[{ created_at: "2025-01-01 00:00:00+00", changed_by_user_id: id(1) }],
	);
});
test("incomplete searches wait whole, preserving unknown values in the report", () => {
	// biome-ignore format: source ids and exact refusal reasons
	for (const [n, expected] of [[102,["incomplete_search","types_need_correction"]],[103,["unknown_key","incomplete_search"]],[104,["geography_needs_correction"]],[105,["geography_needs_correction"]],[106,["reversed_size"]],[107,["invalid_number","deal_unassigned"]],[201,["requirement_needs_review","incomplete_search"]],[202,["requirement_needs_review","incomplete_search"]],[203,["draft_needs_confirmation"]]] satisfies [number,string[]][])
 assert.deepEqual(reasons(report,n).sort(),expected.sort());
	assert.ok(
		report.some(
			(r) =>
				r.old_id === id(103) &&
				r.field === "mystery" &&
				r.value === '{"keep": "this"}',
		),
	);
});
test("only confirmed current allowed needs copy, with vendor provenance and approval history", async () => {
	// biome-ignore format: one row per source and approval event
	assert.deepEqual((await rows(`select vendor_id,source_ref,source_revision,applicability,must_haves from space_need where id='${id(300)}'`)).map(Object.values), [[id(2),"Example source","v1","For this location","Example requirement"]]);
	// biome-ignore format: chronological history must also have increasing history ids
	assert.deepEqual((await rows(`select action,changed_by_user_id,changed_at::text from change where table_name='space_need' and record->>'id'='${id(300)}' order by id`)).map(Object.values), [["insert",id(1),"2025-01-01 00:00:00+00"],["update",id(1),"2025-01-02 00:00:00+00"]]);
	assert.equal(
		(await rows("select count(*)::int as count from space_need"))[0]?.count,
		4,
	);
	for (const [i, reason] of [
		"pending_confirmation",
		"stale_requirement",
		"restricted_requirement",
		"withdrawn_requirement",
	].entries())
		assert.deepEqual(reasons(report, 301 + i), [reason]);
});
test("reruns leave needs and their history unchanged", async () => {
	const snapshot = async () => [
		await rows("select * from space_need order by id"),
		await rows("select * from change order by id"),
	];
	const before = await snapshot();
	await db.query("begin");
	await run();
	await db.query("commit");
	assert.deepEqual(await snapshot(), before);
});
test("invalid numbers, shapes and ambiguous markets are listed without aborting", async () => {
	await db.query("begin; select set_config('engine.job','old_system',true)");
	try {
		for (const [i, spec] of [
			{ min_sf: -1 },
			{ min_sf: 1000.06 },
			{ min_sf: 0.01 },
			{ cities: "Example City" },
			{ max_rate_sf_yr: 1e12 },
			{ min_sf: 0 },
			{ min_sf: 1e12 },
			{ min_sf: "NaN" },
			{ sub_types: "office" },
			{ max_rate_sf_yr: -1 },
		].entries())
			await search(400 + i, spec);
		await db.query(
			`insert into market (id,name) values ('${id(21)}','Another Example Market'); insert into market_county (market_id,county_fips) values ('${id(21)}','99001'), ('${id(21)}','99003');`,
		);
		await saved(410, { counties: ["Example County"] });
		await db.query(
			`create temp table copy_space_need_county (source_table text,old_id uuid,county_fips text) on commit drop; insert into copy_space_need_county values ('ops.deal_space_search','${id(410)}','99001'),('ops.deal_space_search','${id(410)}','99003');`,
		);
		const result = await run();
		for (let n = 400; n < 410; n++)
			assert.ok(
				reasons(result, n).includes(
					n === 403
						? "geography_filter_invalid"
						: n === 408
							? "types_need_correction"
							: "invalid_number",
				),
			);
		assert.deepEqual(reasons(result, 410), ["geography_needs_correction"]);
		assert.deepEqual(
			await rows(`select id from space_need where id >= '${id(400)}'`),
			[],
		);
	} finally {
		await db.query("rollback");
	}
});

test("unmapped vendors, approval conflicts, blank text and source collisions wait; reviewed search geography copies", async () => {
	await db.query("begin; select set_config('engine.job','old_system',true)");
	try {
		await db.query(`insert into public.actor (id,slug,kind,display_name) values ('${id(5)}','codex','automation','Example Agent');
 insert into public.party (id,kind,name,created_by,updated_by) values ('${id(9)}','org','Other Example','${id(1)}','${id(1)}');
 insert into public.client (id,party_id,created_by,updated_by) values ('${id(4)}','${id(9)}','${id(1)}','${id(1)}');
 insert into public.vendor (id,party_id,category,created_by,updated_by) values ('${id(8)}','${id(9)}','Example','${id(1)}','${id(1)}');`);
		// biome-ignore format: one corrected source field and exact refusal per case
		const cases = [{vendor_id:id(8)},{approved_client_id:id(4)},{approved_by:id(5)},{description:"\n"},{source_ref:"\t"},{source_revision:"\n"},{applicability:"\t"}];
		for (const [i, patch] of cases.entries())
			await db.query(
				`insert into public.deal_client_need select (jsonb_populate_record(null::public.deal_client_need,to_jsonb(n)||$1::jsonb)).* from public.deal_client_need n where id=$2`,
				[JSON.stringify({ ...patch, id: id(500 + i) }), id(300)],
			);
		await saved(507, {});
		await db.query(
			`update ops.deal_space_search set name=' ' where id='${id(507)}'`,
		);
		await saved(508, {});
		await search(508, {});
		await search(509, { cities: ["Example City"], states: ["ZZ"] });
		await db.query(
			`create temp table copy_space_need_county (source_table text,old_id uuid,county_fips text) on commit drop; insert into copy_space_need_county values ('space_search','${id(509)}','99001'),('space_search','${id(509)}','99003');`,
		);
		const result = await run();
		for (const [i, reason] of [
			"vendor_not_copied",
			"approval_client_differs",
			"approval_needs_user",
		].entries())
			assert.deepEqual(reasons(result, 500 + i), [reason]);
		for (let n = 503; n <= 507; n++)
			assert.ok(reasons(result, n).includes("blank_text"));
		assert.deepEqual(reasons(result, 508), [
			"source_id_collision",
			"source_id_collision",
		]);
		assert.deepEqual(
			await rows(
				`select id,market_id from space_need where id >= '${id(500)}'`,
			),
			[{ id: id(509), market_id: id(20) }],
		);
	} finally {
		await db.query("rollback");
	}
});
