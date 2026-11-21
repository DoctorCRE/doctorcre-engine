import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "./test-door.ts";

type Row = Record<string, unknown>;
type Section<T> = { state: string; reason: string | null } & T;
type TodayBody = {
	error?: string;
	meetings?: Section<{
		observed_at: string | null;
		items: Row[];
		follow_up_reviews: Row[];
	}>;
	reminders?: Section<{ late: Row[]; upcoming: Row[] }>;
};

const { db, setup, cleanup, request, save } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reader: Record<string, string> = { HOME_INBOX_READ_SCHEMA: "next" };
const joe = { user: "joe" };
const get = { method: "GET" } as const;

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into role (slug, label) values ('lead', 'Lead'), ('client', 'Client'), ('vendor', 'Vendor');
		insert into stage (role, slug, label) values ('lead', 'opportunity', 'Opportunity');
		insert into how_found (slug, label) values ('referral', 'Referral'); insert into phase (slug, label) values ('dead', 'Dead');
		insert into party (id, kind, name, how_found) values
			('${id(1)}', 'person', 'Example Partner One', null), ('${id(2)}', 'person', 'Example Partner Two', null),
			('${id(3)}', 'company', 'Example Dental', 'referral'), ('${id(4)}', 'person', 'Dr. Example', null),
			('${id(5)}', 'company', 'Solo Clinic', 'referral'), ('${id(6)}', 'company', 'Prospect Dental', 'referral'),
			('${id(12)}', 'person', 'Example Assistant', null);
		insert into app_user (id, slug) values ('${id(1)}', 'joe'), ('${id(2)}', 'dell'), ('${id(12)}', 'claude');
		insert into party_email (party_id, address, label) values ('${id(1)}', 'joe@example.test', 'work'),
			('${id(4)}', 'dr.example@example.test', 'work'), ('${id(5)}', 'solo@example.test', 'work');
		insert into party_company (person_id, company_id) values ('${id(4)}', '${id(3)}');
		insert into party_role (party_id, role, stage) values ('${id(3)}', 'client', null), ('${id(5)}', 'vendor', null),
			('${id(6)}', 'lead', 'opportunity');
		insert into deal (id, name, owner_user_id) values ('${id(7)}', 'Example Dental, Springfield', '${id(1)}'),
			('${id(8)}', 'Other Clinic, Austin', '${id(2)}'), ('${id(9)}', 'Closed Clinic', '${id(1)}');
		insert into deal_party (deal_id, party_id, role) values ('${id(7)}', '${id(3)}', 'client'), ('${id(9)}', '${id(3)}', 'client');
		insert into deal_phase_change (deal_id, happened_at, phase, reason) values ('${id(9)}', now(), 'dead', 'Client withdrew');
		insert into property (id, address) values ('${id(10)}', '100 Example Way');
		insert into deal_property (deal_id, property_id) values ('${id(7)}', '${id(10)}');
		insert into activity (id, kind, happened_at, from_party_id, summary) values ('${id(11)}', 'call', now() - interval '1 day', '${id(4)}', 'Discussed lease.');
		insert into activity_about (activity_id, deal_id) values ('${id(11)}', '${id(8)}'), ('${id(11)}', '${id(9)}');
		with day as (select (now() at time zone 'America/Chicago')::date as d)
		insert into next_step (id, deal_id, party_id, property_id, owner_party_id, what, due_on, hold_until, call_activity_id, call_evidence_quote)
		select v.id, v.deal_id, v.party_id, v.property_id, v.owner_id, v.what, day.d + v.due_offset,
			case when v.hold_offset is not null then day.d + v.hold_offset end, v.call_id, v.quote
		from day cross join (values
			('${id(21)}'::uuid, '${id(7)}'::uuid, null::uuid, null::uuid, '${id(1)}'::uuid, 'CASEY DECIDE: send status unknown — re-touch or drop', -3, null::int, null::uuid, null::text),
			('${id(22)}', null, '${id(3)}', null, '${id(1)}', 'L-123: _Confirm suite size_ (loop #12)', 0, null, null, null),
			('${id(23)}', '${id(8)}', null, null, '${id(1)}', '(202) 555-0142 — Call about the floor plan. If no one answers, leave a message with the office and retry later.', -1, null, '${id(11)}', 'Send floor plan.'),
			('${id(24)}', '${id(9)}', null, null, '${id(1)}', 'Dropped follow-up', -2, null, '${id(11)}', 'Old follow-up.'),
			('${id(25)}', null, '${id(5)}', null, '${id(1)}', 'Check in next month', 30, null, null, null),
			('${id(26)}', null, '${id(4)}', null, '${id(1)}', 'Wait for contractor', -2, 5, null, null),
			('${id(27)}', null, '${id(6)}', null, '${id(1)}', 'Snoozed reminder', -4, null, null, null),
			('${id(28)}', '${id(8)}', null, null, '${id(2)}', 'Review counter', -2, null, null, null),
			('${id(29)}', null, '${id(6)}', null, '${id(2)}', 'Call prospect', 0, null, null, null),
			('${id(30)}', null, null, '${id(10)}', '${id(1)}', 'V-ABC-012 (loop #12)', 0, null, null, null),
			('${id(31)}', '${id(7)}', null, null, '${id(12)}', 'Non-partner reminder', -1, null, null, null),
			('${id(32)}', '${id(9)}', null, null, '${id(2)}', 'Review the ended deal', -5, null, null, null),
			('${id(33)}', null, '${id(5)}', null, '${id(2)}', 'Call the office. If no one answers, leave a message and retry tomorrow.', -6, null, null, null)
		) v(id, deal_id, party_id, property_id, owner_id, what, due_offset, hold_offset, call_id, quote);
		insert into home_mark (user_id, next_step_id, disposition, snoozed_until) values ('${id(1)}', '${id(27)}', 'snoozed', now() + interval '2 days');
		insert into home_mark (user_id, call_follow_up_id, disposition, drop_reason) values ('${id(1)}', '${id(24)}', 'dropped', 'Already handled.');
		with day as (select (now() at time zone 'America/Chicago')::date as d)
		insert into critical_date (id, deal_id, kind, due_on, source)
		select v.id, '${id(7)}'::uuid, v.kind, day.d + v.due_offset, 'Lease draft'
		from day cross join (values ('${id(41)}'::uuid, 'loi_expiry', -2), ('${id(42)}', 'due_diligence', 5)) v(id, kind, due_offset);
		select set_config('engine.job', '', true), set_config('engine.user_id', '${id(1)}', true);
		update critical_date set status = 'open' where id in ('${id(41)}', '${id(42)}'); commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function today(search = "", caller = joe, env = reader) {
	const r = await request(caller, `home/today${search}`, get, env);
	return [r.status, (await r.json()) as TodayBody] as const;
}

