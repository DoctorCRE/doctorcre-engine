import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { nextTransaction } from "../next-connection.ts";
import { isArguments } from "../save-door.ts";
import { copyTest, readSchema } from "../test-copy.ts";
import worker from "../worker.ts";
import { readNextCalendarDates } from "./calendar.ts";

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
const pastDate = id(25);
const supplier = id(43);
const movers = id(44);
const lead = id(45);
const vendorContact = id(46);
const leadContact = id(47);
const formerVendorContact = id(48);
const futureVendorContact = id(52);
const futureVendorStep = id(53);
const cadence = "Relationship touch — Example Contact. 90-day vendor cadence.";
const longWording =
	"Ask Example Supply whether the expansion order can ship before the tenant improvements finish next spring";

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
			('${automatedDate}', '${open}', 'due_diligence', '2030-02-10', 'open', 'Example checklist', '${automation}'),
			('${pastDate}', '${open}', 'lease commencement', '2001-01-05', 'open', 'Example lease', '${alex}');
		insert into public.event (subject_type, subject_id, field, new_value, occurred_at, actor_id, verb, cause)
			values ('deal', '${open}', 'status', '{"critical_date_id":"${done}","status":"cleared","reason":"Example payment"}',
				'2026-02-01', '${alex}', 'resolve-critical-date', 'human_stated');

		begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${alex}', 'person', 'Alex Example'),
			('${casey}', 'person', 'Casey Example');
		insert into app_user (id, slug) values ('${alex}', 'joe'), ('${casey}', 'dell');
		insert into party (id, kind, name) values ('${clinic}', 'company', 'Example Clinic'),
			('${supplier}', 'company', 'Example Supply'), ('${movers}', 'company', 'Example Movers');
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into party (id, kind, name, how_found) values ('${lead}', 'company', 'Example Place', 'referral');
		update party set how_found = 'referral' where id = '${clinic}';
		insert into party (id, kind, name) values ('${vendorContact}', 'person', 'Example Contact'),
			('${leadContact}', 'person', 'Example Lead Contact'), ('${formerVendorContact}', 'person', 'Example Former Contact'),
			('${futureVendorContact}', 'person', 'Example Future Contact');
		insert into role (slug, label) values ('vendor', 'Vendor'), ('lead', 'Lead');
		insert into stage (role, slug, label) values ('lead', 'new', 'New'), ('lead', 'opportunity', 'Opportunity');
		insert into party_role (party_id, role, stage) values ('${clinic}', 'vendor', null),
			('${supplier}', 'vendor', null), ('${movers}', 'vendor', null), ('${lead}', 'lead', 'new'),
			('${clinic}', 'lead', 'opportunity');
		insert into party_company (person_id, company_id, started_on, ended_on) values
			('${vendorContact}', '${lead}', '1999-01-01', '2000-01-01'),
			('${vendorContact}', '${supplier}', '2000-01-01', null),
			('${vendorContact}', '${lead}', '2001-01-15', null),
			('${leadContact}', '${lead}', '2000-01-01', null),
			('${formerVendorContact}', '${supplier}', '1999-01-01', '2001-01-15'),
			('${futureVendorContact}', '${supplier}', '1999-01-01', '2000-01-01'),
			('${futureVendorContact}', '${supplier}', '2099-01-16', null);
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
		insert into next_step (id, deal_id, party_id, owner_party_id, what, due_on, hold_until, resolution)
		values
			('${id(31)}', '${open}', null, '${alex}', '**Send revised offer**. Before sending, check the suite number.', '2001-01-12', null, null),
			('${id(32)}', null, '${clinic}', '${casey}', 'Ask Example Clinic (T-137) about the expansion', '2001-01-20', null, null),
			('${id(33)}', '${other}', null, '${alex}', 'Held step', '2001-01-14', 'infinity', null),
			('${id(34)}', '${closed}', null, '${casey}', 'Snoozed step', '2001-01-14', null, null),
			('${id(35)}', '${other}', null, '${casey}', 'Undated step', null, null, null),
			('${id(36)}', '${open}', null, '${alex}', 'Finished step', '2001-01-14', null, 'done'),
			('${id(39)}', '${open}', null, '${casey}', 'JOE DECIDE: call Example Owner at (555) 010-0199 about the renewal', '2001-01-13', null, null),
			('${id(40)}', null, '${supplier}', '${alex}', '${longWording}', '2001-01-18', null, null),
			('${id(41)}', null, '${lead}', '${alex}', 'Lease event T-3 months — Example Place (L-001), est. 2001-04-01. Last window before leverage is gone.', '2001-01-10', null, null),
			('${id(42)}', null, '${movers}', '${alex}', 'Confirm the move date', '2001-01-12', '2001-01-20', null),
			('${id(49)}', null, '${vendorContact}', '${alex}', '${cadence}', '2001-01-17', null, null),
			('${id(50)}', null, '${leadContact}', '${alex}', 'Ask about the introduction', '2001-01-10', null, null),
			('${id(51)}', null, '${formerVendorContact}', '${alex}', 'Ask about the move', '2001-01-10', null, null),
			('${futureVendorStep}', null, '${futureVendorContact}', '${alex}', 'Confirm the delivery slot', '2001-01-10', null, null);
		insert into home_mark (user_id, next_step_id, disposition, snoozed_until)
			values ('${casey}', '${id(34)}', 'snoozed', 'infinity');
		commit;
	`);
	await db.query("begin");
	const results = await db.query(await readSchema("copy-critical-dates.sql"));
	assert.ok(Array.isArray(results));
	assert.deepEqual(results.at(-1)?.rows, []);
	await db.query("commit");
});
after(cleanup);

function rowIds(rows: unknown) {
	assert.ok(Array.isArray(rows));
	return rows.map((row: unknown) => {
		assert.ok(isArguments(row));
		return row.id;
	});
}

const get = (
	schema?: string,
	partner?: string,
	path = "calendar/critical-dates",
) =>
	worker.request(
		`https://app.example.test/api/engine/${path}`,
		{ headers: partner ? { Cookie: "__Host-dealroom_session=example" } : {} },
		{
			DEALS_READ_SCHEMA: schema,
			HOME_INBOX_READ_SCHEMA: schema,
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
							id: pastDate,
							deal_id: open,
							deal_name: "Example lease",
							owner: schema === "next" ? "joe" : "alex",
							kind: "Lease commencement",
							due_on: "2001-01-05",
							done: false,
						},
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

