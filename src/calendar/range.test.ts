import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

type Row = Record<string, unknown>;
type Body = {
	error?: string;
	meetings?: (Row & { notes: string[]; items: Row[] })[];
	tours?: Row & { items: Row[] };
};

const { db, setup, cleanup, request, save } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reader = { HOME_INBOX_READ_SCHEMA: "next" };
const now = Date.parse("2026-01-15T00:05:00-06:00");
const at = (stamp: string) => new Date(Date.parse(stamp)).toISOString();
const meeting = (
	start: string,
	end: string,
	title: string,
	email?: string,
) => ({
	start: at(start),
	end: at(end),
	title,
	...(email && { attendees: [{ name: "Dr. Example", email }] }),
});
const agenda = (observed: number, items: object[]) => ({
	schema: "carr-calendar-agenda.v1",
	observed_at: new Date(observed).toISOString(),
	items,
	follow_up_reviews: [],
	warnings: [],
});

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into role (slug, label) values ('client', 'Client'); insert into how_found (slug, label) values ('referral', 'Referral');
		insert into party (id, kind, name, how_found) values ('${id(1)}', 'person', 'Example Partner One', null),
			('${id(2)}', 'person', 'Example Partner Two', null), ('${id(3)}', 'company', 'Example Dental', 'referral'),
			('${id(4)}', 'person', 'Dr. Example', null), ('${id(5)}', 'person', 'Example Assistant', null);
		insert into app_user (id, slug) values ('${id(1)}', 'joe'), ('${id(2)}', 'dell'), ('${id(5)}', 'claude');
		insert into party_email (party_id, address, label) values ('${id(4)}', 'dr.example@example.test', 'work');
		insert into party_company (person_id, company_id) values ('${id(4)}', '${id(3)}');
		insert into party_role (party_id, role) values ('${id(3)}', 'client');
		insert into deal (id, name, owner_user_id) values ('${id(7)}', 'Example Dental, Springfield', '${id(2)}');
		insert into deal_party (deal_id, party_id, role) values ('${id(7)}', '${id(3)}', 'client');
		insert into property (id, address) values ('${id(10)}', '100 Example Way');
		insert into tour_plan (id, deal_id, planned_on) values ('${id(11)}', '${id(7)}', '2026-01-22'),
			('${id(12)}', '${id(7)}', '2026-01-23'), ('${id(13)}', '${id(7)}', '2026-02-12');
		insert into tour_stop (tour_plan_id, property_id, position)
			select t, '${id(10)}', 1 from unnest(array['${id(11)}', '${id(12)}', '${id(13)}']::uuid[]) t;
		update tour_plan set cancelled_at = now() where id = '${id(12)}';
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function range(search: string, user = "joe", env: object = reader) {
	const r = await request(
		{ user },
		`calendar/meetings${search}`,
		{ method: "GET" },
		env,
	);
	return [r.status, (await r.json()) as Body] as const;
}

test("the range read refuses a bad request before reading", async () => {
	const got = await Promise.all([
		range("?from=2026-01-01&to=2026-01-31", "joe", {}),
		range("?from=2026-01-01&to=2026-01-31", "claude"),
		range("?from=2026-01-01"),
		range("?from=2026-02-30&to=2026-03-01"),
		range("?from=2026-01-01&from=2026-01-02&to=2026-01-31"),
		range("?from=2026-01-01&to=2026-01-31&owner=joe"),
		range("?from=2026-01-01&to=2026-02-12"),
		range("?from=2026-01-31&to=2026-01-01"),
	]);
	assert.deepEqual(
		got.map(([status, body]) => [status, body.error]),
		[
			[404, "not_found"],
			[403, "AUTHORIZATION_REFUSED"],
			[400, "invalid_field_value"],
			[400, "invalid_field_value"],
			[400, "invalid_field_value"],
			[400, "unregistered_operation_fields"],
			[400, "invalid_range"],
			[400, "invalid_range"],
		],
	);
});

test("either partner reads both partners' meetings and planned tours for six weeks", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now });
	const mail = (user: string, body: object) =>
		save(
			{ job: "mail_capture", for_user: user },
			"calendar/agenda",
			body,
			"PUT",
		);
	const saved = await Promise.all([
		mail(
			"joe",
			agenda(now, [
				meeting(
					"2025-12-31T23:00:00-06:00",
					"2025-12-31T23:30:00-06:00",
					"Before the range",
				),
				meeting(
					"2026-01-20T09:00:00-06:00",
					"2026-01-20T10:00:00-06:00",
					"Lease review",
					"dr.example@example.test",
				),
				meeting(
					"2026-02-12T00:00:00-06:00",
					"2026-02-12T01:00:00-06:00",
					"After the range",
				),
			]),
		),
		mail(
			"dell",
			agenda(now - 2 * 86_400_000, [
				meeting(
					"2026-02-11T23:00:00-06:00",
					"2026-02-12T00:30:00-06:00",
					"Late call",
				),
			]),
		),
	]);
	assert.deepEqual(
		saved.map(([status]) => status),
		[200, 200],
	);
	const [[status, body], [dellStatus, dellBody]] = await Promise.all([
		range("?from=2026-01-01&to=2026-02-11"),
		range("?from=2026-01-01&to=2026-02-11", "dell"),
	]);
	assert.deepEqual([status, dellStatus], [200, 200]);
	assert.deepEqual(dellBody.meetings, body.meetings);
	const titles = body.meetings?.map((m) => [
		m.partner,
		m.items.map((i) => i.title),
	]);
	assert.deepEqual(titles, [
		["dell", ["Late call"]],
		["joe", ["Lease review"]],
	]);
	assert.partialDeepStrictEqual(body.meetings?.[1], {
		state: "ready",
		notes: [],
		items: [
			{
				open_url: `/deals?deal=${id(7)}`,
				context_label: "Example Dental, Springfield",
			},
		],
	});
	assert.partialDeepStrictEqual(body.meetings?.[0], {
		state: "partial",
		notes: ["This calendar was last read from Outlook more than 18 hours ago."],
	});
	assert.equal("follow_up_reviews" in (body.meetings?.[0] ?? {}), false);
	assert.deepEqual(body.tours, {
		state: "ready",
		reason: null,
		items: [
			{
				id: id(11),
				deal_id: id(7),
				deal_name: "Example Dental, Springfield",
				owner: "dell",
				planned_on: "2026-01-22",
				stop_count: 1,
				open_url: `/deals?deal=${id(7)}`,
			},
		],
	});
});
