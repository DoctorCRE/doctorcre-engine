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
	read("copy-client-brands.sql"),
]);
const name = `copy_client_brands_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (sql: string) => (await db.query(sql)).rows;
// Old company n is a client location whose old client is n + 30; company 10 is a brand and 9 a person.
const brand = (location: number, org = 10) =>
	`update public.party set org_id = '${id(org)}' where id = '${id(location)}';`;
const date = (location: number, start = "2024-03-01") =>
	`insert into copy_client_brand_date values ('${id(location + 30)}','${start}');`;
const restart = "drop table not_copied,old_brand,examined_brand;";
const run = async (): Promise<
	{ old_id: string; field: string; value: string | null; reason: string }[]
> => {
	const result = await db.query(copy);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const reasons = async () => (await run()).map((r) => [r.old_id, r.reason]);
const transaction = async (setup: string, check: () => Promise<void>) => {
	await db.query(`begin; select set_config('engine.job','old_system',true);
 create temp table copy_client_brand_date (location_client_id uuid primary key, started_on date not null) on commit drop;
 ${setup}`);
	try {
		await check();
	} finally {
		await db.query("rollback");
	}
};
before(async () => {
	assert.ok(process.env.TEST_SNAPSHOT, "Run npm run check");
	await asAdmin(
		`create database "${name}" template "${process.env.TEST_SNAPSHOT}"`,
	);
	await db.connect();
	await db.query(`create schema next; ${schema}; ${attribution}`);
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into public.actor (id,slug,kind,display_name) values ('${id(1)}','partner_one','human','Example Human');
 insert into party (id,kind,name) values ('${id(1)}','person','Example Human');
 insert into app_user values ('${id(1)}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(1)}','${id(1)}');
 insert into public.contact_state (slug,label,contactable,sort) values ('active','Example active',true,1);
 insert into public.client_type (slug,label) values ('franchise','Example franchise');
 insert into public.client_status (slug,label) values ('roster','Example roster');
 insert into role (slug,label) values ('client','Client');
 insert into how_found (slug,label) values ('referral','Referral');
 insert into public.party (id,kind,name,created_by,updated_by) values
  ('${id(9)}','person','Example Person','${id(1)}','${id(1)}'),
  ('${id(10)}','org','Example Brand','${id(1)}','${id(1)}');
 insert into party (id,kind,name) values ('${id(9)}','person','Example Person'), ('${id(10)}','company','Example Brand');
 insert into outside_id (source,value,party_id) values ('old_system','${id(9)}','${id(9)}'), ('old_system','${id(10)}','${id(10)}');
 ${[11, 12, 13, 14, 20]
		.map((n) => {
			const kind = n === 20 ? "person" : "company";
			return `insert into public.party (id,kind,name,created_by,updated_by,created_at) values
  ('${id(n)}','${n === 20 ? "person" : "org"}','Example ${n}','${id(1)}','${id(1)}','2023-05-01');
 insert into public.client (id,party_id,status,client_type,created_by,updated_by) values
  ('${id(n + 30)}','${id(n)}','roster','franchise','${id(1)}','${id(1)}');
 insert into party (id,kind,name,how_found) values ('${id(n)}','${kind}','Example ${n}','referral');
 insert into party_role (party_id,role) values ('${id(n)}','client');
 insert into client (party_id) values ('${id(n)}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(n)}','${id(n)}'), ('old_system','${id(n + 30)}','${id(n)}');`;
		})
		.join("\n")}
 insert into party_company (person_id,company_id) values ('${id(20)}','${id(10)}');
 commit;`);
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("a reviewed first date copies the location's brand with its setter and storage time", async () => {
	await transaction(brand(11) + date(11), async () => {
		assert.deepEqual(await run(), []);
		assert.deepEqual(
			await rows(`select location_id,brand_id,started_on::text,ended_on,created_at::text,
   changed_at::text,changed_by_user_id,changed_by_job from client_brand`),
			[
				{
					location_id: id(11),
					brand_id: id(10),
					started_on: "2024-03-01",
					ended_on: null,
					created_at: "2023-05-01 00:00:00+00",
					changed_at: "2023-05-01 00:00:00+00",
					changed_by_user_id: id(1),
					changed_by_job: null,
				},
			],
		);
		assert.deepEqual(
			await rows(`select tgname from pg_trigger where tgrelid = 'client_brand'::regclass
   and tgname = 'stamp_change' and tgenabled <> 'O'`),
			[],
		);
	});
});

test("an absent reviewed date is listed on each run and can be supplied later", async () => {
	await transaction(brand(11), async () => {
		const expected = [
			{
				old_id: id(41),
				field: "started_on",
				value: null,
				reason: "brand_start_date_required",
			},
		];
		assert.deepEqual(await run(), expected);
		assert.deepEqual(await rows("select * from client_brand"), []);
		await db.query(restart);
		assert.deepEqual(await run(), expected);
		await db.query(restart + date(11));
		assert.deepEqual(await run(), []);
		assert.equal((await rows("select * from client_brand")).length, 1);
	});
});