test("Calendar includes both a dual-role vendor and a contact at separate lead and vendor companies", async () => {
	const body = await nextTransaction(connectionString, "read", (tx) =>
		readNextCalendarDates(tx, alex, "2001-01-15T18:00:00Z"),
	);
	assert.ok("next_steps" in body);
	const links = new Map(
		body.next_steps.map((step) => [step.id, step.open_url]),
	);
	assert.equal(
		links.get(id(32)),
		`/relationships?node=party:${clinic}&step=${id(32)}`,
	);
	assert.equal(
		links.get(id(49)),
		`/relationships?node=party:${vendorContact}&step=${id(49)}`,
	);
	assert.equal(links.has(id(41)), false);
	assert.equal(links.has(id(50)), false);
});

test("Calendar includes company links starting on the request's Central day and excludes ended links", async () => {
	for (const [now, futureShown, formerShown] of [
		["2099-01-16T05:59:59Z", false, false],
		["2099-01-16T06:00:00Z", true, false],
		["2001-01-15T05:59:59Z", false, true],
		["2001-01-15T06:00:00Z", false, false],
	] as const) {
		const body = await nextTransaction(connectionString, "read", (tx) =>
			readNextCalendarDates(tx, alex, now),
		);
		assert.ok("next_steps" in body);
		const ids = rowIds(body.next_steps);
		assert.equal(ids.includes(futureVendorStep), futureShown, now);
		assert.equal(ids.includes(id(51)), formerShown, now);
	}
});

