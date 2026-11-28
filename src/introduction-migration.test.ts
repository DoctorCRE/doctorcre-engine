import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { copyTest, readSchema } from "./test-copy.ts";

const { db, setup, cleanup } = copyTest();
const clientSetup = copyTest();
before(async () => {
	await setup();
	await clientSetup.setup();
});
after(async () => {
	await clientSetup.cleanup();
	await cleanup();
});

test("the introduction migration requires email splits and restores the fresh schema on repeated runs", async () => {
	const catalog = async () =>
		(
			await db.query(`select
		array(select conname || ':' || pg_get_constraintdef(oid) from pg_constraint
			where conname in ('doc_judgment_job_kind_check', 'introduction_email_evidence', 'introduction_source_job_id_fkey')
				and connamespace = 'next'::regnamespace order by conname) as constraints,
		array(select indexdef from pg_indexes where schemaname = 'next'
			and indexname = 'doc_judgment_job_one_introduction') as indexes,
		array(select pg_get_functiondef(oid) || proconfig::text || coalesce(proacl::text, '')
			from pg_proc where pronamespace = 'next'::regnamespace
				and proname in ('queue_introduction', 'keep_recorded_introduction') order by proname) as functions,
		(select to_jsonb(p) from pg_policies p where schemaname = 'next' and policyname = 'confirmed_introduction') as policy,
		array(select pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'introduction'::regclass
			and tgname in ('keep_recorded_introduction', 'dedup_moved_introduction') order by tgname) as triggers,
		pg_get_viewdef('vendor_track_record'::regclass) as track_record`)
		).rows[0];

	const fresh = await catalog();
	assert.ok(fresh?.track_record.includes("introduction.confirmed AND "));
	await db.query(`
		create or replace view vendor_track_record as ${fresh.track_record.replaceAll("introduction.confirmed AND ", "")}
		drop trigger keep_recorded_introduction on introduction;
		drop trigger dedup_moved_introduction on introduction;
		drop policy confirmed_introduction on introduction;
		drop policy remove_recorded_introduction on introduction;
		alter table introduction disable row level security;
		alter table introduction drop column source, drop column source_job_id, drop column confirmed;
		drop index doc_judgment_job_one_introduction;
		drop function keep_recorded_introduction(), queue_introduction(uuid), queue_email_split(uuid);
		alter table doc_judgment_job drop constraint doc_judgment_job_kind_check,
			add constraint doc_judgment_job_kind_check check (kind in ('email_summary', 'email_filing'));`);
	const split = await readSchema("add-email-split-job.sql");
	const introduction = await readSchema("add-introduction-job.sql");
	await assert.rejects(
		db.query(introduction),
		/Install the email split job and its prerequisites/,
	);
	await db.query("rollback");
	await db.query(split);
	await db.query(introduction);
	assert.deepEqual(await catalog(), fresh);
	await db.query(introduction);
	assert.deepEqual(await catalog(), fresh);
});

test("the client introduction migration adds the fresh schema's constraints and removal policy", async () => {
	const { db } = clientSetup;
	const catalog = async () =>
		(
			await db.query(`select
			array(select conname || ':' || pg_get_constraintdef(oid) from pg_constraint
				where conrelid = 'introduction'::regclass order by conname) as constraints,
			(select to_jsonb(p) from pg_policies p where schemaname = 'next'
				and policyname = 'remove_recorded_introduction') as policy`)
		).rows[0];
	const migration = await readSchema("add-client-introduction.sql");
	const fresh = await catalog();
	await db.query(`
		drop policy remove_recorded_introduction on introduction;
		alter table introduction
			drop constraint introduction_maker_is_deal_client,
			drop constraint introduction_client_maker_names_deal,
			drop constraint introduction_made_by_check,
			drop column maker_client_role,
			add constraint introduction_made_by_check check (made_by in ('vendor', 'team'))`);
	await db.query(migration);
	assert.deepEqual(await catalog(), fresh);
});
