import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-markets.sql");
const { db, setup, cleanup } = copyTest();
const rows = async (sql: string) => (await db.query(sql)).rows;
// A run starts clear of every temp table, so it takes the reviewed counties each time.
const run = async (input = ""): Promise<pg.QueryResultRow[]> => {
	const result = await db.query(`discard temp; ${input} ${copy}`);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'example_user', 'human', 'Example User');
insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User'), ('${id(2)}', 'company', 'Example Vendor');
insert into app_user (id) values ('${id(1)}');
insert into outside_id (source, value, party_id) values ('old_system', '${id(3)}', '${id(2)}');
insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
insert into public.party (id, kind, name, created_by, updated_by) values ('${id(3)}', 'org', 'Example Old Vendor', '${id(1)}', '${id(1)}');
insert into public.vendor_category (slug, label, sort) values ('example', 'Example', 1);
insert into public.vendor_disposition (slug, label, workable, sort) values ('active', 'Example active', true, 1);
insert into public.vendor (id, party_id, category, territory, created_by, updated_by, created_at, updated_at)
values ('${id(4)}', '${id(3)}', 'example', 'Around Example Bay', '${id(1)}', '${id(1)}', '2024-01-01', '2025-01-01');
insert into public.vendor_market (slug, name, kind, boundary, source, reviewed_by, reviewed_at) values
('example-bay', 'Example Bay', 'market', 'A county boundary in words', 'Example review', '${id(1)}', '2025-02-01'),
('example-unknown', 'Example Unknown', 'market', 'Not drawn', 'Example review', '${id(1)}', '2025-02-01'),
('example-region', 'Example Region', 'regional', 'Several areas', 'Example review', '${id(1)}', '2025-02-01');
insert into public.vendor_market_membership (market_slug, vendor_id, office_presence, source, reviewed_by, reviewed_at)
select slug, '${id(4)}', true, 'Example review', '${id(1)}', '2025-03-01' from public.vendor_market;
insert into public.submarket_condition values ('example', 'Example tightness', 0, 'Example note', 1);
commit;`);
});
after(cleanup);
const countyTable =
	"create temp table copy_market_county (market_slug text not null, county_fips text not null) on commit drop;";
const counties = `${countyTable}
insert into copy_market_county values ('example-bay', '01001'), ('example-bay', '01003'), ('example-bay', '01001'), ('missing-slug', '01001');`;

test("reviewed counties copy once, memberships follow merged party ids, and unknown geography is listed", async () => {
	await db.query("begin");
	try {
		const report = await run(counties);
		assert.deepEqual(await rows("select id, name from market"), [
			{ id: "3715b54e-b421-89eb-8c15-5b7642e420a5", name: "Example Bay" },
		]);
		assert.deepEqual(
			await rows("select county_fips from market_county order by county_fips"),
			[{ county_fips: "01001" }, { county_fips: "01003" }],
		);
		assert.deepEqual(
			await rows(
				`select t.name, count(p.id)::int as pieces from territory t left join territory_piece p on p.territory_id = t.id group by t.name order by t.name`,
			),
			[
				{ name: "Around Example Bay", pieces: 0 },
				{ name: "Example Bay", pieces: 1 },
				{ name: "Example Region", pieces: 0 },
			],
		);
		assert.deepEqual(
			await rows(
				"select distinct party_id, started_on, ended_on from party_territory",
			),
			[{ party_id: id(2), started_on: null, ended_on: null }],
		);
		assert.deepEqual(
			await rows(
				"select changed_by_user_id, created_at::text, changed_at::text from market",
			),
			[
				{
					changed_by_user_id: id(1),
					created_at: "2025-02-01 00:00:00+00",
					changed_at: "2025-02-01 00:00:00+00",
				},
			],
		);
		for (const reason of [
			"unknown_market_slug",
			"counties_not_listed",
			"regional_boundary_needs_drawing",
			"text_territory_needs_drawing",
			"not_geography",
			"no_alias_destination",
			"no_typed_destination",
		])
			assert.ok(
				report.some((r) => r.reason === reason),
				reason,
			);
		assert.deepEqual(
			await rows(`select bool_and(p.changed_by_user_id = '${id(1)}'
 and p.changed_at = case when t.name = 'Around Example Bay' then '2025-01-01'::timestamptz else '2025-03-01'::timestamptz end
 and p.created_at = case when t.name = 'Around Example Bay' then '2024-01-01'::timestamptz else '2025-03-01'::timestamptz end) as preserved
