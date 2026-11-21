import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { copyTest, readSchema } from "../test-copy.ts";
import worker from "../worker.ts";

const { db, connectionString, setup, cleanup } = copyTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const alex = id(1);
const casey = id(2);
const clinic = id(3);
const client = id(4);
const open = id(10);
const other = id(11);
const closed = id(12);
const date = id(20);
const otherDate = id(21);
const closedDate = id(22);
const done = id(23);
const automation = id(5);
const automatedDate = id(24);

before(async () => {
	await setup();
	await db.query(`
		insert into public.actor (id, slug, kind, display_name) values
			('${alex}', 'alex', 'human', 'Alex Example'),
			('${casey}', 'casey', 'human', 'Casey Example'),
			('${automation}', 'example-agent', 'automation', 'Example Agent');
		insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Active', true, 1);
		insert into public.party (id, kind, name, created_by, updated_by)
			values ('${clinic}', 'org', 'Example Clinic', '${alex}', '${alex}');
		insert into public.client_status (slug, label) values ('engaged', 'Engaged');
		insert into public.client (id, party_id, status, acquisition_source, created_by, updated_by)
			values ('${client}', '${clinic}', 'engaged', 'Example referral', '${alex}', '${alex}');
		insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Lease', 1);
		insert into public.deal_phase (slug, label) values ('research', 'Research'), ('closed', 'Closed');
		insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by) values
			('${open}', '${client}', 'Example lease', 'lease', 'research', 'alex', '${alex}', '${alex}'),
			('${other}', '${client}', 'Example expansion', 'lease', 'research', 'casey', '${casey}', '${casey}'),
			('${closed}', '${client}', 'Example closed lease', 'lease', 'closed', 'alex', '${alex}', '${alex}');
		insert into public.critical_date (id, deal_id, kind, due_on, status, source, created_by) values
			('${date}', '${open}', 'loi_expiry', '2030-01-15', 'open', 'Example offer', '${alex}'),
			('${otherDate}', '${other}', 'option_window', '2030-02-01', 'open', 'Example option', '${casey}'),
			('${closedDate}', '${closed}', 'lease_end', '2030-03-01', 'open', 'Example lease', '${alex}'),
			('${done}', '${open}', 'rent_start', '2030-01-01', 'cleared', 'Example lease', '${alex}'),
			('${automatedDate}', '${open}', 'due_diligence', '2030-02-10', 'open', 'Example checklist', '${automation}');
		insert into public.event (subject_type, subject_id, field, new_value, occurred_at, actor_id, verb, cause)
			values ('deal', '${open}', 'status', '{"critical_date_id":"${done}","status":"cleared","reason":"Example payment"}',
				'2026-02-01', '${alex}', 'resolve-critical-date', 'human_stated');

		begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${alex}', 'person', 'Alex Example'),
			('${casey}', 'person', 'Casey Example');
		insert into app_user (id, slug) values ('${alex}', 'joe'), ('${casey}', 'dell');
		insert into party (id, kind, name) values ('${clinic}', 'company', 'Example Clinic');
		insert into outside_id (source, value, party_id)
			values ('old_system', '${alex}', '${alex}'), ('old_system', '${casey}', '${casey}');
		insert into deal_kind (slug, label) values ('lease', 'Lease');
		insert into phase (slug, label) values ('research', 'Research'), ('closed', 'Closed');
		insert into deal (id, name, kind, owner_user_id) values
			('${open}', 'Example lease', 'lease', '${alex}'),
			('${other}', 'Example expansion', 'lease', '${casey}'),
			('${closed}', 'Example closed lease', 'lease', '${alex}');
		insert into deal_phase_change (deal_id, happened_at, phase)
			values ('${open}', '2026-01-01', 'research'), ('${other}', '2026-01-01', 'research'),
			('${closed}', '2026-01-01', 'research'), ('${closed}', '2026-01-02', 'closed');
		with clock as (select (now() at time zone 'America/Chicago')::date as today)
		insert into next_step (id, deal_id, party_id, owner_party_id, what, due_on, hold_until, resolution)
		select v.id, v.deal_id, v.party_id, v.owner_id, v.what, today + v.due_offset,
			today + v.hold_offset, v.resolution
		from clock cross join (values
			('${id(31)}'::uuid, '${open}'::uuid, null::uuid, '${alex}'::uuid, '**Send revised offer**', -3, null::int, null::text),
			('${id(32)}', null, '${clinic}', '${casey}', 'Ask about the expansion', 5, null, null),
			('${id(33)}', '${other}', null, '${alex}', 'Held step', -1, 5, null),
			('${id(34)}', '${closed}', null, '${casey}', 'Snoozed step', -1, null, null),
			('${id(35)}', '${other}', null, '${casey}', 'Undated step', null, null, null),
			('${id(36)}', '${open}', null, '${alex}', 'Finished step', -1, null, 'done')
		) v(id, deal_id, party_id, owner_id, what, due_offset, hold_offset, resolution);
		insert into home_mark (user_id, next_step_id, disposition, snoozed_until)
			values ('${casey}', '${id(34)}', 'snoozed', now() + interval '2 days');
		commit;
	`);
	await db.query("begin");
	const results = await db.query(await readSchema("copy-critical-dates.sql"));
	assert.ok(Array.isArray(results));
	assert.deepEqual(results.at(-1)?.rows, []);
	await db.query("commit");
});
after(cleanup);