test("switch off returns 404, non-partners are refused, and invalid owners fail", async () => {
	const got = await Promise.all([
		today("", joe, {}),
		today("?actor=dell"),
		today("?extra=1"),
		today("?owner="),
		today("?owner=joe&owner=dell"),
		today("?owner=nobody"),
		today("?owner=claude"),
		today("", { user: "claude" }),
	]);
	const codes = got.map(([s]) => s);
	const errs = got.slice(5).map(([, b]) => b.error);
	assert.deepEqual(codes, [404, 403, 400, 400, 400, 400, 400, 403]);
	assert.deepEqual(errs, [
		"unknown_owner",
		"unknown_owner",
		"AUTHORIZATION_REFUSED",
	]);
});

test("Today links owned follow-ups to the legacy inbox card", async () => {
	const [[status, body], inbox] = await Promise.all([
		today(),
		request(joe, "home/inbox", get, reader),
	]);
	assert.deepEqual([status, inbox.status], [200, 200]);
	const { items } = (await inbox.json()) as { items: Row[] };
	const card = items.find((item) => item.source_id === id(21));
	assert.ok(typeof card?.item_id === "string");
	const followUp = body.reminders?.late.find((item) => item.id === id(21));
	assert.equal(followUp?.home_item_id, card.item_id);
});