from party_territory p join territory t on t.id = p.territory_id`),
			[{ preserved: true }],
		);
	} finally {
		await db.query("rollback");
	}
});

test("without a complete valid county list no market or market piece is invented", async () => {
	for (const input of [
		"",
		`${counties} insert into copy_market_county values ('example-bay', 'bad');`,
	]) {
		await db.query("begin");
		try {
			const report = await run(input);
			assert.deepEqual(await rows("select * from market"), []);
			assert.deepEqual(await rows("select * from territory_piece"), []);
			assert.ok(
				report.some(
					(r) =>
						r.old_id === "example-bay" &&
						r.reason === (input ? "invalid_county" : "counties_not_listed"),
				),
			);
		} finally {
			await db.query("rollback");
		}
	}
});

test("a rerun leaves rows, timestamps and history unchanged", async () => {
	await db.query("begin");
	try {
		await run(counties);
		await db.query(
			"update party_territory set started_on = '2024-06-01'; delete from territory_piece",
		);
		assert.equal(
			(await rows("select count(*)::int as n from market"))[0]?.n,
			1,
		);
		const snapshot = () =>
			rows(`select (select jsonb_agg(m) from market m) as markets,
(select jsonb_agg(c) from market_county c) as counties, (select jsonb_agg(t) from territory t) as territories,
(select jsonb_agg(p) from territory_piece p) as pieces, (select jsonb_agg(p) from party_territory p) as links,
(select jsonb_agg(r) from party_territory_review r) as reviews,
(select count(*)::int from change) as history`);
		const first = await snapshot();
		await run(counties);
		assert.deepEqual(await snapshot(), first);
		const report = await run();
		assert.ok(
			!report.some((r) => r.old_id === "example-bay" && r.field === "boundary"),
		);
		assert.deepEqual(await snapshot(), first);
		assert.ok(
			(
				await run(
					`${countyTable} insert into copy_market_county values ('example-bay', 'bad');`,
				)
			).some(
				(r) =>
					r.old_id === "example-bay" && r.reason === "market_already_copied",
			),
		);
		assert.deepEqual(await snapshot(), first);
	} finally {
		await db.query("rollback");
	}
});

test("name clashes and missing parties are reported without choosing a match", async () => {
	await db.query(`begin;
insert into public.vendor_market (slug, name, kind, boundary, source, reviewed_by, reviewed_at)
values ('example-clash', 'Example Bay', 'market', 'Example boundary', 'Example source', '${id(1)}', '2025-01-01');
select set_config('engine.job', 'old_system', true);
delete from outside_id where source = 'old_system';`);
	try {
		const report = await run(counties);
		assert.ok(
			report.some(
				(r) =>
					r.old_id === "example-bay" && r.reason === "duplicate_market_name",
			),
		);
		assert.ok(
			report.some((r) => r.old_id === id(4) && r.reason === "party_not_copied"),
		);
		assert.deepEqual(await rows("select * from party_territory"), []);
	} finally {
		await db.query("rollback");
	}
});

test("a regional name does not conflict with a named market", async () => {
	await db.query(
		"begin; update public.vendor_market set name = 'Example Bay' where kind = 'regional'",
	);
	try {
		await run(counties);
		assert.deepEqual(await rows("select name from market"), [
			{ name: "Example Bay" },
		]);
	} finally {
		await db.query("rollback");
	}
});

test("membership evidence and attribution match the old review exactly", async () => {
	await db.query(`begin;
update public.vendor_market_membership set office_presence = false,
 service_coverage = E'  Example Bay and nearby\\nBy appointment  ', source = '  Example source  '
where market_slug = 'example-bay';`);
	try {
		const report = await run(counties);
		assert.deepEqual(
			await rows(`select r.has_office, r.coverage, r.source, r.reviewed_by_user_id,
 r.reviewed_by_job, r.reviewed_for_user_id, r.reviewed_at, r.created_at, r.changed_at,
 r.changed_by_user_id, r.changed_by_job, r.changed_for_user_id
