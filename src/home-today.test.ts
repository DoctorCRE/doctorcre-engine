import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reader: Record<string, string> = { HOME_INBOX_READ_SCHEMA: "next" };
const alex = { user: "alex" };

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into role (slug, label) values ('lead', 'Lead'), ('client', 'Client');
		insert into stage (role, slug, label) values ('lead', 'opportunity', 'Opportunity');
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into phase (slug, label) values ('dead', 'Dead');
		insert into party (id, kind, name, how_found) values
			('${id(1)}', 'person', 'Alex Example', null), ('${id(2)}', 'person', 'Blair Example', null),
			('${id(3)}', 'company', 'Example Dental', 'referral'), ('${id(4)}', 'person', 'Dr. Example', null),
			('${id(5)}', 'company', 'Solo Clinic', 'referral'), ('${id(6)}', 'company', 'Prospect Dental', 'referral');
		insert into app_user (id, slug) values ('${id(1)}', 'alex'), ('${id(2)}', 'blair');
		insert into party_email (party_id, address, label) values ('${id(1)}', 'alex@example.test', 'work'),
			('${id(4)}', 'dr.example@example.test', 'work'), ('${id(5)}', 'solo@example.test', 'work');
		insert into party_company (person_id, company_id) values ('${id(4)}', '${id(3)}');
		insert into party_role (party_id, role, stage) values ('${id(3)}', 'client', null), ('${id(6)}', 'lead', 'opportunity');
		insert into deal (id, name, owner_user_id) values ('${id(7)}', 'Example Dental, Springfield', '${id(1)}'),
			('${id(8)}', 'Other Clinic, Austin', '${id(2)}'), ('${id(9)}', 'Closed Clinic', '${id(1)}');
		insert into deal_party (deal_id, party_id, role) values ('${id(7)}', '${id(3)}', 'client'), ('${id(9)}', '${id(3)}', 'client');
		insert into deal_phase_change (deal_id, happened_at, phase, reason) values ('${id(9)}', now(), 'dead', 'Client withdrew');
		insert into property (id, address) values ('${id(10)}', '100 Example Way');
		insert into deal_property (deal_id, property_id) values ('${id(7)}', '${id(10)}');
		insert into activity (id, kind, happened_at, from_party_id, summary)
			values ('${id(11)}', 'call', now() - interval '1 day', '${id(4)}', 'Discussed lease.');
		insert into activity_about (activity_id, deal_id) values ('${id(11)}', '${id(8)}'), ('${id(11)}', '${id(9)}');
		with day as (select (now() at time zone 'America/Chicago')::date as d)
		insert into next_step (id, deal_id, party_id, property_id, owner_party_id, what, due_on, hold_until, call_activity_id, call_evidence_quote)
		select v.id, v.deal_id, v.party_id, v.property_id, v.owner_id, v.what, day.d + v.due_offset,
			case when v.hold_offset is not null then day.d + v.hold_offset end, v.call_id, v.quote
		from day cross join (values
			('${id(21)}'::uuid, '${id(7)}'::uuid, null::uuid, null::uuid, '${id(1)}'::uuid, 'Send revised LOI', -3, null::int, null::uuid, null::text),
			('${id(22)}', null, '${id(3)}', null, '${id(1)}', 'Confirm suite size', 0, null, null, null),
			('${id(23)}', '${id(8)}', null, null, '${id(1)}', 'Email floor plan', -1, null, '${id(11)}', 'Send floor plan.'),
			('${id(24)}', '${id(9)}', null, null, '${id(1)}', 'Dropped follow-up', -2, null, '${id(11)}', 'Old follow-up.'),
			('${id(25)}', null, '${id(5)}', null, '${id(1)}', 'Check in next month', 30, null, null, null),
			('${id(26)}', null, '${id(4)}', null, '${id(1)}', 'Wait for contractor', -2, 5, null, null),
			('${id(27)}', null, '${id(6)}', null, '${id(1)}', 'Snoozed reminder', -4, null, null, null),
			('${id(28)}', '${id(8)}', null, null, '${id(2)}', 'Review counter', -2, null, null, null),
			('${id(29)}', null, '${id(6)}', null, '${id(2)}', 'Call prospect', 0, null, null, null),
			('${id(30)}', null, null, '${id(10)}', '${id(1)}', 'Check building', 0, null, null, null)
		) v(id, deal_id, party_id, property_id, owner_id, what, due_offset, hold_offset, call_id, quote);
		insert into home_mark (user_id, next_step_id, disposition, snoozed_until) values ('${id(1)}', '${id(27)}', 'snoozed', now() + interval '2 days');
		insert into home_mark (user_id, call_follow_up_id, disposition, drop_reason) values ('${id(1)}', '${id(24)}', 'dropped', 'Already handled.');
		with day as (select (now() at time zone 'America/Chicago')::date as d)
		insert into critical_date (id, deal_id, kind, due_on, source, note)
		select v.id, v.deal_id, v.kind, day.d + v.due_offset, 'Lease draft', v.note
		from day cross join (values
			('${id(41)}'::uuid, '${id(7)}'::uuid, 'loi_expiry', -2, 'Countersign'), ('${id(42)}', '${id(7)}', 'due_diligence', 7, null),
			('${id(43)}', '${id(7)}', 'lease_end', 30, null), ('${id(44)}', '${id(7)}', 'rent_start', 2, null),
			('${id(45)}', '${id(9)}', 'loi_expiry', 1, null), ('${id(46)}', '${id(8)}', 'option_notice', 3, 'First renewal')
		) v(id, deal_id, kind, due_offset, note);
		select set_config('engine.job', '', true), set_config('engine.user_id', '${id(1)}', true);
		update critical_date set status = 'open' where id in ('${id(41)}', '${id(42)}', '${id(43)}', '${id(45)}', '${id(46)}');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function today(search = "", caller = alex, env = reader) {
	const res = await request(
		caller,
		`home/today${search}`,
		{ method: "GET" },
		env,
	);
	return [res.status, (await res.json()) as Record<string, unknown>] as const;
}

