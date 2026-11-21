import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { copyTest } from "../test-copy.ts";
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

before(async () => {
	await setup();
	await db.query(`
		insert into public.actor (id, slug, kind, display_name) values
			('${alex}', 'alex', 'human', 'Alex Example'),
			('${casey}', 'casey', 'human', 'Casey Example');
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
			('${otherDate}', '${other}', 'option_notice', '2030-02-01', 'open', 'Example option', '${casey}'),
			('${closedDate}', '${closed}', 'lease_end', '2030-03-01', 'open', 'Example lease', '${alex}'),
			('${done}', '${open}', 'rent_start', '2030-01-01', 'cleared', 'Example lease', '${alex}');

		begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${alex}', 'person', 'Alex Example'),
			('${casey}', 'person', 'Casey Example');
		insert into app_user (id, slug) values ('${alex}', 'alex'), ('${casey}', 'casey');
		insert into deal_kind (slug, label) values ('lease', 'Lease');
		insert into phase (slug, label) values ('research', 'Research'), ('closed', 'Closed');
		insert into deal (id, name, kind, owner_user_id) values
			('${open}', 'Example lease', 'lease', '${alex}'),
			('${other}', 'Example expansion', 'lease', '${casey}'),
			('${closed}', 'Example closed lease', 'lease', '${alex}');
		insert into deal_phase_change (deal_id, happened_at, phase)
			values ('${open}', '2026-01-01', 'research'), ('${other}', '2026-01-01', 'research'),
			('${closed}', '2026-01-01', 'research'), ('${closed}', '2026-01-02', 'closed');
		insert into critical_date (id, deal_id, kind, due_on, source)
			values ('${id(24)}', '${other}', 'other', '2030-01-20', 'Example proposal');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${alex}', true);
		insert into critical_date (id, deal_id, kind, due_on, source) values
			('${date}', '${open}', 'loi_expiry', '2030-01-15', 'Example offer'),
			('${otherDate}', '${other}', 'option_notice', '2030-02-03', 'Example option'),
			('${closedDate}', '${closed}', 'lease_end', '2030-03-01', 'Example lease'),
			('${done}', '${open}', 'rent_start', '2030-01-01', 'Example lease');
		update critical_date set status = 'open' where id in ('${date}', '${otherDate}', '${closedDate}', '${done}');
		update critical_date set status = 'done', resolution_reason = 'Example payment' where id = '${done}';
		commit;
	`);
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
		for (const partner of ["alex", "casey"]) {
			const response = await get(schema, partner);
			assert.equal(response.status, 200);
			assert.deepEqual(await response.json(), {
				schema_version: "calendar-critical-dates.v1",
				critical_dates: [
					{
						id: date,
						deal_id: open,
						deal_name: "Example lease",
						kind: "LOI expiry",
						due_on: "2030-01-15",
						done: false,
					},
					{
						id: otherDate,
						deal_id: other,
						deal_name: "Example expansion",
						kind: "Option notice",
						due_on: schema === "next" ? "2030-02-03" : "2030-02-01",
						done: false,
					},
				],
			});
		}
	});
}