test("Today shows plain reminder titles and flags ended deals for Deals", async () => {
	const [status, body] = await today();
	assert.equal(status, 200);
	assert.partialDeepStrictEqual(body, {
		ok: true,
		schema_version: "home-today.v1",
		viewer: "joe",
		owner: "all",
		partners: [
			{ slug: "dell", name: "Example Partner Two" },
			{ slug: "joe", name: "Example Partner One" },
		],
		meetings: { state: "unavailable", observed_at: null, items: [] },
		reminders: { state: "ready", reason: null },
	});
	assert.equal(typeof body.meetings?.reason, "string");
	const row = (i: Row) =>
		`${i.id}|${i.title}|${i.late_label}|${i.owner}|${i.home_item_id}|${i.open_url}`;
	assert.deepEqual(body.reminders?.late.map(row), [
		`${id(33)}|Call the office. If no one answers, leave a message and retry tomorrow.|6 days late|dell|null|/relationships?node=party:${id(5)}&step=${id(33)}`,
		`${id(32)}|Review the ended deal|5 days late|dell|null|/deals?deal=${id(9)}&focus=next-step&step=${id(32)}`,
		`${id(21)}|send status unknown — re-touch or drop|3 days late|joe|next_action:${id(21)}|/deals?deal=${id(7)}&focus=next-step&step=${id(21)}`,
		`${id(28)}|Review counter|2 days late|dell|null|/deals?deal=${id(8)}&focus=next-step&step=${id(28)}`,
		`${id(23)}|Follow up with Dr. Example|1 day late|joe|capture_post_call_action:${id(23)}|/calls?session=${id(11)}`,
	]);
	// Client and lead steps live on their records, not on Today.
	assert.deepEqual(body.reminders?.upcoming.map(row), [
		`${id(30)}|Follow up on 100 Example Way|null|joe|next_action:${id(30)}|/deals?deal=${id(7)}`,
	]);
	assert.deepEqual(
		body.reminders?.late.map((item) => [item.id, item.deal_ended]),
		[
			[id(33), undefined],
			[id(32), true],
			[id(21), undefined],
			[id(28), undefined],
			[id(23), undefined],
		],
	);
	const inboxRes = await request(joe, "home/inbox", get, reader);
	const inbox = (await inboxRes.json()) as { items: Row[] };
	const buildingCard = inbox.items.find(
		(i) => i.item_id === `next_action:${id(30)}`,
	);
	assert.ok(typeof buildingCard?.title === "string");
	assert.equal(buildingCard.title, "Follow up on 100 Example Way");
	const ids = new Set(inbox.items.map((i) => i.item_id));
	const { late = [], upcoming = [] } = body.reminders ?? {};
	for (const i of [...late, ...upcoming])
		if (typeof i.home_item_id === "string") assert.ok(ids.has(i.home_item_id));
	const [, dell] = await today("?owner=dell");
	const dr = dell.reminders;
	assert.deepEqual(
		[dr?.late.map((i) => i.id), dr?.upcoming.map((i) => i.id)],
		[[id(33), id(32), id(28)], []],
	);
});

async function reminderAndCardTitles(caller: { user: string }, step: string) {
	const [[todayStatus, body], inbox] = await Promise.all([
		today("", caller),
		request(caller, "home/inbox", get, reader),
	]);
	assert.deepEqual([todayStatus, inbox.status], [200, 200]);
	const { items } = (await inbox.json()) as { items: Row[] };
	const reminder = body.reminders?.late.find((item) => item.id === step);
	assert.ok(reminder);
	return [reminder.title, items.find((item) => item.source_id === step)?.title];
}

for (const [example, caller, step, title] of [
	[
		"a copied decision prompt",
		joe,
		id(21),
		"send status unknown — re-touch or drop",
	],
	["long phone instructions", joe, id(23), "Follow up with Dr. Example"],
	[
		"call instructions without a phone number",
		{ user: "dell" },
		id(33),
		"Call the office. If no one answers, leave a message and retry tomorrow.",
	],
	["plain step wording", { user: "dell" }, id(28), "Review counter"],
] as const) {
	test(`Today and the Home card share a title for ${example}`, async () => {
		assert.deepEqual(await reminderAndCardTitles(caller, step), [title, title]);
	});
}

