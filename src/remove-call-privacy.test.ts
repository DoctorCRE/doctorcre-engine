import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const migrated = copyTest();
const fresh = copyTest();
const joe = randomUUID();
const deal = randomUUID();
const call = randomUUID();
const step = randomUUID();
const quote = "Example quote from the call";

// The call read shape a database had before both partners saw every call:
// the base's call_visible_to, then the old migrations, replayed unchanged.
const OLD_CALL_VISIBLE_TO = `
create function call_visible_to(
	changed_by_user_id uuid, changed_by_job text, changed_for_user_id uuid,
	viewer_id uuid default nullif(current_setting('engine.user_id', true), '')::uuid
) returns boolean
language sql immutable set search_path = next, pg_temp as $$
	select coalesce(viewer_id in (changed_by_user_id, changed_for_user_id)
		or (changed_by_job = 'old_system' and changed_by_user_id is null and changed_for_user_id is null), false);
$$;
revoke execute on function call_visible_to(uuid, text, uuid, uuid) from public;
grant execute on function call_visible_to(uuid, text, uuid, uuid) to engine, engine_reader;
`;

before(async () => {
	await Promise.all([migrated.setup(), fresh.setup()]);
	const { db } = migrated;
	// Production added these columns after every other, so the replay does too.
	await db.query(`
		drop schema next_partner cascade;
		drop trigger zz_keep_call_recorder on activity;
		drop function keep_call_recorder();
		alter table activity drop column call_owner_user_id;
		${OLD_CALL_VISIBLE_TO}
	`);
	for (const file of [
		"add-call-read-policies.sql",
		"restore-partner-change-index.sql",
		"restore-partner-phase-change-filter.sql",
	])
		await db.query(await readSchema(file));
	await db.query(`
		set local engine.job = 'old_system';
		insert into party (id, kind, name) values ('${joe}', 'person', 'Example One');
		insert into app_user (id, slug) values ('${joe}', 'joe');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Lease', '${joe}');
		set local engine.job = ''; set local engine.user_id = '${joe}';
		insert into activity (id, kind, happened_at, summary) values ('${call}', 'call', '2025-01-02', 'Example call');
		insert into activity_about (activity_id, deal_id) values ('${call}', '${deal}');
		insert into next_step (id, deal_id, owner_party_id, what, due_on, call_activity_id, call_evidence_quote)
			values ('${step}', '${deal}', '${joe}', 'Example step', '2025-01-03', '${call}', '${quote}');
	`);
});
after(() => Promise.all([migrated.cleanup(), fresh.cleanup()]));

const stepQuote = async (db: pg.Client) => {
	const { rows } = await db.query<{ type: string | null; quote: string }>(
		`select jsonb_typeof(new_value -> 'call_evidence_quote') as type,
			new_value ->> 'call_evidence_quote' as quote
		from change where table_name = 'next_step' and record = jsonb_build_object('id', $1::uuid)
			and action = 'insert'`,
		[step],
	);
	return rows;
};

const columns = async (db: pg.Client, table: string) => {
	const { rows } = await db.query<{ name: string; type: string }>(
		`select attname as name, format_type(atttypid, atttypmod) as type from pg_attribute
		where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum`,
		[table],
	);
	return rows;
};

async function catalog(db: pg.Client) {
	const read = async (query: string) => (await db.query(query)).rows;
	return {
		functions: await read(`
			select p.proname, pg_get_function_identity_arguments(p.oid) as args,
				pg_get_functiondef(p.oid) as definition, p.proacl::text as acl
			from pg_proc p where p.pronamespace in ('next'::regnamespace, 'next_partner'::regnamespace)
				and p.prokind in ('f', 'p')
			order by 1, 2`),
		triggers: await read(`
			select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
			where c.relnamespace = 'next'::regnamespace and not t.tgisinternal order by 1, 2`),
		activity: await columns(db, "next.activity"),
		constraints: await read(`
			select conname, pg_get_constraintdef(oid) as definition from pg_constraint
			where conrelid = 'next.activity'::regclass order by 1`),
		views: await read(`
			select relname, pg_get_viewdef(oid) as definition, relacl::text as acl from pg_class
			where relnamespace = 'next_partner'::regnamespace order by 1`),
		tables: await read(`
			select relname, relacl::text as acl from pg_class
			where relnamespace = 'next'::regnamespace and relkind in ('r', 'v') order by 1`),
	};
}

test("removing call privacy puts audit text back and matches a fresh build", async () => {
	const { db } = migrated;
	assert.deepEqual(
		(
			await db.query(
				"select e.new_value from call_audit_evidence e join change c on c.id = e.change_id where c.table_name = 'next_step'",
			)
		).rows,
		[{ new_value: quote }],
	);
	assert.deepEqual(await stepQuote(db), [{ type: "null", quote: null }]);
	assert.ok(
		(await columns(db, "next.activity")).some(
			({ name }) => name === "call_shared",
		),
	);

	const migration = await readSchema("remove-call-privacy.sql");
	await db.query(migration);
	await db.query(migration);

	assert.deepEqual(await stepQuote(db), [{ type: "string", quote }]);
	assert.deepEqual(
		(await db.query("select to_regclass('next.call_audit_evidence') as table"))
			.rows,
		[{ table: null }],
	);
	const activity = await columns(db, "next.activity");
	assert.ok(!activity.some(({ name }) => name === "call_shared"));
	assert.deepEqual(await columns(db, "next_partner.activity"), activity);
	assert.deepEqual(
		(
			await db.query(
				"select call_owner_user_id as owner from activity where id = $1",
				[call],
			)
		).rows,
		[{ owner: joe }],
	);
	assert.deepEqual(await catalog(db), await catalog(fresh.db));
});