const get = (schema?: string, partner?: string) =>
	worker.request(
		"https://app.example.test/api/engine/calendar/critical-dates",
		{ headers: partner ? { Cookie: "__Host-dealroom_session=example" } : {} },
		{
			DEALS_READ_SCHEMA: schema,
			DATABASE: { connectionString },
			CARR: {
				fetch: async () =>
					Response.json({
						actor: { slug: partner, display: "Example Partner" },
						csrf_token: "example",
					}),
			},
		},
	);

test("the Calendar read requires a session", async () => {
	assert.equal((await get()).status, 401);
});

for (const schema of [undefined, "next"]) {
	test(`both partners see open dates from open deals in the ${schema ?? "old"} schema`, async () => {
		for (const [oldSlug, newSlug] of [
			["alex", "joe"],
			["casey", "dell"],
		]) {
			const partner = schema === "next" ? newSlug : oldSlug;
			const response = await get(schema, partner);
			assert.equal(response.status, 200);
			const body = await response.json();
			assert.ok(isArguments(body));
			const { schema_version, critical_dates } = body;
			assert.deepEqual(
				{ schema_version, critical_dates },
				{
					schema_version: "calendar-critical-dates.v1",
					critical_dates: [
						{
							id: date,
							deal_id: open,
							deal_name: "Example lease",
							owner: schema === "next" ? "joe" : "alex",
							kind: "LOI expiry",
							due_on: "2030-01-15",
							done: false,
						},
						{
							id: otherDate,
							deal_id: other,
							deal_name: "Example expansion",
							owner: schema === "next" ? "dell" : "casey",
							kind: "Option notice",
							due_on: "2030-02-01",
							done: false,
						},
						// The copy waits for a partner to confirm an automation-authored date.
						...(schema === "next"
							? []
							: [
									{
										id: automatedDate,
										deal_id: open,
										deal_name: "Example lease",
										owner: "alex",
										kind: "Due diligence",
										due_on: "2030-02-10",
										done: false,
									},
								]),
					],
				},
			);
		}
	});
}

test("both partners see today's overdue step and upcoming steps on their dates", async () => {
	const {
		rows: [clock],
	} = await db.query(`select
		((now() at time zone 'America/Chicago')::date - 3)::text as past,
		(now() at time zone 'America/Chicago')::date::text as today,
		((now() at time zone 'America/Chicago')::date + 5)::text as future`);
	for (const partner of ["joe", "dell"]) {
		const response = await get("next", partner);
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.ok(isArguments(body));
		assert.deepEqual(body.next_steps, [
			{
				id: id(31),
				what: "Send revised offer",
				owner: "joe",
				record_label: "Example lease",
				due_on: clock.past,
				display_on: clock.today,
				days_late: 3,
				open_url: `/deals?deal=${open}&focus=next-step&step=${id(31)}`,
			},
			{
				id: id(32),
				what: "Ask about the expansion",
				owner: "dell",
				record_label: "Example Clinic",
				due_on: clock.future,
				display_on: clock.future,
				days_late: 0,
				open_url: `/relationships?node=party:${clinic}&step=${id(32)}`,
			},
		]);
	}
});