test("today keeps each Outlook occurrence independently of its review", async (t) => {
	const hr = 3_600_000;
	const start = Date.parse("2026-01-15T00:00:00-06:00");
	const end = start + 24 * hr;
	const now = start + 5 * 60_000;
	const meetingTime = start + 12 * hr;
	t.mock.timers.enable({ apis: ["Date"], now });

	const iso = (ms: number) => new Date(ms).toISOString();
	const mtg = (a: number, b: number, title: string) => ({
		start: iso(a),
		end: iso(b),
		title,
	});
	const p = (name: string, email: string) => ({ name, email });
	const endedKey = "0123456789abcdef";
	const dismissedKey = "fedcba9876543210";
	const confirmedKey = "abcdef0123456789";
	const review = (key: string, title: string, end: number) => ({
		...mtg(end - 30 * 60_000, end, title),
		key,
		state: "needs_review",
		prompt: "Confirm whether this meeting happened.",
	});
	const lease = {
		...mtg(meetingTime - 300_000, meetingTime + 300_000, "Lease review"),
		key: "fedcba0123456789",
		organizer: p("Example Partner One", "joe@example.test"),
		attendees: [p("Dr. Example", "dr.example@example.test")],
		location: "Example conference room",
	};
	const secondInvite = {
		...lease,
		key: "1111111111111111",
		attendees: [p("Solo Clinic", "solo@example.test")],
	};
	const endedInvite = {
		...mtg(start, now - 60_000, "Ended earlier today"),
		key: "4444444444444444",
	};
	const agenda = {
		schema: "carr-calendar-agenda.v1",
		observed_at: iso(now),
		warnings: [],
		items: [
			mtg(start - hr, start, "Yesterday midnight"),
			endedInvite,
			lease,
			secondInvite,
			{
				...lease,
				...review(confirmedKey, "End of tour", now),
			},
			mtg(end, end + hr, "Tomorrow midnight"),
		],
		follow_up_reviews: [
			review(endedKey, "Lease discussion", now),
			review(dismissedKey, "Tour debrief", now),
			review(confirmedKey, "End of tour", now),
			review("2222222222222222", "Yesterday midnight", start),
		],
	};
	const cap = { job: "mail_capture", for_user: "joe" };
	const [saved] = await save(cap, "calendar/agenda", agenda, "PUT");
	assert.equal(saved, 200);
	const [status, body] = await today();
	const m = body.meetings;
	assert.equal(status, 200);
	assert.ok(m);

	await t.test("an ended review-only meeting gets a calendar row", () => {
		assert.partialDeepStrictEqual(
			m.items.find((item) => item.key === endedKey),
			{
				title: "Lease discussion",
				attendees: [],
				location: null,
				open_url: null,
			},
		);
		assert.ok(m.follow_up_reviews.some((r) => r.key === endedKey));
	});

	await t.test(
		"distinct invites with the same title and times keep their keys and details",
		() => {
			assert.deepEqual(
				m.items
					.filter((item) => item.title === lease.title)
					.map((item) => item.key)
					.sort(),
				[lease.key, secondInvite.key].sort(),
			);
			assert.partialDeepStrictEqual(
				m.items.find((item) => item.key === lease.key),
				{
					attendees: lease.attendees,
					location: lease.location,
					open_url: `/deals?deal=${id(7)}`,
					possible_deals: [
						{
							id: id(7),
							name: "Example Dental, Springfield",
							client_name: "Example Dental",
						},
					],
				},
			);
		},
	);

	await t.test(
		"Central midnight bounds the calendar rows independently of reviews",
		() => {
			assert.deepEqual(
				m.items.map((item) => item.key).sort(),
				[
					endedKey,
					dismissedKey,
					confirmedKey,
					lease.key,
					secondInvite.key,
					endedInvite.key,
				].sort(),
			);
		},
	);

	await t.test(
		"the owner filter never switches the viewer's calendar",
		async () => {
			const dell = { user: "dell" };
			const dellInvite = { ...lease, key: "3333333333333333" };
			const [dellSaved] = await save(
				{ ...cap, for_user: dell.user },
				"calendar/agenda",
				{ ...agenda, items: [dellInvite], follow_up_reviews: [] },
				"PUT",
			);
			assert.equal(dellSaved, 200);
			const [, dellBody] = await today("?owner=joe", dell);
			assert.deepEqual(
				dellBody.meetings?.items.map((item) => item.key),
				[dellInvite.key],
			);
			assert.deepEqual(dellBody.meetings?.follow_up_reviews, []);
			const [, joeBody] = await today("?owner=dell");
			assert.ok(joeBody.meetings?.items.some((item) => item.key === lease.key));
			assert.ok(
				!joeBody.meetings?.items.some((item) => item.key === dellInvite.key),
			);
		},
	);

	await t.test(
		"a refused activity insert leaves the database clock intact",
		async () => {
			await db.query("begin");
			try {
				await db.query("select set_config('engine.user_id', $1, true)", [
					id(1),
				]);
				await assert.rejects(
					db.query(
						`insert into activity (kind, happened_at, calendar_review_user_id, calendar_review_key)
					values ('meeting', now(), $1, 'invalid-key')`,
						[id(1)],
					),
					{ code: "23514" },
				);
			} finally {
				await db.query("rollback");
			}
			const { rows } = await db.query(
				"select now() = transaction_timestamp() as uses_transaction_clock",
			);
			assert.equal(rows[0]?.uses_transaction_clock, true);
			const [, fresh] = await today();
			assert.deepEqual(fresh.meetings?.items, m.items);
		},
	);

	await t.test(
		"dismissed and confirmed meetings stay on a fresh load",
		async () => {
			const [dismissed] = await save(
				joe,
				`calendar/reviews/${dismissedKey}/dismissal`,
				{
					idempotency_key: randomUUID(),
				},
			);
			assert.equal(dismissed, 200);
			await db.query(`begin; select set_config('engine.user_id', '${id(1)}', true);
			insert into activity (kind, happened_at, calendar_review_user_id, calendar_review_key)
			values ('meeting', now(), '${id(1)}', '${confirmedKey}'); commit;`);
			const [, fresh] = await today();
			assert.deepEqual(
				fresh.meetings?.items.map((item) => item.key),
				m.items.map((item) => item.key),
			);
			assert.ok(
				fresh.meetings?.items.some((item) => item.key === dismissedKey),
			);
			assert.partialDeepStrictEqual(
				fresh.meetings?.items.filter((item) => item.key === confirmedKey),
				[
					{
						location: lease.location,
						attendees: lease.attendees,
						open_url: `/deals?deal=${id(7)}`,
					},
				],
			);
			assert.ok(
				fresh.meetings?.follow_up_reviews.some((r) => r.key === endedKey),
			);
			assert.ok(
				!fresh.meetings?.follow_up_reviews.some(
					(r) => r.key === dismissedKey || r.key === confirmedKey,
				),
			);
		},
	);
	await t.test("meetings and reminders fail independently", async () => {
		const cases = [
			["calendar_agenda", "meetings", "reminders"],
			["next_step", "reminders", "meetings"],
		] as const;
		const [, healthy] = await today();
		for (const [table, bad, good] of cases) {
			await db.query(`revoke select on ${table} from engine_reader`);
			try {
				const [status, body] = await today();
				assert.equal(status, 200);
				assert.equal(body[bad]?.state, "unavailable");
				assert.equal(typeof body[bad]?.reason, "string");
				assert.deepEqual(body[good], healthy[good]);
			} finally {
				await db.query(`grant select on ${table} to engine_reader`);
			}
		}
	});
});

test("reminder home_item_id does not depend on the inbox page limit", async () => {
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into home_update (user_id, deal_id, what, created_at)
		select '${id(1)}', '${id(7)}', 'Update ' || g, now() + interval '1 hour'
		from generate_series(1, 1001) g; commit;`);
	try {
		const inboxRes = await request(joe, "home/inbox", get, reader);
		const inbox = (await inboxRes.json()) as {
			truncated: boolean;
			items: Row[];
		};
		const cardId = `next_action:${id(21)}`;
		assert.equal(inbox.truncated, true);
		assert.equal(
			inbox.items.some((i) => i.item_id === cardId),
			false,
		);
		const [, body] = await today();
		assert.equal(
			body.reminders?.late.find((item) => item.id === id(21))?.home_item_id,
			cardId,
		);
	} finally {
		await db.query(`begin; select set_config('engine.job', 'old_system', true);
			delete from home_update where user_id = '${id(1)}'; commit;`);
	}
});
