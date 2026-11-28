import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { main } from "../scripts/queue-introductions.ts";
import { copyTest } from "./test-copy.ts";

const { db, setup, cleanup, connectionString } = copyTest();
const role = `preview_${randomUUID().replaceAll("-", "")}`;
const joe = randomUUID();
const person = randomUUID();
const vendor = randomUUID();
const readUrl = new URL(connectionString);
readUrl.username = role;

before(async () => {
	await setup();
	await db.query(`create role ${role} login bypassrls; grant pg_read_all_data to ${role};
		alter role ${role} set default_transaction_read_only = on;
		grant usage on schema next to ${role};
		revoke execute on function pg_catalog.pg_advisory_xact_lock(bigint),
			pg_catalog.pg_advisory_xact_lock(integer, integer),
			pg_catalog.pg_try_advisory_xact_lock(bigint),
			pg_catalog.pg_try_advisory_xact_lock(integer, integer),
			pg_catalog.pg_advisory_lock(bigint),
			pg_catalog.pg_advisory_lock(integer, integer),
			pg_catalog.pg_try_advisory_lock(bigint),
			pg_catalog.pg_try_advisory_lock(integer, integer) from public;`);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Joe Fixture'), ('${person}', 'person', 'Morgan Fixture'),
			('${vendor}', 'company', 'Fixture Plumbing');
		insert into app_user (id, slug) values ('${joe}', 'joe');
		insert into role (slug, label) values ('vendor', 'Vendor');
		insert into party_role (party_id, role) values ('${vendor}', 'vendor');
		insert into activity (id, kind, happened_at)
			select md5('fixture-' || n)::uuid, 'email', '2026-01-01' from generate_series(1, 208) n;
		insert into activity_about (activity_id, party_id)
			select md5('fixture-' || n)::uuid, '${person}' from generate_series(1, 208) n;
		insert into email (activity_id, message_id, sender, subject, body)
			select md5('fixture-' || n)::uuid, 'fixture-' || n,
				case when n = 208 then 'lead@example.test' else 'sender@example.test' end,
				'Example', case when n = 207 then 'Morgan Fixture' else 'Morgan Fixture meets Fixture Plumbing' end
			from generate_series(1, 208) n;
		insert into email_mailbox (activity_id, user_id)
			select md5('fixture-' || n)::uuid, '${joe}' from generate_series(1, 208) n;
		insert into lead_source_sender (address, name) values ('lead@example.test', 'Fixture source');
		commit;
		begin; select set_config('engine.job', 'mail_capture', true), set_config('engine.user_id', '${joe}', true);
		select queue_introduction(md5('fixture-206')::uuid); commit;`);
});
after(async () => {
	await db.query(`drop owned by ${role}; drop role ${role}`);
	await cleanup();
});

const run = (url: string, ...args: string[]) =>
	spawnSync(process.execPath, ["scripts/queue-introductions.ts", ...args], {
		env: { ...process.env, DATABASE_URL: url },
		encoding: "utf8",
	});

test("read-only preview counts three pages and apply queues each eligible email once", async () => {
	assert.equal(typeof main, "function");
	const privileges = await db.query(
		"select has_function_privilege($1, 'pg_catalog.pg_advisory_xact_lock(bigint)', 'execute') as can_lock",
		[role],
	);
	assert.equal(privileges.rows[0].can_lock, false);
	const preview = run(readUrl.href, "--dry-run");
	assert.equal(preview.status, 0, preview.stderr);
	assert.equal(
		preview.stdout,
		"eligible,queued,already_queued\n206,205,1\ndry_run\n",
	);
	assert.equal(
		(
			await db.query(
				"select count(*)::int as n from doc_judgment_job where kind = 'introduction'",
			)
		).rows[0].n,
		1,
	);
	const apply = run(connectionString);
	assert.equal(apply.status, 0, apply.stderr);
	assert.equal(
		apply.stdout,
		"eligible,queued,already_queued\n206,205,1\napplied\n",
	);
	const again = run(connectionString);
	assert.equal(again.status, 0, again.stderr);
	assert.equal(
		again.stdout,
		"eligible,queued,already_queued\n206,0,206\napplied\n",
	);
	assert.equal(
		(
			await db.query(
				"select count(*)::int as n from doc_judgment_job where kind = 'introduction'",
			)
		).rows[0].n,
		206,
	);
	await db.query(
		"begin; select set_config('engine.job', 'old_system', true); delete from email_mailbox; drop function queue_introduction(uuid); commit",
	);
	const result = run(connectionString);
	assert.equal(result.status, 1);
	assert.equal(
		result.stderr,
		"Install schema/add-introduction-job.sql first.\n",
	);
});
