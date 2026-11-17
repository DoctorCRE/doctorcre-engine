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
	read("copy-national-account-owners.sql"),
]);
const name = `copy_account_owners_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (sql: string) => (await db.query(sql)).rows;
const owner = (
	account: number,
	actor = 1,
) => `insert into public.national_account_owner
 (account_client_id,owner_actor_id,set_by,set_at) values ('${id(account)}','${id(actor)}','${id(1)}','2025-06-01');`;
const date = (account: number, start = "2024-03-01") =>
	`insert into copy_account_owner_date values ('${id(account)}','${start}');`;
const restart =
	"drop table not_copied,old_account_owner,examined_account_owner;";
const run = async (): Promise<
	{ old_id: string; field: string; value: string | null; reason: string }[]
> => {
	const result = await db.query(copy);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const transaction = async (setup: string, check: () => Promise<void>) => {
	await db.query(`begin; select set_config('engine.job','old_system',true);
 create temp table copy_account_owner_date (account_client_id uuid primary key, started_on date not null) on commit drop;
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
 insert into public.actor (id,slug,kind,display_name) values
 ('${id(1)}','partner_one','human','Example Human'),
 ('${id(2)}','example_automation','automation','Example Automation'),
 ('${id(3)}','example_system','system','Example System'),
 ('${id(4)}','example_unmapped','human','Example Unmapped'),
 ('${id(5)}','example_company','human','Example Company');
 insert into party (id,kind,name) values ('${id(1)}','person','Example Human');
 insert into app_user values ('${id(1)}');
 insert into outside_id (source,value,party_id) values ('old_system','${id(1)}','${id(1)}');
 insert into public.contact_state (slug,label,contactable,sort) values ('active','Example active',true,1);
 insert into public.client_type (slug,label) values ('national_account','Example account');
 insert into public.client_status (slug,label) values ('roster','Example roster');
 insert into role (slug,label) values ('national_account','National account');
 ${Array.from({ length: 9 }, (_, i) => {
		const n = i + 10;
		return `insert into public.party (id,kind,name,created_by,updated_by) values ('${id(n)}','org','Example account ${n}','${id(1)}','${id(1)}');
  insert into public.client (id,party_id,status,client_type,created_by,updated_by) values ('${id(n + 30)}','${id(n)}','roster','national_account','${id(1)}','${id(1)}');
  insert into party (id,kind,name) values ('${id(n)}','company','Example account ${n}');
  insert into party_role (party_id,role) values ('${id(n)}','national_account');
  insert into national_account (party_id) values ('${id(n)}');
  insert into outside_id (source,value,party_id) values ('old_system','${id(n + 30)}','${id(n)}');`;
 }).join("\n")}
 insert into outside_id (source,value,party_id) values ('old_system','${id(5)}','${id(10)}');
 commit;`);
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("a reviewed first date copies the human owner's person and preserves the setter and storage time", async () => {
	await transaction(owner(40) + date(40), async () => {
		assert.deepEqual(await run(), []);
		assert.deepEqual(
			await rows(`select account_id,owner_id,started_on::text,ended_on,created_at::text,
   changed_at::text,changed_by_user_id,changed_by_job from national_account_owner`),
			[
				{
					account_id: id(10),
					owner_id: id(1),
					started_on: "2024-03-01",
					ended_on: null,
					created_at: "2025-06-01 00:00:00+00",
					changed_at: "2025-06-01 00:00:00+00",
					changed_by_user_id: id(1),
					changed_by_job: null,
				},
			],
		);
		assert.deepEqual(
			await rows(`select tgname from pg_trigger where tgrelid = 'national_account_owner'::regclass
   and tgname = 'stamp_change' and tgenabled <> 'O'`),
			[],
		);
	});
});

test("an absent reviewed date is listed on each run and can be supplied later", async () => {
	await transaction(owner(40), async () => {
		const expected = [
			{
				old_id: id(40),
				field: "started_on",
				value: null,
				reason: "owner_start_date_required",
			},
		];
		assert.deepEqual(await run(), expected);
		assert.deepEqual(await rows("select * from national_account_owner"), []);
		await db.query(restart);
		assert.deepEqual(await run(), expected);
		await db.query(restart + date(40));
		assert.deepEqual(await run(), []);
		assert.equal(
			(await rows("select * from national_account_owner")).length,
			1,
		);
	});
});

test("automation, system, unmapped humans and company mappings cannot become owners", async () => {
	await transaction(
		[2, 3, 4, 5]
			.map((actor, i) => owner(40 + i, actor) + date(40 + i))
			.join("\n"),
		async () => {
			assert.deepEqual(
				(await run()).map((r) => [r.old_id, r.reason]),
				[
					[id(40), "owner_not_human"],
					[id(41), "owner_not_human"],
					[id(42), "owner_person_not_copied"],
					[id(43), "owner_person_not_copied"],
				],
			);
			assert.deepEqual(await rows("select * from national_account_owner"), []);
		},
	);
});

test("account mappings follow the client import identity and missing accounts stay listed", async () => {
	await transaction(
		`${owner(40) + date(40)}delete from outside_id where value='${id(40)}';`,
		async () => {
			assert.equal((await run())[0]?.reason, "account_not_copied");
			assert.deepEqual(await rows("select * from national_account_owner"), []);
		},
	);
});

test("all incoming overlaps on one mapped account wait, while unrelated ownership copies", async () => {
	await transaction(
		owner(40) +
			date(40) +
			owner(41) +
			date(41, "2025-01-01") +
			owner(42) +
			date(42) +
			`update outside_id set party_id='${id(10)}' where value='${id(41)}';`,
		async () => {
			assert.deepEqual(
				(await run()).map((r) => [r.old_id, r.reason]),
				[
					[id(40), "owner_dates_overlap"],
					[id(41), "owner_dates_overlap"],
				],
			);
			assert.deepEqual(
				await rows("select account_id from national_account_owner"),
				[{ account_id: id(12) }],
			);
		},
	);
});

test("existing overlapping dates are listed and touching dates are allowed", async () => {
	await transaction(
		owner(40) +
			date(40) +
			owner(41) +
			date(41) +
			`insert into national_account_owner (account_id,owner_id,started_on,ended_on) values
 ('${id(10)}','${id(1)}','2023-01-01','2024-04-01'),
 ('${id(11)}','${id(1)}','2023-01-01','2024-03-01');`,
		async () => {
			assert.deepEqual(
				(await run()).map((r) => [r.old_id, r.reason]),
				[[id(40), "owner_dates_overlap"]],
			);
			assert.equal(
				(await rows("select * from national_account_owner")).length,
				3,
			);
		},
	);
});

test("reruns preserve accepted rows, stamps and change history even if reviewed input changes", async () => {
	await transaction(owner(40) + date(40), async () => {
		await run();
		const snapshot = () =>
			rows(`select jsonb_build_object('owners', (select jsonb_agg(o order by id) from national_account_owner o),
   'history',(select jsonb_agg(c order by id) from change c)) as snapshot`);
		const original = await snapshot();
		await db.query(
			`${restart}update copy_account_owner_date set started_on='2020-01-01';`,
		);
		assert.deepEqual(await run(), []);
		assert.deepEqual(await snapshot(), original);
	});
});

test("a human owner's mapped person is used even when its id differs from the actor", async () => {
	await transaction(
		`${owner(40)}${date(40)}
 insert into party (id,kind,name) values ('${id(6)}','person','Example mapped person');
 update outside_id set party_id='${id(6)}' where value='${id(1)}';`,
		async () => {
			assert.deepEqual(await run(), []);
			assert.deepEqual(
				await rows("select owner_id from national_account_owner"),
				[{ owner_id: id(6) }],
			);
		},
	);
});

test("an agent setter keeps the sponsor from the client's account_owner event", async () => {
	await transaction(
		`${owner(40)}${date(40)}
 insert into public.actor (id,slug,kind,display_name) values ('${id(7)}','codex','automation','Example agent');
 update public.national_account_owner set set_by='${id(7)}';
 insert into public.event (id,actor_id,verb,subject_type,subject_id,field,new_value,cause,occurred_at,sponsoring_human_slug) values
 ('${id(70)}','${id(7)}','set-account-owner','client','${id(40)}','account_owner','{}','human_stated','2025-06-01','partner_one'),
 ('${id(71)}','${id(7)}','update-client','client','${id(40)}','notes','{}','human_stated','2025-07-01',null);`,
		async () => {
			assert.deepEqual(await run(), []);
			assert.deepEqual(
				await rows(
					"select changed_by_user_id,changed_by_job,changed_for_user_id from national_account_owner",
				),
				[
					{
						changed_by_user_id: null,
						changed_by_job: "agent",
						changed_for_user_id: id(1),
					},
				],
			);
		},
	);
});
