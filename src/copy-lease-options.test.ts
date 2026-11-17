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
	read("copy-lease-options.sql"),
]);
const input = `create temp table copy_lease_option (old_id uuid not null, number integer, kind text, notice_on date, terms text) on commit drop;`;
const name = `copy_options_${randomUUID().replaceAll("-", "")}`;
const url = new URL(
	process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1/postgres",
);
url.pathname = `/${name}`;
const db = new pg.Client({
	connectionString: url.href,
	options: "-c search_path=next -c TimeZone=UTC",
});
const rows = async (sql: string) => (await db.query(sql)).rows;
const review = (
	number = "1",
	kind = "'renewal'",
	date = "'2029-06-30'",
	terms = "'Example renewal'",
	old = 10,
) =>
	`insert into copy_lease_option values ('${id(old)}', ${number}, ${kind}, ${date}, ${terms});`;
const run = async (reviews?: string): Promise<pg.QueryResultRow[]> => {
	const result = await db.query(
		`discard temp; ${reviews === undefined ? "" : input + reviews} ${copy}`,
	);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const transaction = async (check: () => Promise<void>) => {
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
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
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User');
 insert into public.lease (id, created_by, created_at, updated_by, updated_at, options_note) values
 ('${id(10)}', '${id(1)}', '2025-01-01', '${id(1)}', '2025-03-01', 'Renew for five years with notice six months before expiry'),
 ('${id(11)}', '${id(1)}', '2025-01-02', null, '2025-03-02', 'Example uncopied lease');
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User');
 insert into app_user values ('${id(1)}');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(1)}', '${id(1)}');
 insert into property (id, address) values ('${id(2)}', '100 Example Way');
 insert into document (id, name, r2_bucket, r2_key, content_type, sha256, bytes)
 values ('${id(3)}', 'Example lease', 'deal_documents', 'example.pdf', 'application/pdf', repeat('a',64), 100);
 insert into lease (id, party_id, property_id) values ('${id(10)}', '${id(1)}', '${id(2)}');
 insert into lease_version (id, lease_id, version, document_id, expiration_on) values
 ('${id(10)}', '${id(10)}', 1, '${id(3)}', '2030-01-01');
 commit;`);
});
after(async () => {
	await db.end();
	await asAdmin(`drop database "${name}" with (force)`);
});

test("without reviewed input the old options refusal repeats and no date is inferred", async () => {
	await transaction(async () => {
		const expected = [
			{
				old_id: id(10),
				field: "options_note",
				value: "Renew for five years with notice six months before expiry",
				reason: "option_terms_unparsed",
			},
		];
		assert.deepEqual(await run(), expected);
		assert.deepEqual(await rows("select * from lease_option"), []);
		assert.deepEqual(await run(), expected);
	});
});

test("all reviewed kinds copy exact notice dates, terms and old attribution, collapsing identical input", async () => {
	await transaction(async () => {
		const reviews =
			review() +
			review() +
			review("2", "'expansion'", "'2030-01-01'") +
			review("32767", "'early_termination'", "'2020-01-01'");
		assert.deepEqual(await run(reviews), []);
		assert.deepEqual(
			(
				await rows(`select number,kind,notice_on::text,terms,created_at::text,changed_at::text,changed_by_user_id,changed_by_job
 from lease_option order by number`)
			).map(Object.values),
			[
				[
					1,
					"renewal",
					"2029-06-30",
					"Example renewal",
					"2025-01-01 00:00:00+00",
					"2025-03-01 00:00:00+00",
					id(1),
					null,
				],
				[
					2,
					"expansion",
					"2030-01-01",
					"Example renewal",
					"2025-01-01 00:00:00+00",
					"2025-03-01 00:00:00+00",
					id(1),
					null,
				],
				[
					32767,
					"early_termination",
					"2020-01-01",
					"Example renewal",
					"2025-01-01 00:00:00+00",
					"2025-03-01 00:00:00+00",
					id(1),
					null,
				],
			],
		);
		const snapshot = () =>
			rows(`select jsonb_build_object('options', (select jsonb_agg(o order by number) from lease_option o),
 'history', (select jsonb_agg(c order by id) from change c)) as snapshot`);
		const original = await snapshot();
		assert.deepEqual(await run(reviews), []);
		assert.deepEqual(await snapshot(), original);
		assert.deepEqual(
			(await run(review("1", "'renewal'", "'2029-07-01'"))).map(
				(r) => r.reason,
			),
			["option_number_taken"],
		);
		assert.deepEqual(await snapshot(), original);
		assert.deepEqual(
			await rows(
				"select tgname from pg_trigger where tgrelid='lease_option'::regclass and tgname='stamp_change' and tgenabled <> 'O'",
			),
			[],
		);
	});
});

for (const [label, reviews, reason] of [
	[
		"missing old lease",
		review("1", "'renewal'", "'2029-06-30'", "'Example'", 99),
		"old_lease_not_found",
	],
	[
		"uncopied version",
		review("1", "'renewal'", "'2029-06-30'", "'Example'", 11),
		"lease_version_not_copied",
	],
	...["null", "0", "-1", "32768"].map((n) => [
		`number ${n}`,
		review(n),
		"option_number_invalid",
	]),
	...["null", "'other'", "' '"].map((k) => [
		`kind ${k}`,
		review("1", k),
		"option_kind_invalid",
	]),
	[
		"missing notice",
		review("1", "'renewal'", "null"),
		"option_notice_required",
	],
	[
		"late notice",
		review("1", "'renewal'", "'2030-01-02'"),
		"option_notice_after_expiration",
	],
	...["null", "''", "E' \\t\\n'"].map((t) => [
		`terms ${t}`,
		review("1", "'renewal'", "'2029-06-30'", t),
		"option_terms_required",
	]),
]) {
	test(`a review with ${label} is listed without aborting valid options`, async () => {
		await transaction(async () => {
			const report = await run(reviews + review("2"));
			assert.equal(report.length, 1);
			assert.equal(report[0]?.reason, reason);
			assert.equal(report[0]?.field, "lease_option");
			assert.deepEqual(await rows("select number from lease_option"), [
				{ number: 2 },
			]);
		});
	});
}

test("conflicting reviews all wait, while a different option copies", async () => {
	await transaction(async () => {
		const report = await run(
			review() + review("1", "'expansion'") + review("2"),
		);
		assert.deepEqual(
			report.map((r) => r.reason),
			["option_reviews_conflict", "option_reviews_conflict"],
		);
		assert.deepEqual(await rows("select number from lease_option"), [
			{ number: 2 },
		]);
	});
});

for (const sponsor of [false, true]) {
	test(`an uncopied ${sponsor ? "sponsor" : "author"} is listed`, async () => {
		await transaction(async () => {
			await db.query(`insert into public.actor (id, slug, kind, display_name) values
 ('${id(4)}', 'partner_two', 'human', 'Example Unmapped'),
 ('${id(5)}', 'codex', 'automation', 'Example Agent');
 update public.lease set updated_by = '${id(sponsor ? 5 : 4)}' where id='${id(10)}';
 insert into public.event (actor_id, verb, subject_type, subject_id, cause, sponsoring_human_slug, occurred_at)
 values ('${id(5)}', 'update-lease', 'lease', '${id(10)}', 'human_stated', 'partner_two', '2025-03-01');`);
			assert.deepEqual(
				(await run(review())).map((r) => r.reason),
				[sponsor ? "option_sponsor_not_copied" : "option_author_not_copied"],
			);
			assert.deepEqual(await rows("select * from lease_option"), []);
		});
	});
}

test("an amendment's review attaches to that version, not the lease's first version", async () => {
	await transaction(async () => {
		await db.query(`insert into public.lease (id, created_by, supersedes_lease_id)
 values ('${id(12)}', '${id(1)}', '${id(10)}');
 insert into lease_version (id, lease_id, version, document_id, expiration_on)
 values ('${id(12)}', '${id(10)}', 2, '${id(3)}', '2032-01-01');`);
		assert.deepEqual(
			await run(
				review() +
					review(
						"1",
						"'expansion'",
						"'2031-01-01'",
						"'Example amendment option'",
						12,
					),
			),
			[],
		);
		assert.deepEqual(
			(
				await rows(
					"select lease_version_id, number, notice_on::text from lease_option order by lease_version_id",
				)
			).map(Object.values),
			[
				[id(10), 1, "2029-06-30"],
				[id(12), 1, "2031-01-01"],
			],
		);
	});
});
