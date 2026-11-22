import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql } from "kysely";
import pg from "pg";
import { nextTransaction } from "./next-connection.ts";
import { copyTest } from "./test-copy.ts";
import worker from "./worker.ts";

const { db, setup, cleanup, connectionString } = copyTest();
const reader = `next_read_${randomUUID().replaceAll("-", "")}`;
const writer = `next_save_${randomUUID().replaceAll("-", "")}`;
const directReader = `next_direct_${randomUUID().replaceAll("-", "")}`;
const person = "00000000-0000-4000-8000-000000000586";
const login = (name: string) => {
	const url = new URL(connectionString);
	url.username = name;
	return url.href;
};

before(async () => {
	await setup();
	await db.query(`create role ${reader} login; grant engine_reader to ${reader};
		create role ${writer} login; grant engine to ${writer};
		create role ${directReader} login;
		grant usage on schema next to ${directReader};
		grant select on next.deal to ${directReader};
		begin; select set_config('engine.user_id', '${person}', true);
		insert into party (id, kind, name) values ('${person}', 'person', 'Example User');
		insert into app_user (id, slug) values ('${person}', 'user-${person}'); commit;`);
});
after(async () => {
	await db.query(
		`drop owned by ${reader}, ${writer}, ${directReader}; drop role ${reader}, ${writer}, ${directReader}`,
	);
	await cleanup();
});

test("new-section reads are typed, read-only UTC snapshots without old-table fallback", async () => {
	await nextTransaction(login(reader), "read", async (tx) => {
		assert.deepEqual(await tx.selectFrom("party").select("name").execute(), [
			{ name: "Example User" },
		]);
		// @ts-expect-error A misspelled column must not compile.
		tx.selectFrom("party").select("misspelled_column");
		// @ts-expect-error Old tables are not part of this database type.
		tx.selectFrom("actor");
		const result =
			await sql`select current_schema() as schema, current_user as role,
			current_setting('TimeZone') as zone,
			current_setting('jit') as jit,
			current_setting('transaction_isolation') as isolation,
			current_setting('transaction_read_only') as read_only`.execute(tx);
		assert.deepEqual(result.rows, [
			{
				schema: "next_partner",
				role: "engine_reader",
				zone: "UTC",
				jit: "off",
				isolation: "repeatable read",
				read_only: "on",
			},
		]);
	});
	await assert.rejects(
		nextTransaction(login(reader), "read", (tx) =>
			sql`set transaction read write`.execute(tx),
		),
		{ code: "25001" },
	);
});

test("new-section saves commit and roll back as one transaction", async () => {
	const rename = (name: string) =>
		nextTransaction(login(writer), "save", async (tx) => {
			assert.deepEqual(
				(await sql`select current_user as role`.execute(tx)).rows,
				[{ role: "engine" }],
			);
			await sql`select set_config('engine.user_id', ${person}, true)`.execute(
				tx,
			);
			await tx
				.updateTable("party")
				.set({ name })
				.where("id", "=", person)
				.execute();
			if (name === "Rollback Example") throw new Error("rollback");
		});
	await rename("Saved Example");
	await assert.rejects(rename("Rollback Example"), /rollback/);
	assert.equal(
		(await db.query("select name from party where id = $1", [person])).rows[0]
			.name,
		"Saved Example",
	);
	await rename("Example User");
});

for (const [name, role] of [
	[reader, "reader"],
	[writer, "writer"],
] as const) {
	test(`the ${role} login cannot escape its schema or change its structure`, async () => {
		const client = new pg.Client({ connectionString: login(name) });
		await client.connect();
		try {
			await client.query("select * from next.deal");
			const denied = [
				"select * from public.deal",
				"insert into public.deal default values",
				"create table next.forbidden (id int)",
				"alter table next.party add column forbidden text",
				"drop table next.party cascade",
				"truncate next.party cascade",
				"insert into next.app_user default values",
				"insert into next.job default values",
				"insert into next.imported_change default values",
				"update next.party set id = gen_random_uuid()",
			];
			if (role === "reader")
				denied.push(
					"insert into next.party default values",
					"update next.party set name = 'Forbidden'",
					"delete from next.party",
					"select next.merge_party(null, null)",
					"set role engine",
				);
			for (const query of denied)
				await assert.rejects(client.query(query), { code: "42501" }, query);
		} finally {
			await client.end();
		}
	});
}

for (const { name, readable, setup, cleanup } of [
	{
		name: "a reader login",
		readable: true,
		setup: async () => login(reader),
	},
	{
		name: "a reader login without table access",
		readable: false,
		setup: async () => {
			await db.query("revoke select on next.deal from engine_reader");
			return login(reader);
		},
		cleanup: async () => {
			await db.query("grant select on next.deal to engine_reader");
		},
	},
	{
		name: "a directly granted login without the reader role",
		readable: false,
		setup: async () => {
			const client = new pg.Client({ connectionString: login(directReader) });
			await client.connect();
			try {
				await client.query("select 1 from next.deal limit 1");
			} finally {
				await client.end();
			}
			return login(directReader);
		},
	},
]) {
	test(`the probe preserves the old fields and reports new-section reachability for ${name}`, async () => {
		try {
			const connectionString = await setup();
			const response = await worker.request(
				"https://app.example.test/api/engine/database",
				{ headers: { Cookie: "__Host-dealroom_session=made-up-session" } },
				{
					DATABASE: { connectionString },
					CARR: {
						fetch: async () =>
							Response.json({
								actor: { slug: "example", display: "Example" },
								csrf_token: "made-up-csrf",
							}),
					},
				},
			);
			assert.equal(response.status, 200);
			assert.equal(
				await response.text(),
				JSON.stringify({
					read_only: true,
					isolation: "repeatable read",
					time_zone: "UTC",
					board_view_readable: false,
					next_section_readable: readable,
				}),
			);
		} finally {
			await cleanup?.();
		}
	});
}

test("a partner read refuses a pre-migration schema even when raw activity is readable", async () => {
	await db.query(`alter schema next_partner rename to before_partner_views;
		grant select on next.activity to engine_reader`);
	try {
		await assert.rejects(
			nextTransaction(login(reader), "read", (tx) =>
				tx.selectFrom("activity").select("summary").execute(),
			),
			/Protected reader schema is unavailable/,
		);
	} finally {
		await db.query(`revoke select on next.activity from engine_reader;
			alter schema before_partner_views rename to next_partner`);
	}
});