from party_territory_review r join party_territory p on p.id = r.party_territory_id
join territory t on t.id = p.territory_id where t.name = 'Example Bay'`),
			await rows(`select v.office_presence as has_office, v.service_coverage as coverage, v.source,
 a.changed_by_user_id as reviewed_by_user_id, a.changed_by_job as reviewed_by_job,
 a.changed_for_user_id as reviewed_for_user_id, v.reviewed_at, v.reviewed_at as created_at,
 v.reviewed_at as changed_at, a.* from public.vendor_market_membership v
cross join lateral copy_attribution('vendor_market_membership', null, v.reviewed_by) a
where v.market_slug = 'example-bay'`),
		);
		assert.ok(!report.some((r) => r.field === "membership_details"));
		assert.ok(
			report.some((r) => r.old_id === "example-bay" && r.field === "source"),
		);
		assert.deepEqual(
			await rows("select count(*)::int as n from territory_piece"),
			[{ n: 1 }],
		);
		assert.deepEqual(
			await rows(`select tgname from pg_trigger
where tgrelid = 'party_territory_review'::regclass and tgenabled <> 'O'`),
			[],
		);
	} finally {
		await db.query("rollback");
	}
});

const mergedVendor = `
insert into public.actor (id, slug, kind, display_name) values ('${id(8)}', 'codex', 'automation', 'Example automation');
insert into public.party (id, kind, name, created_by, updated_by)
values ('${id(5)}', 'org', 'Example duplicate', '${id(1)}', '${id(1)}');
insert into public.vendor (id, party_id, category, created_by, updated_by)
values ('${id(6)}', '${id(5)}', 'example', '${id(1)}', '${id(1)}');
select set_config('engine.job', 'old_system', true);
insert into outside_id (source, value, party_id) values ('old_system', '${id(5)}', '${id(2)}');
insert into public.vendor_market_membership
(market_slug, vendor_id, office_presence, service_coverage, source, reviewed_by, reviewed_at)
values ('example-bay', '${id(6)}', true, null, 'Example review', '${id(8)}', '2024-02-01');`;

test("merged vendors with agreeing evidence keep the latest review at the same vendor rank", async () => {
	await db.query(`begin; ${mergedVendor}`);
	try {
		await run(counties);
		assert.deepEqual(
			await rows(`select count(*)::int as n from party_territory p
join territory t on t.id = p.territory_id where t.name = 'Example Bay'`),
			[{ n: 1 }],
		);
		assert.deepEqual(
			await rows(`select r.has_office, r.coverage, r.source, r.reviewed_by_user_id,
 r.reviewed_by_job, r.reviewed_for_user_id, r.reviewed_at::text, p.started_on
from party_territory_review r join party_territory p on p.id = r.party_territory_id
join territory t on t.id = p.territory_id where t.name = 'Example Bay'`),
			[
				{
					has_office: true,
					coverage: null,
					source: "Example review",
					reviewed_by_user_id: id(1),
					reviewed_by_job: null,
					reviewed_for_user_id: null,
					reviewed_at: "2025-03-01 00:00:00+00",
					started_on: null,
				},
			],
		);
	} finally {
		await db.query("rollback");
	}
});

for (const hidden of ["vendor", "party"] as const) {
	for (const time of ["2024-02-01", "2026-02-01"]) {
		test(`an agreeing review on a merged-away ${hidden} at ${time} follows the visible survivor`, async () => {
			await db.query(`begin; ${mergedVendor}
insert into party (id, kind, name) values ('${id(3)}', 'company', 'Example survivor');
update outside_id set party_id = '${id(3)}' where source = 'old_system';
${hidden === "vendor" ? `update public.vendor set party_id = '${id(3)}' where id = '${id(6)}';` : ""}
update public.${hidden} set merged_into = '${id(hidden === "vendor" ? 4 : 3)}'
where id = '${id(hidden === "vendor" ? 6 : 5)}';
update public.vendor_market_membership set reviewed_at = '${time}' where vendor_id = '${id(6)}';`);
			try {
				const visible =
					await rows(`select m.reviewed_by as reviewed_by_user_id, m.reviewed_at::text
