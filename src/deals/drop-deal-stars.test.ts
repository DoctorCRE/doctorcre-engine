import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { copyTest, readSchema } from "../test-copy.ts";

test("dropping deal stars upgrades an existing schema and preserves its history", async (t) => {
	const { db, setup, cleanup } = copyTest();
	await setup();
	t.after(cleanup);
	await db.query(await readSchema("add-deal-stars.sql"));

	const partner = randomUUID();
	const first = randomUUID();
	const second = randomUUID();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into party (id, kind, name) values ('${partner}', 'person', 'Example Partner');
		insert into app_user (id, slug) values ('${partner}', 'example-partner');
		insert into deal (id, name, owner_user_id) values
			('${first}', 'Example First Deal', '${partner}'),
			('${second}', 'Example Second Deal', '${partner}');
		commit;
		begin; set local role engine; set local engine.user_id = '${partner}';
		insert into deal_star (user_id, deal_id) values ('${partner}', '${first}'), ('${partner}', '${second}');
		commit;`);

	const starTable = await db.query<{ oid: number }>(
		"select 'next.deal_star'::regclass::oid as oid",
	);
	const oid = starTable.rows[0]?.oid;
	assert.ok(oid);
	const catalog = () =>
		db.query(
			`select to_regclass('next.deal_star')::oid as table_oid,
				exists (select from pg_class where oid = $1) as has_original_table,
				exists (select from pg_depend where refclassid = 'pg_class'::regclass and refobjid = $1) as has_dependents`,
			[oid],
		);
	assert.deepEqual((await catalog()).rows, [
		{ table_oid: oid, has_original_table: true, has_dependents: true },
	]);

	const history = () =>
		db.query<{
			action: string;
			record: { user_id: string; deal_id: string };
			changed_by_user_id: string;
		}>(
			"select * from change where table_name = 'deal_star' order by record ->> 'deal_id', id",
		);
	const before = (await history()).rows;
	assert.deepEqual(
		before.map(({ action, record, changed_by_user_id }) => ({
			action,
			record,
			changed_by_user_id,
		})),
		[first, second].sort().map((deal_id) => ({
			action: "insert",
			record: { user_id: partner, deal_id },
			changed_by_user_id: partner,
		})),
	);

	const migration = await readSchema("drop-deal-stars.sql");
	for (const attempt of ["first apply", "second apply"]) {
		await db.query(migration);
		assert.deepEqual(
			(await catalog()).rows,
			[{ table_oid: null, has_original_table: false, has_dependents: false }],
			attempt,
		);
		assert.deepEqual((await history()).rows, before, attempt);
	}
});