test("switch off returns 404 and invalid queries are refused", async () => {
	const got = await Promise.all([
		today("", alex, {}),
		today("?actor=blair"),
		today("?extra=1"),
		today("?owner="),
		today("?owner=alex&owner=blair"),
		today("?owner=nobody"),
	]);
	assert.deepEqual(
		got.map(([s]) => s),
		[404, 403, 400, 400, 400, 400],
	);
	assert.equal(got[5]?.[1].error, "unknown_owner");
});

test("reminders scope by partner, report lateness and link matching Home cards", async () => {
	const [status, body] = await today();
	assert.equal(status, 200);
	assert.partialDeepStrictEqual(body, {
		ok: true,
		schema_version: "home-today.v1",
		viewer: "alex",
		owner: "all",
		partners: [
			{ slug: "alex", name: "Alex Example" },
			{ slug: "blair", name: "Blair Example" },
		],
		meetings: {
			state: "unavailable",
			observed_at: null,
			items: [],
			follow_up_reviews: [],
		},
		reminders: { state: "ready" },
	});
	assert.ok(
		isArguments(body.meetings) && typeof body.meetings.reason === "string",
	);
	assert.ok(isArguments(body.reminders));
	const late = (body.reminders.late as unknown[]).filter(isArguments);
	const upcoming = (body.reminders.upcoming as unknown[]).filter(isArguments);
	const summarize = (i: Record<string, unknown>) =>
		`${i.id}|${i.title}|${i.late_label}|${i.owner}|${i.home_item_id}|${i.open_url}`;
	assert.deepEqual(late.map(summarize), [
		`${id(21)}|Send revised LOI|3 days late|alex|next_action:${id(21)}|/deals?deal=${id(7)}&focus=next-step&step=${id(21)}`,
		`${id(41)}|LOI expiry: Countersign|2 days late|alex|null|/deals?deal=${id(7)}`,
		`${id(28)}|Review counter|2 days late|blair|null|/deals?deal=${id(8)}&focus=next-step&step=${id(28)}`,
		`${id(23)}|Email floor plan|1 day late|alex|capture_post_call_action:${id(23)}|/calls?session=${id(11)}`,
	]);
	assert.deepEqual(upcoming.map(summarize), [
		`${id(22)}|Confirm suite size|null|alex|next_action:${id(22)}|/relationships?node=party:${id(3)}`,
		`${id(29)}|Call prospect|null|blair|null|/deals?prospect=${id(6)}&focus=follow-up`,
		`${id(30)}|Check building|null|alex|next_action:${id(30)}|/deals?deal=${id(7)}`,
		`${id(46)}|Option notice: First renewal|null|blair|null|/deals?deal=${id(8)}`,
		`${id(42)}|Due diligence|null|alex|null|/deals?deal=${id(7)}`,
	]);
	const inbox = (await (
		await request(alex, "home/inbox", { method: "GET" }, reader)
	).json()) as {
		items: Record<string, unknown>[];
	};
	const inboxIds = new Set(inbox.items.map((i) => i.item_id));
	for (const i of [...late, ...upcoming])
		if (typeof i.home_item_id === "string")
			assert.ok(inboxIds.has(i.home_item_id));
	const [, blairOnly] = await today("?owner=blair");
	assert.ok(isArguments(blairOnly.reminders));
	const ids = (list: unknown) =>
		(list as Record<string, unknown>[]).map((i) => i.id);
	assert.deepEqual(
		[ids(blairOnly.reminders.late), ids(blairOnly.reminders.upcoming)],
		[[id(28)], [id(29), id(46)]],
	);
});

