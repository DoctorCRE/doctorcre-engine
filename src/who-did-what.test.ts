import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request } = doorTest();
const alex = randomUUID();
const blair = randomUUID();
const deal = randomUUID();
const step = randomUUID();
const imported = randomUUID();
// Old history a copy rerun brings in after an engine save, dated between engine saves.
const rerun = randomUUID();
const ignored = randomUUID();
const automated = randomUUID();
const joe = { user: "joe" };
const dell = { user: "dell" };
const as = (user: string, statement: string) =>
	db.query(
		`select set_config('engine.user_id', '${user}', true); ${statement}`,
	);

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${alex}', 'person', 'Alex Example'), ('${blair}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${alex}', '${joe.user}'), ('${blair}', '${dell.user}');
		insert into phase values ('loi', 'LOI');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Dental', '${alex}');
		set local role none;
		alter table imported_change disable trigger stamp_imported_change;
		insert into imported_change (id, table_name, record, old_value_absent, new_value_absent, field, source_event, changed_by_user_id, changed_at)
		select id, 'deal', '{"id":"${deal}"}', false, false, field,
			jsonb_build_object('id', id, 'verb', 'update-deal', 'cause', 'human_stated', 'actor_id', 'example'),
			'${blair}', '2001-01-01T15:00Z'
		from (values ('${imported}'::uuid, 'owner_user_id'), ('${ignored}'::uuid, 'salesforce_id')) v(id, field);
		insert into imported_change (id, table_name, record, old_value_absent, new_value_absent, field, source_event, changed_by_job, changed_at)
		values ('${automated}', 'deal', '{"id":"${deal}"}', false, false, 'owner_user_id',
			jsonb_build_object('id', '${automated}'::uuid, 'verb', 'set-lead', 'cause', 'automation_job', 'actor_id', 'example'),
			'old_system', '2001-01-02T15:00Z');
		alter table imported_change enable trigger stamp_imported_change;
		commit;`);
	await as(alex, `update deal set closed_value = 1200000 where id = '${deal}'`);
	await db.query(`begin; set local role none;
		alter table imported_change disable trigger stamp_imported_change;
		insert into imported_change (id, table_name, record, old_value_absent, new_value_absent, field, source_event, changed_by_user_id, changed_at)
		values ('${rerun}', 'deal', '{"id":"${deal}"}', false, false, 'needs_attention',
			jsonb_build_object('id', '${rerun}'::uuid, 'verb', 'update-deal', 'cause', 'human_stated', 'actor_id', 'example'),
			'${alex}', clock_timestamp());
		alter table imported_change enable trigger stamp_imported_change;
		commit;`);
	await as(
		alex,
		`insert into next_step (id, what, deal_id) values ('${step}', 'Call the landlord', '${deal}')`,
	);
	await as(
		alex,
		`insert into deal_phase_change (deal_id, happened_at, phase) values ('${deal}', now(), 'loi')`,
	);
	await as(
		blair,
		`update next_step set hold_until = '2001-03-01' where id = '${step}'`,
	);
	await as(
		blair,
		`update next_step set resolution = 'done', done_at = now() where id = '${step}'`,
	);
	await as(
		blair,
		`insert into user_preference (user_id, time_zone) values ('${blair}', 'America/Chicago')`,
	);
	await as(
		alex,
		`insert into next_step (what, deal_id, resolution, done_at)
			select 'Example step ' || n, '${deal}', 'done', now() from generate_series(1, 55) n`,
	);
});
after(cleanup);

type Change = Record<string, unknown>;

async function page(caller: typeof joe, before?: string) {
	const query =
		before === undefined ? "" : `?before=${encodeURIComponent(before)}`;
	const response = await request(caller, `updates/changes${query}`, {
		method: "GET",
	});
	assert.equal(response.status, 200);
	const body: unknown = await response.json();
	assert.ok(isArguments(body) && Array.isArray(body.changes));
	const next = body.next_before;
	assert.ok(next === null || typeof next === "string");
	return { changes: body.changes.filter(isArguments), next };
}

async function everything(caller: typeof joe) {
	const pages: Change[][] = [];
	let next: string | null | undefined;
	do {
		const read = await page(caller, next ?? undefined);
		pages.push(read.changes);
		next = read.next;
	} while (next);
	return pages;
}

test("Who did what pages newest first through native and imported history", async () => {
	const pages = await everything(joe);
	assert.deepEqual(
		pages.map((p) => p.length),
		[50, 11],
	);
	const all = pages.flat();
	assert.equal(new Set(all.map((c) => c.id)).size, all.length);
	const times = all.map((c) => Date.parse(String(c.changed_at)));
	assert.deepEqual(
		times,
		[...times].sort((a, b) => b - a),
	);
	assert.equal(all.at(-1)?.id, `imported:${imported}`);
	const at = (what: unknown) => all.findIndex((c) => c.what === what);
	const between = at("changed the deal's attention flag");
	assert.ok(at("added a next step: Call the landlord") < between);
	assert.ok(between < at("set the deal value to $1,200,000"));
});

test("Each change says who changed which record, what changed, and where to open it", async () => {
	const all = (await everything(joe)).flat();
	const said = (what: string) => all.find((c) => c.what === what);
	assert.partialDeepStrictEqual(said("set the deal value to $1,200,000"), {
		who: "Alex Example",
		record: "Example Dental",
		open_url: `/deals?deal=${deal}`,
	});
	assert.partialDeepStrictEqual(said("added a next step: Call the landlord"), {
		who: "Alex Example",
		open_url: `/deals?deal=${deal}&focus=next-step&step=${step}`,
	});
	assert.partialDeepStrictEqual(
		said("finished the next step: Call the landlord"),
		{ who: "Blair Example" },
	);
	assert.partialDeepStrictEqual(said("moved the deal to LOI"), {
		who: "Alex Example",
	});
	assert.partialDeepStrictEqual(said("changed the deal owner"), {
		id: `imported:${imported}`,
		who: "Blair Example",
		record: "Example Dental",
		changed_at: "2001-01-01T15:00:00.000Z",
	});
});

test("Copies, the old system's own automations, internal fields and a partner's private settings stay out, for either partner", async () => {
	const seen = async (caller: typeof joe) =>
		(await everything(caller)).flat().map((c) => c.what);
	const forJoe = await seen(joe);
	assert.equal(forJoe.length, 61);
	assert.ok(!forJoe.includes("opened the deal"));
	const ids = (await everything(joe)).flat().map((c) => c.id);
	assert.ok(!ids.includes(`imported:${automated}`));
	assert.ok(
		forJoe.every((what) => typeof what === "string" && what.length > 0),
	);
	assert.deepEqual(await seen(dell), forJoe);
});

test("A malformed cursor is refused", async () => {
	const response = await request(joe, "updates/changes?before=soon", {
		method: "GET",
	});
	assert.equal(response.status, 400);
});