from public.vendor_market_membership m
join public.vendor v on v.id = m.vendor_id and v.merged_into is null
join public.party p on p.id = v.party_id and p.merged_into is null and p.deleted_at is null
where m.market_slug = 'example-bay'`);
				assert.deepEqual(visible, [
					{ reviewed_by_user_id: id(1), reviewed_at: "2025-03-01 00:00:00+00" },
				]);
				await run(counties);
				assert.deepEqual(
					await rows(`select r.reviewed_by_user_id, r.reviewed_at::text
from party_territory_review r join party_territory p on p.id = r.party_territory_id
join territory t on t.id = p.territory_id where t.name = 'Example Bay'`),
					visible,
				);
			} finally {
				await db.query("rollback");
			}
		});
	}
}

test("merged reviews that disagree on office, coverage or source are all listed for correction", async () => {
	for (const evidence of [
		"office_presence = false",
		"service_coverage = null",
		"source = 'Different source'",
	]) {
		await db.query(`begin; ${mergedVendor}
update public.vendor set merged_into = '${id(4)}' where id = '${id(6)}';
update public.vendor_market_membership set service_coverage = 'Example coverage' where market_slug = 'example-bay';
update public.vendor_market_membership set ${evidence} where vendor_id = '${id(6)}';`);
		try {
			const report = await run(counties);
			assert.deepEqual(
				await rows(`select r.* from party_territory_review r
join party_territory p on p.id = r.party_territory_id join territory t on t.id = p.territory_id
where t.name = 'Example Bay'`),
				[],
			);
			assert.deepEqual(
				report.filter((r) => r.reason === "membership_reviews_disagree"),
				await rows(`select vendor_id::text as old_id, 'membership_details' as field,
jsonb_build_object('market', market_slug, 'office_presence', office_presence,
'service_coverage', service_coverage, 'source', source)::text as value,
'membership_reviews_disagree' as reason from public.vendor_market_membership
where market_slug = 'example-bay' order by vendor_id`),
			);
			assert.deepEqual(
				await rows(`select count(*)::int as n from party_territory p
join territory t on t.id = p.territory_id where t.name = 'Example Bay'`),
				[{ n: 1 }],
			);
		} finally {
			await db.query("rollback");
		}
	}
});

test("a membership without old review evidence gets no invented review", async () => {
	await db.query(`begin; delete from public.vendor_market_membership;`);
	try {
		await run(counties);
		assert.deepEqual(
			await rows("select count(*)::int as n from party_territory"),
			[{ n: 1 }],
		);
		assert.deepEqual(await rows("select * from party_territory_review"), []);
	} finally {
		await db.query("rollback");
	}
});

test("correcting conflicting old reviews fills the existing membership even when the earliest reviewer changes", async () => {
	await db.query(`begin; ${mergedVendor}
update public.vendor_market_membership set source = 'Different source' where vendor_id = '${id(6)}';`);
	try {
		await run(counties);
		const membership = await rows(`select p.id from party_territory p
join territory t on t.id = p.territory_id where t.name = 'Example Bay'`);
		await db.query(`update public.vendor_market_membership
set source = 'Example review', reviewed_at = '2026-01-01' where vendor_id = '${id(6)}'`);
		const report = await run(counties);
		assert.ok(!report.some((r) => r.field === "membership_details"));
		assert.deepEqual(
			await rows(`select r.party_territory_id as id from party_territory_review r
join party_territory p on p.id = r.party_territory_id join territory t on t.id = p.territory_id
where t.name = 'Example Bay'`),
			membership,
		);
		assert.deepEqual(
			await rows(`select r.reviewed_by_job, r.reviewed_at::text
from party_territory_review r join party_territory p on p.id = r.party_territory_id
join territory t on t.id = p.territory_id where t.name = 'Example Bay'`),
			[
				{
					reviewed_by_job: "agent",
					reviewed_at: "2026-01-01 00:00:00+00",
				},
			],
		);
	} finally {
		await db.query("rollback");
	}
});