test("meetings read door 25 for today only, match open deals and hide handled reviews", async () => {
	const {
		rows: [t],
	} = await db.query<{ now_at: string; tomorrow: string }>(
		`select now() as now_at, (((now() at time zone 'America/Chicago')::date + 1)::timestamp at time zone 'America/Chicago') as tomorrow`,
	);
	assert.ok(t);
	const now = new Date(t.now_at).getTime();
	const tomorrow = new Date(t.tomorrow).getTime();
	const iso = (ms: number) => new Date(ms).toISOString();
	const review = (key: string, h: number) => ({
		key,
		title: `Review ${h}`,
		start: iso(now - (h + 1) * 3_600_000),
		end: iso(now - h * 3_600_000),
		state: "needs_review",
		prompt: "Confirm whether this meeting happened.",
	});
	const [put] = await save(
		{ job: "mail_capture", for_user: "alex" },
		"calendar/agenda",
		{
			schema: "carr-calendar-agenda.v1",
			observed_at: iso(now - 60_000),
			items: [
				{
					start: iso(now - 300_000),
					end: iso(now + 300_000),
					title: "Lease review",
					organizer: { name: "Alex Example", email: "alex@example.test" },
					attendees: [
						{ name: "Dr. Example", email: "dr.example@example.test" },
						{ name: "Bad", email: "not-an-email" },
					],
				},
				{
					start: iso(now - 200_000),
					end: iso(now + 400_000),
					title: "Solo intro",
					attendees: [{ name: "Solo Clinic", email: "solo@example.test" }],
				},
				{
					start: iso(now - 7_200_000),
					end: iso(now - 3_600_000),
					title: "Ended",
				},
				{
					start: iso(tomorrow + 3_600_000),
					end: iso(tomorrow + 7_200_000),
					title: "Tomorrow",
				},
			],
			follow_up_reviews: [
				review("0123456789abcdef", 1),
				review("fedcba9876543210", 2),
				review("abcdef0123456789", 3),
			],
			warnings: [],
		},
		"PUT",
	);
	assert.equal(put, 200);
	const dismiss = await save(
		alex,
		"calendar/reviews/fedcba9876543210/dismissal",
		{
			idempotency_key: randomUUID(),
		},
	);
	assert.equal(dismiss[0], 200);
	await db.query(`begin; select set_config('engine.user_id', '${id(1)}', true);
		insert into activity (kind, happened_at, calendar_review_user_id, calendar_review_key)
		values ('meeting', now() - interval '3 hours', '${id(1)}', 'abcdef0123456789'); commit;`);
	const [status, body] = await today();
	assert.equal(status, 200);
	assert.ok(isArguments(body.meetings));
	assert.deepEqual(
		[body.meetings.state, body.meetings.observed_at],
		["partial", iso(now - 60_000)],
	);
	const items = (body.meetings.items as unknown[]).filter(isArguments);
	assert.deepEqual(
		items.map((m) => `${m.title}|${m.context_label}|${m.open_url}`),
		[
			`Lease review|Example Dental, Springfield|/deals?deal=${id(7)}`,
			"Solo intro|Solo Clinic|null",
		],
	);
	assert.deepEqual(items[0]?.possible_deals, [
		{
			id: id(7),
			name: "Example Dental, Springfield",
			client_name: "Example Dental",
			open_url: `/deals?deal=${id(7)}`,
		},
	]);
	assert.deepEqual(
		(body.meetings.follow_up_reviews as Record<string, unknown>[]).map(
			(r) => r.key,
		),
		["0123456789abcdef"],
	);
	const [, blairView] = await today("?owner=blair", { user: "blair" });
	assert.ok(
		isArguments(blairView.meetings) &&
			blairView.meetings.state === "unavailable",
	);
});