test("a location pointing at itself, a person brand and uncopied records are listed, not forced", async () => {
	await transaction(
		`${brand(11, 11) + date(11) + brand(12, 9) + date(12) + brand(13) + date(13) + brand(14) + date(14)}
 delete from outside_id where value = '${id(43)}';
 update outside_id set party_id = '${id(14)}' where value = '${id(10)}';`,
		async () => {
			assert.deepEqual(await run(), [
				{
					old_id: id(41),
					field: "org_id",
					value: id(11),
					reason: "brand_is_location",
				},
				{
					old_id: id(42),
					field: "org_id",
					value: id(9),
					reason: "brand_not_company",
				},
				{
					old_id: id(43),
					field: "party_id",
					value: id(13),
					reason: "location_not_copied",
				},
				{
					old_id: id(44),
					field: "org_id",
					value: id(10),
					reason: "brand_is_location",
				},
			]);
			assert.deepEqual(await rows("select * from client_brand"), []);
		},
	);
});

test("a brand that was never copied waits listed", async () => {
	await transaction(
		`${brand(11) + date(11)} delete from outside_id where value = '${id(10)}';`,
		async () => {
			assert.deepEqual(await reasons(), [[id(41), "brand_not_copied"]]);
		},
	);
});

test("all incoming memberships of one location wait, while unrelated locations copy", async () => {
	await transaction(
		`${brand(11) + date(11) + brand(12) + date(12, "2025-01-01") + brand(13) + date(13)}
 update outside_id set party_id = '${id(11)}' where value = '${id(42)}';`,
		async () => {
			assert.deepEqual(await run(), [
				{
					old_id: id(41),
					field: "started_on",
					value: "2024-03-01",
					reason: "brand_dates_overlap",
				},
				{
					old_id: id(42),
					field: "started_on",
					value: "2025-01-01",
					reason: "brand_dates_overlap",
				},
			]);
			assert.deepEqual(await rows("select location_id from client_brand"), [
				{ location_id: id(13) },
			]);
		},
	);
});

test("an existing overlapping membership is listed and a touching one is allowed", async () => {
	await transaction(
		`${brand(11) + date(11) + brand(12) + date(12)}
 insert into client_brand (location_id,brand_id,started_on,ended_on) values
 ('${id(11)}','${id(10)}','2023-01-01','2024-04-01'),
 ('${id(12)}','${id(10)}','2023-01-01','2024-03-01');`,
		async () => {
			assert.deepEqual(await reasons(), [[id(41), "brand_dates_overlap"]]);
			assert.equal((await rows("select * from client_brand")).length, 3);
		},
	);
});

test("a person's org_id stays their company and makes no brand", async () => {
	await transaction(`${brand(20)}${date(20)}`, async () => {
		const companies = await rows("select * from party_company");
		assert.deepEqual(await run(), []);
		assert.deepEqual(await rows("select * from client_brand"), []);
		assert.deepEqual(await rows("select * from party_company"), companies);
	});
});

test("reruns preserve accepted rows, stamps and change history even if reviewed input changes", async () => {
	await transaction(brand(11) + date(11), async () => {
		await run();
		const snapshot = () =>
			rows(`select jsonb_build_object('brands', (select jsonb_agg(b order by id) from client_brand b),
   'history', (select jsonb_agg(c order by id) from change c)) as snapshot`);
		const original = await snapshot();
		await db.query(
			`${restart}update copy_client_brand_date set started_on = '2020-01-01';`,
		);
		assert.deepEqual(await run(), []);
		assert.deepEqual(await snapshot(), original);
	});
});

for (const event of [
	{ shape: "its org_id change", field: "'org_id'", created_by: 1 },
	{ shape: "the company's creation", field: "null", created_by: 7 },
]) {
	test(`an agent's membership keeps the sponsor from ${event.shape}`, async () => {
		await transaction(
			`${brand(11)}${date(11)}
 insert into public.actor (id,slug,kind,display_name) values ('${id(7)}','codex','automation','Example agent');
 update public.party set created_by = '${id(event.created_by)}' where id = '${id(11)}';
 insert into public.event (id,actor_id,verb,subject_type,subject_id,field,new_value,cause,occurred_at,sponsoring_human_slug) values
 ('${id(70)}','${id(7)}','update-party','party','${id(11)}',${event.field},'{}','human_stated','2025-06-01','partner_one'),
 ('${id(71)}','${id(7)}','update-party','party','${id(11)}',null,'{}','human_stated','2025-07-01',null);`,
			async () => {
				assert.deepEqual(await run(), []);
				assert.deepEqual(
					await rows(
						"select created_at::text,changed_by_user_id,changed_by_job,changed_for_user_id from client_brand",
					),
					[
						{
							created_at:
								event.field === "null"
									? "2023-05-01 00:00:00+00"
									: "2025-06-01 00:00:00+00",
							changed_by_user_id: null,
							changed_by_job: "agent",
							changed_for_user_id: id(1),
						},
					],
				);
			},
		);
	});
}
