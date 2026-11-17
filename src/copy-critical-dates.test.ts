import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { copyTest, readSchema } from "./test-copy.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copy = await readSchema("copy-critical-dates.sql");
const { db, setup, cleanup } = copyTest();
const rows = async (text: string) => (await db.query(text)).rows;
const run = async (): Promise<pg.QueryResultRow[]> => {
	const result = await db.query(copy);
	assert.ok(Array.isArray(result));
	return result.at(-1)?.rows ?? [];
};
const reasons = (report: pg.QueryResultRow[], n: number) =>
	report.filter((r) => r.old_id === id(n)).map((r) => r.reason);
// Actor 1 is a partner and actor 2 an agent.
const date = (n: number, actor: number, kind: string, status: string) =>
	`('${id(n)}', '${id(n === 306 ? 12 : 10)}', '${kind}', '2026-03-01', 'Example note ${n}', 'Example source', '${status}', '2025-01-01', '${id(actor)}', '2025-02-01')`;
const resolved = (n: number, actor: number, status: string) =>
	`('deal', '${id(10)}', 'status', '{"critical_date_id": "${id(n)}", "status": "${status}", "reason": "Example reason ${n}"}', '2025-03-0${n % 10}', '${id(actor)}', 'resolve-critical-date', 'human_stated')`;
let report: pg.QueryResultRow[];
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into party (id, kind, name) values ('${id(1)}', 'person', 'Example User');
 insert into app_user values ('${id(1)}');
 insert into outside_id (source, value, party_id) values ('old_system', '${id(1)}', '${id(1)}');
 insert into deal (id, name, owner_user_id) values ('${id(10)}', 'Example deal', '${id(1)}');
 insert into public.actor (id, slug, kind, display_name) values ('${id(1)}', 'partner_one', 'human', 'Example User'),
 ('${id(2)}', 'claude', 'automation', 'Example Agent');
 insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
 insert into public.party (id, kind, name, created_by, updated_by) values ('${id(6)}', 'org', 'Example Client', '${id(1)}', '${id(1)}');
 insert into public.client (id, party_id, created_by, updated_by) values ('${id(3)}', '${id(6)}', '${id(1)}', '${id(1)}');
 insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1);
 insert into public.deal_phase (slug, label) values ('closed', 'Example closed');
 insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by) select v, '${id(3)}', 'Example deal', 'lease', 'closed', 'partner_one', '${id(1)}', '${id(1)}'
 from unnest(array['${id(10)}'::uuid, '${id(12)}'::uuid]) v;
 insert into public.critical_date (id, deal_id, kind, due_on, note, source, status, created_at, created_by, updated_at) values
 ${[
		date(300, 1, "option_window", "open"),
		date(301, 2, "attorney_review", "open"),
		date(302, 1, "lease_end", "cleared"),
		date(303, 1, "lease_end", "done"),
		date(304, 2, "lease_end", "passed"),
		date(305, 1, "lease_end", "dropped"),
		date(306, 1, "lease_end", "open"),
		date(307, 1, "lease_end", "open"),
		date(308, 2, "loi_expiry", "dropped"),
		date(309, 1, "lease_end", "dropped"),
 ].join(", ")};
 update public.critical_date set source = ' ' where id = '${id(307)}';
 insert into public.event (subject_type, subject_id, field, new_value, occurred_at, actor_id, verb, cause) values
 ${[resolved(302, 1, "cleared"), resolved(304, 1, "passed"), resolved(305, 2, "dropped"), resolved(308, 1, "dropped"), resolved(309, 1, "dropped")].join(", ")};
 update public.event set new_value = jsonb_set(new_value, '{reason}', to_jsonb(E'\\t\\n'::text)) where new_value ->> 'critical_date_id' = '${id(309)}';
 commit;`);
	await db.query("begin");
	report = await run();
	await db.query("commit");
});
after(cleanup);

test("a partner's date stays confirmed by them, and an agent's date waits for a user", async () => {
	// biome-ignore format: one row per copied date
	assert.deepEqual((await rows(`select id, kind, status, note, confirmed_by_user_id, confirmed_at::text, changed_at::text from critical_date where id in ('${id(300)}', '${id(301)}') order by id`)).map(Object.values), [
 [id(300), "option_notice", "open", "Example note 300", id(1), "2025-01-01 00:00:00+00", "2025-02-01 00:00:00+00"],
 [id(301), "other", "proposed", "Kind: attorney_review\nExample note 301", null, null, "2025-02-01 00:00:00+00"],
 ]);
	await db.query(
		`begin; select set_config('engine.user_id', '${id(1)}', true); update critical_date set status = 'open' where id = '${id(301)}'`,
	);
	assert.equal(
		(
			await rows(
				`select confirmed_by_user_id from critical_date where id = '${id(301)}'`,
			)
		)[0]?.confirmed_by_user_id,
		id(1),
	);
	await db.query("rollback");
});

test("resolved dates keep their user, time and reason from the event log, and cleared becomes done", async () => {
	// biome-ignore format: one row per copied date
	assert.deepEqual((await rows(`select id, status, confirmed_by_user_id, resolved_by_user_id, resolved_at::text, resolution_reason from critical_date where id in ('${id(302)}', '${id(308)}') order by id`)).map(Object.values), [
 [id(302), "done", id(1), id(1), "2025-03-02 00:00:00+00", "Example reason 302"],
 [id(308), "dropped", null, id(1), "2025-03-08 00:00:00+00", "Example reason 308"],
 ]);
});

test("dates without a deal, source or decision evidence are listed, never invented", async () => {
	assert.deepEqual(reasons(report, 303), ["resolution_without_evidence"]);
	assert.deepEqual(reasons(report, 304), ["confirmation_without_evidence"]);
	assert.deepEqual(reasons(report, 305), ["resolved_by_a_job"]);
	assert.deepEqual(reasons(report, 306), ["deal_not_copied"]);
	assert.deepEqual(reasons(report, 307), ["no_source"]);
	assert.deepEqual(reasons(report, 309), ["resolution_without_evidence"]);
	assert.deepEqual(
		await rows(
			`select id from critical_date where id in ('${id(303)}', '${id(304)}', '${id(305)}', '${id(306)}', '${id(307)}', '${id(309)}')`,
		),
		[],
	);
});

test("a repeat changes nothing", async () => {
	const snapshot = async () => [
		await rows("select * from critical_date order by id"),
		await rows("select * from change order by id"),
	];
	const before = await snapshot();
	await db.query("begin");
	const again = await run();
	await db.query("commit");
	assert.deepEqual(await snapshot(), before);
	assert.deepEqual(reasons(again, 303), ["resolution_without_evidence"]);
	assert.deepEqual(
		again.filter((r) => r.reason === "id_taken"),
		[],
	);
});