test("both partners see overdue steps on the request day and upcoming steps on their dates", async () => {
	for (const [partner, now, today, daysLate] of [
		[alex, "2001-01-15T18:00:00Z", "2001-01-15", 3],
		[casey, "2001-01-16T18:00:00Z", "2001-01-16", 4],
	] as const) {
		const body = await nextTransaction(connectionString, "read", (tx) =>
			readNextCalendarDates(tx, partner, now),
		);
		assert.ok("next_steps" in body);
		assert.deepEqual(body.next_steps, [
			{
				id: id(31),
				what: "Send revised offer. Before sending, check the suite number.",
				why: null,
				owner: "joe",
				record_label: "Example lease",
				due_on: "2001-01-12",
				display_on: today,
				days_late: daysLate,
				open_url: `/deals?deal=${open}&focus=next-step&step=${id(31)}`,
			},
			{
				id: id(39),
				what: "call Example Owner at (555) 010-0199 about the renewal",
				why: null,
				owner: "dell",
				record_label: "Example lease",
				due_on: "2001-01-13",
				display_on: today,
				days_late: daysLate - 1,
				open_url: `/deals?deal=${open}&focus=next-step&step=${id(39)}`,
			},
			{
				id: id(49),
				what: "Check in with Example Contact (vendor)",
				why: null,
				owner: "joe",
				record_label: "Example Contact",
				due_on: "2001-01-17",
				display_on: "2001-01-17",
				days_late: 0,
				open_url: `/relationships?node=party:${vendorContact}&step=${id(49)}`,
			},
			{
				id: id(40),
				what: "Ask Example Supply whether the expansion order can ship before the tenant improvements…",
				why: longWording,
				owner: "joe",
				record_label: "Example Supply",
				due_on: "2001-01-18",
				display_on: "2001-01-18",
				days_late: 0,
				open_url: `/relationships?node=party:${supplier}&step=${id(40)}`,
			},
			{
				id: id(32),
				what: "Ask Example Clinic about the expansion",
				why: null,
				owner: "dell",
				record_label: "Example Clinic",
				due_on: "2001-01-20",
				display_on: "2001-01-20",
				days_late: 0,
				open_url: `/relationships?node=party:${clinic}&step=${id(32)}`,
			},
		]);
	}
});

test("Calendar and Today still show dated steps when open steps have infinite due dates", async (t) => {
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into next_step (id, deal_id, party_id, owner_party_id, what, due_on) values
			('${id(37)}', '${closed}', null, '${alex}', 'No finite due date', 'infinity'),
			('${id(38)}', null, '${clinic}', '${alex}', 'No finite due date', '-infinity');
		commit;
	`);
	try {
		await t.test(
			"Calendar returns the critical dates and finite steps",
			async () => {
				const response = await get("next", "joe");
				assert.equal(response.status, 200);
				const calendar = await response.json();
				assert.ok(isArguments(calendar));
				assert.deepEqual(rowIds(calendar.critical_dates), [
					pastDate,
					date,
					otherDate,
				]);
				assert.deepEqual(
					rowIds(calendar.next_steps),
					[31, 42, 39, 49, 40, 32].map(id),
				);
			},
		);
		await t.test("Today returns the finite reminders", async () => {
			const response = await get("next", "joe", "home/today");
			assert.equal(response.status, 200);
			const body = await response.json();
			assert.ok(isArguments(body) && isArguments(body.reminders));
			assert.equal(body.reminders.state, "ready");
			assert.deepEqual(
				rowIds(body.reminders.late),
				[31, 42, 39, 49, 40, 32].map(id),
			);
		});
	} finally {
		await db.query(`begin;
			select set_config('engine.job', 'old_system', true);
			delete from next_step where id in ('${id(37)}', '${id(38)}');
			commit;
		`);
	}
});
