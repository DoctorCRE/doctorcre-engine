import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { readSchema } from "./test-copy.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const owner = randomUUID();
const other = randomUUID();
const client = randomUUID();
const contact = randomUUID();
const deal = randomUUID();
const call = randomUUID();
const ordinary = randomUUID();
const meeting = randomUUID();
const proposal = randomUUID();
const meetingDeal = randomUUID();
const lostDeal = randomUUID();
const otherDealStep = randomUUID();
const completedDealStep = randomUUID();
const building = randomUUID();
const sharedBuilding = randomUUID();
const buildingStep = randomUUID();
const completedBuildingStep = randomUUID();
const sharedBuildingStep = randomUUID();
const followUp = randomUUID();
const held = randomUUID();
const leaseReminder = randomUUID();
const pastLeaseReminder = randomUUID();
const completed = randomUUID();
const completedWithoutTime = randomUUID();
const completedEightDaysAgo = randomUUID();
const canceled = randomUUID();
const otherStep = randomUUID();
const formerlyHidden = randomUUID();
const path = "home/inbox";
const reader = { HOME_INBOX_READ_SCHEMA: "next" };
const user = { user: "example-partner" };
const titleCharacters = new Intl.Segmenter("en", { granularity: "grapheme" });

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into role (slug, label) values ('vendor', 'Vendor'), ('lead', 'Lead'), ('client', 'Client');
		insert into stage (role, slug, label) values ('lead', 'new', 'New');
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into party (id, kind, name) values
			('${owner}', 'person', 'Example Partner'), ('${other}', 'person', 'Other Partner'),
			('${client}', 'company', 'Example Dental'), ('${contact}', 'person', 'Dr. Example');
		insert into app_user (id, slug) values ('${owner}', '${user.user}'), ('${other}', 'other-partner');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Dental, Springfield', '${owner}');
		insert into deal (id, name, owner_user_id) values ('${meetingDeal}', 'Example Renewal', '${owner}');
		insert into deal (id, name, owner_user_id) values ('${lostDeal}', 'Example Lost Deal', '${owner}');
		insert into phase (slug, label) values ('dead', 'Dead');
		insert into deal_phase_change (deal_id, happened_at, phase, reason)
			values ('${lostDeal}', now(), 'dead', 'Client withdrew');
		insert into property (id, address) values
			('${building}', '100 Example Way'), ('${sharedBuilding}', '200 Example Way');
		insert into deal_property (deal_id, property_id) values
			('${deal}', '${building}'), ('${lostDeal}', '${building}'),
			('${deal}', '${sharedBuilding}'), ('${meetingDeal}', '${sharedBuilding}');
		insert into activity (id, kind, happened_at, from_party_id, summary) values
			('${call}', 'call', '2026-11-17 22:30+00', '${contact}', 'Discussed the suite.'),
			('${meeting}', 'meeting', '2026-11-17 17:00+00', '${contact}', 'Discussed renewal.');
		insert into activity_about (activity_id, deal_id) values ('${call}', '${deal}');
		insert into next_step (id, deal_id, owner_party_id, what, item_title, source_ref, call_activity_id, call_evidence_quote)
			values ('${followUp}', '${deal}', '${owner}', 'Call Dr. Example about the second-floor suite', 'Call about suite',
				'call-example', '${call}', 'Please send the floor plan.');
		insert into next_step (id, party_id, owner_party_id, what, due_on, hold_until, resolution, done_at, resolution_reason) values
			('${ordinary}', '${client}', '${owner}', 'Send the lease', '2026-11-19', null, null, null, null),
			('${held}', '${contact}', '${owner}', 'HOLD — Call about the suite', null, '2999-04-01', null, null, null),
			('${completed}', '${client}', '${owner}', 'Check the budget', null, null, 'done', now() - interval '1 hour', null),
			('${completedWithoutTime}', '${client}', '${owner}', 'Review the floor plan', null, null, 'done', null, null),
			('${completedEightDaysAgo}', '${client}', '${owner}', 'Confirm the suite number', null, null, 'done', now() - interval '8 days', null),
			('${canceled}', '${client}', '${owner}', 'Tour the suite', null, null, 'cancelled', null, 'Client paused'),
			('${otherStep}', '${client}', '${other}', 'Arrange a tour', null, null, null, null, null);
		insert into next_step (id, deal_id, owner_party_id, what)
			values ('${formerlyHidden}', '${deal}', '${owner}', 'Check the lease term'),
				('${otherDealStep}', '${meetingDeal}', '${other}', 'Confirm the renewal terms');
		insert into next_step (id, deal_id, owner_party_id, what, due_on, item_title, source_ref, created_at) values
			('${leaseReminder}', '${deal}', '${owner}',
				'Lease event — Example Dental, Springfield, est. December 1, 2026. Last window before leverage is gone.',
				'2026-11-19', 'Lease event', 'lease-example', '2026-11-21T12:00Z'),
			('${pastLeaseReminder}', '${deal}', '${owner}',
				'Lease event — Example Dental, Springfield, est. October 1, 2026. The estimated renewal window has passed. Confirm renewal plans.',
				'2026-11-19', 'Lease event', 'past-lease-example', '2026-11-21T12:00Z');
		insert into next_step (id, deal_id, owner_party_id, what, resolution, done_at) values
			('${completedDealStep}', '${meetingDeal}', '${other}', 'Check the renewal budget', 'done', now());
		insert into next_step (id, property_id, owner_party_id, what, resolution, done_at) values
			('${buildingStep}', '${building}', '${other}', 'Check the building access', null, null),
			('${completedBuildingStep}', '${building}', '${other}', 'Confirm the suite', 'done', now()),
			('${sharedBuildingStep}', '${sharedBuilding}', '${other}', 'Check the site plan', null, null);
		insert into home_mark (user_id, next_step_id, disposition, snoozed_until) values
			('${owner}', '${ordinary}', 'snoozed', '2999-01-01T00:00Z'),
			('${owner}', '${held}', 'snoozed', '2000-01-01T00:00Z');
		insert into public.actor (id, slug, kind, display_name) values ('${owner}', '${user.user}', 'human', 'Example Partner');
		insert into outside_id (source, value, party_id) values ('old_system', '${owner}', '${owner}');
		insert into public.next_action (id, subject_type, subject_id, owner_id, description, status, created_by)
			values ('${formerlyHidden}', 'deal', '${deal}', '${owner}', 'Check the lease term', 'open', '${owner}');
		insert into ops.home_inbox_disposition (actor_id, item_id, disposition, snoozed_until, source_version, material_version, updated_at)
			values ('${owner}', 'next_action:${formerlyHidden}', 'settled', null, '1', 'm', '2026-10-04');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, owner_party_id)
			values ('${proposal}', 'next_step', '${meeting}', 'meeting', 'The meeting started at 2026-11-06T01:00:00Z.',
				'old_system', '${meetingDeal}', 'Check renewal dates on Thursday 2026-11-05', '${owner}');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${owner}', true);
		update proposal set status = 'accepted' where id = '${proposal}';
		commit;`);
	const copyPreferences = await readSchema("copy-preferences.sql");
	await db.query(`begin; ${copyPreferences}; commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function inbox(caller = user) {
	const response = await request(caller, path, { method: "GET" }, reader);
	assert.equal(response.status, 200);
	const result: unknown = await response.json();
	assert.ok(isArguments(result) && Array.isArray(result.items));
	assert.partialDeepStrictEqual(result, {
		ok: true,
		schema_version: "home-inbox.v5",
		home_mark_drop: true,
		home_proposal_drop: true,
		truncated: false,
	});
	assert.equal(Object.hasOwn(result, "auto_settle_enabled"), false);
	const items = result.items.filter(isArguments);
	for (const item of items) {
		assert.ok(typeof item.title === "string");
		assert.ok([...titleCharacters.segment(item.title)].length <= 90);
		assert.equal(Object.hasOwn(item, "auto_settled"), false);
		assert.equal(Object.hasOwn(item, "explicit_unsettle"), false);
	}
	return new Map(items.map((item) => [item.source_id, item]));
}

test("dashboard counts only eligible cards and separates waiting from deal and vendor reminders", async () => {
	const viewer = randomUUID();
	const dashboardDeal = randomUUID();
	const [vendor, lead, sleepingLead, client] = Array.from(
		{ length: 4 },
		randomUUID,
	);
	const [
		open,
		dueToday,
		future,
		held,
		done,
		vendorStep,
		leadStep,
		sleepingLeadStep,
		clientStep,
		buildingTask,
		checklist,
		feedback,
	] = Array.from({ length: 12 }, randomUUID);
	await db
		.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${viewer}', 'person', 'Dashboard Viewer'), ('${vendor}', 'company', 'Example Surveyors'),
			('${lead}', 'person', 'Example Lead'), ('${sleepingLead}', 'person', 'Another Example Lead'),
			('${client}', 'company', 'Example Company');
		update party set how_found = 'referral' where id in ('${lead}', '${sleepingLead}');
		insert into app_user (id, slug) values ('${viewer}', 'dashboard-viewer');
		insert into party_role (party_id, role, stage) values
			('${vendor}', 'vendor', null), ('${lead}', 'lead', 'new'), ('${sleepingLead}', 'lead', 'new'),
			('${lead}', 'client', null);
		insert into deal (id, name, owner_user_id) values ('${dashboardDeal}', 'Example Dashboard Deal', '${viewer}');
		insert into deal_party (deal_id, party_id, role) values ('${dashboardDeal}', '${lead}', 'client');
		with day as (select (now() at time zone 'America/Chicago')::date as today)
		insert into next_step (id, owner_party_id, deal_id, party_id, what, due_on, hold_until, item_title, source_ref, resolution, done_at)
		select v.id::uuid, '${viewer}', v.deal_id::uuid, v.party_id::uuid,
			'Check the plan', day.today + days, day.today + hold, v.title, v.src,
			v.resolution, case when v.resolution = 'done' then now() end
		from day cross join (values
			('${open}', '${dashboardDeal}', null, -3, null, 'Check Site Plan', 'present', null),
			('${dueToday}', '${dashboardDeal}', null, 0, null, 'Check Site Plan', 'today', null),
			('${future}', '${dashboardDeal}', null, 1, null, 'Confirm Site Visit', 'future', null),
			('${held}', '${meetingDeal}', null, null, 2, null, null, null),
			('${done}', '${deal}', null, -2, null, null, null, 'done'),
			('${vendorStep}', null, '${vendor}', -1, null, null, null, null),
			('${leadStep}', null, '${lead}', -2, null, null, null, null),
			('${sleepingLeadStep}', null, '${sleepingLead}', 0, 1, null, null, null),
			('${clientStep}', null, '${client}', -2, null, null, null, null)
		) v(id, deal_id, party_id, days, hold, title, src, resolution);
		insert into next_step (id, property_id, owner_party_id, what, due_on)
			values ('${buildingTask}', '${sharedBuilding}', '${viewer}', 'Check site access',
				(now() at time zone 'America/Chicago')::date - 2);
		insert into home_mark (user_id, next_step_id, disposition, snoozed_until) values
			('${viewer}', '${sleepingLeadStep}', 'snoozed', '2999-01-01');
		insert into home_update (user_id, deal_id, what, created_at)
			select '${viewer}', '${deal}', 'Informational update ' || g, now() + interval '1 hour'
			from generate_series(1, 1001) g;
		insert into home_update (id, user_id, deal_id, what, checklist_item_ref, due_on)
			values ('${checklist}', '${viewer}', '${deal}', 'Check the plans', 'survey/item', '2001-01-01');
		insert into home_update (user_id, deal_id, what, checklist_item_ref, due_on)
			select '${viewer}', deal_id, what, 'deal-item:' || id, due_on
			from next_step where id in ('${open}', '${future}');
		insert into home_update (id, user_id, deal_id, kind, property_id, what)
			values ('${feedback}', '${viewer}', '${deal}', 'tour_feedback', '${building}', 'Parking felt tight');
		commit;`)
		.catch(async (error: unknown) => {
			await db.query("rollback");
			throw error;
		});
	const caller = { user: "dashboard-viewer" };
	const read = async () => {
		const response = await request(
			caller,
			`${path}?view=dashboard`,
			{ method: "GET" },
			reader,
		);
		assert.equal(response.status, 200);
		const result: unknown = await response.json();
		assert.ok(
			isArguments(result) &&
				isArguments(result.reminders) &&
				isArguments(result.waiting),
		);
		const group = (value: Record<string, unknown>) => {
			assert.ok(Array.isArray(value.items));
			assert.equal(value.count, value.items.length);
			const items = new Map(
				value.items.filter(isArguments).map((card) => [card.source_id, card]),
			);
			assert.equal(items.size, value.count);
			return items;
		};
		return {
			reminders: group(result.reminders),
			waiting: group(result.waiting),
		};
	};
	const { reminders, waiting } = await read();
	assert.deepEqual(
		new Set(reminders.keys()),
		new Set([open, dueToday, vendorStep, buildingTask, checklist, feedback]),
	);
	assert.deepEqual([...waiting.keys()], [held]);
	assert.partialDeepStrictEqual(reminders.get(open), {
		item_id: `next_action:${open}`,
		card_id: `next_action:${open}`,
		open_url: `/deals?deal=${dashboardDeal}&focus=next-step&step=${open}`,
		days_late: 3,
		late_label: "3 days late",
	});
	assert.partialDeepStrictEqual(reminders.get(vendorStep), {
		days_late: 1,
		late_label: "1 day late",
	});
	assert.partialDeepStrictEqual(reminders.get(dueToday), {
		item_id: `next_action:${dueToday}`,
		days_late: null,
		late_label: null,
	});
	assert.partialDeepStrictEqual(reminders.get(buildingTask), {
		days_late: null,
		late_label: null,
		open_url: null,
	});
	assert.partialDeepStrictEqual(reminders.get(feedback), {
		open_url: `/deals?deal=${deal}&property=${building}`,
	});
	assert.partialDeepStrictEqual(waiting.get(held), {
		waiting_reason: "On hold",
		primary_action: null,
		days_late: null,
	});
	assert.equal(waiting.get(held)?.returns_at, waiting.get(held)?.hold_until);
	const next = await read();
	assert.deepEqual([...next.reminders.values()], [...reminders.values()]);
	assert.deepEqual([...next.waiting.values()], [...waiting.values()]);
});

test("switch off leaves the inbox on CARR and the read refuses a caller-supplied actor", async () => {
	assert.equal((await request(user, path, { method: "GET" })).status, 404);
	assert.equal(
		(
			await request(
				user,
				`${path}?actor=other-partner`,
				{ method: "GET" },
				reader,
			)
		).status,
		403,
	);
});

test("Home reads a partner's steps, holds, completion and marks", async () => {
	const items = await inbox();
	assert.deepEqual(
		{
			completionWithoutTime: items.has(completedWithoutTime),
			completionEightDaysAgo: items.has(completedEightDaysAgo),
		},
		{ completionWithoutTime: false, completionEightDaysAgo: false },
	);
	assert.deepEqual(
		new Set(items.keys()),
		new Set([
			ordinary,
			followUp,
			held,
			completed,
			formerlyHidden,
			proposal,
			leaseReminder,
			pastLeaseReminder,
		]),
	);
	assert.partialDeepStrictEqual(items.get(ordinary), {
		item_id: `next_action:${ordinary}`,
		title: "Send the lease",
		primary_action: "Mark done",
		context_label: "Example Dental",
		due_on: "2026-11-19",
		open_url: `/relationships?node=party:${client}&step=${ordinary}`,
		section: "snoozed",
		snoozed_until: "2999-01-01T00:00:00.000Z",
		action_id: ordinary,
	});
	assert.partialDeepStrictEqual(items.get(held), {
		section: "held",
		hold_until: "2999-04-01T05:00:00.000Z",
		snoozed_until: null,
	});
	assert.partialDeepStrictEqual(items.get(completed), {
		source_state: "done",
		disposition: "inbox",
		section: "done",
	});
	assert.equal(typeof items.get(completed)?.completed_at, "string");
	assert.partialDeepStrictEqual(items.get(formerlyHidden), {
		disposition: "inbox",
		section: "inbox",
	});
	assert.equal(
		(
			await db.query("select from home_mark where next_step_id = $1", [
				formerlyHidden,
			])
		).rowCount,
		0,
	);

	const otherItems = await inbox({ user: "other-partner" });
	assert.deepEqual(
		new Set(otherItems.keys()),
		new Set([
			otherStep,
			otherDealStep,
			completedDealStep,
			buildingStep,
			completedBuildingStep,
			sharedBuildingStep,
		]),
	);
	assert.equal(otherItems.get(otherStep)?.section, "inbox");
});

test("A held follow-up explains the saved hold and action in plain words", async () => {
	assert.partialDeepStrictEqual((await inbox()).get(held), {
		title: "Call about the suite",
		why: "Held until Apr 1, 2999. Call about the suite.",
	});
});

test("A long lease reminder keeps the full event wording in the why line", async () => {
	assert.partialDeepStrictEqual((await inbox()).get(leaseReminder), {
		title: "Follow up on Example Dental, Springfield",
		why: "Follow-up set on Nov 21, 2026. Due Nov 19, 2026. Lease event — Example Dental, Springfield, est. December 1, 2026. Last window before leverage is gone.",
	});
});

test("A long lease reminder keeps both the event and the saved instruction", async () => {
	assert.partialDeepStrictEqual((await inbox()).get(pastLeaseReminder), {
		title: "Follow up on Example Dental, Springfield",
		why: "Follow-up set on Nov 21, 2026. Due Nov 19, 2026. Lease event — Example Dental, Springfield, est. October 1, 2026. The estimated renewal window has passed. Confirm renewal plans.",
	});
});

test("a call follow-up appears once with its call, deal and evidence", async () => {
	const item = (await inbox()).get(followUp);
	assert.ok(item);
	assert.equal(Object.hasOwn(item, "source_ref"), false);
	assert.partialDeepStrictEqual(item, {
		item_id: `capture_post_call_action:${followUp}`,
		title: "Call Dr. Example about the second-floor suite",
		why: "Call with Dr. Example on Nov 17, 2026. Please send the floor plan.",
		primary_action: "Mark done",
		kind_label: "Call follow-up",
		section: "inbox",
		open_url: `/calls?session=${call}`,
		deal_id: deal,
		action_id: followUp,
		merged_source_ids: [followUp],
		source_activity: {
			kind: "call",
			id: call,
			happened_at: "2026-11-17T22:30:00.000Z",
			contact: "Dr. Example",
			summary: "Discussed the suite.",
			quote: "Please send the floor plan.",
		},
	});
});

test("a step created by a suggestion keeps the meeting source", async () => {
	assert.partialDeepStrictEqual((await inbox()).get(proposal), {
		title: "Check renewal dates on Thursday, Nov 5, 2026",
		why: "Follow-up set from the meeting. The meeting started at Nov 5, 2026, 7:00 PM.",
		source_activity: { kind: "meeting", id: meeting },
	});
});

test("Home keeps separate vendor follow-ups from the same meeting", async () => {
	const steps = ["Amber", "Birch", "Cedar", "Dawn"].map((name, index) => ({
		id: randomUUID(),
		party: randomUUID(),
		name,
		what: `Planning meeting: Call ${name}${index === 0 ? " (T-041)" : ""}`,
	}));
	await db.query(`begin; select set_config('engine.job', 'old_system', true);`);
	for (const step of steps) {
		await db.query(
			"insert into party (id, kind, name) values ($1, 'company', $2)",
			[step.party, step.name],
		);
		await db.query(
			"insert into party_role (party_id, role) values ($1, 'vendor')",
			[step.party],
		);
		await db.query(
			"insert into next_step (id, party_id, owner_party_id, what, due_on) values ($1, $2, $3, $4, '2026-11-19')",
			[step.id, step.party, other, step.what],
		);
	}
	await db.query("commit");
	const items = await inbox({ user: "other-partner" });
	for (const step of steps) {
		assert.partialDeepStrictEqual(items.get(step.id), {
			title: `Planning meeting: Call ${step.name}`,
			open_url: `/relationships?node=party:${step.party}&step=${step.id}`,
		});
	}
});

test("Home keeps undated steps and cleans their titles without rewriting saved wording", async () => {
	const examples = (
		[
			["L-223: **Call** about the suite", "Call about the suite"],
			[
				"Email about the report (V-ABC-012), then call.",
				"Email about the report, then call.",
			],
			["T-3 months — Confirm lease timing", "Confirm lease timing"],
			[
				"Check in with Example Vendor (T-137).",
				"Check in with Example Vendor.",
			],
			["Review the floor plan [loop #25]", "Review the floor plan"],
			[
				"Call (L-223, due Friday) about the suite",
				"Call (due Friday) about the suite",
			],
			[
				"Call (due Friday, C-026) about the suite",
				"Call (due Friday) about the suite",
			],
			[
				"Call (— if available) about the suite",
				"Call (— if available) about the suite",
			],
			[
				"Review the [plan](https://example.test/plan) with _the client_.",
				"Review the plan with the client.",
			],
			["Draft the lease amendment", "Draft the lease amendment"],
			[
				"Schedule the next check-in with the office manager",
				"Schedule the next check-in with the office manager",
			],
			["Schedule the next follow-up", "Schedule the next follow-up"],
			["L-456 — Timing", "Timing"],
			[
				"Review follow-up: Refer a broker to Maya Reed",
				"Refer a broker to Maya Reed",
			],
			["NONE — Check in after June", "Check in after June"],
			["C-026", ""],
		] as const
	).map(([what, title]) => ({
		id: randomUUID(),
		party: randomUUID(),
		what,
		title,
	}));
	await db.query(`begin; select set_config('engine.job', 'old_system', true);`);
	for (const { id, party, what } of examples) {
		await db.query(
			"insert into party (id, kind, name) values ($1, 'company', 'Example Vendor')",
			[party],
		);
		await db.query(
			"insert into party_role (party_id, role) values ($1, 'vendor')",
			[party],
		);
		await db.query(
			"insert into next_step (id, party_id, owner_party_id, what, created_at) values ($1, $2, $3, $4, '2026-11-17T12:00Z')",
			[id, party, other, what],
		);
	}
	await db.query("commit");
	const response = await request(
		{ user: "other-partner" },
		path,
		{ method: "GET" },
		reader,
	);
	assert.equal(response.status, 200);
	const result: unknown = await response.json();
	assert.ok(isArguments(result) && Array.isArray(result.items));
	const items = result.items.filter(isArguments);
	for (const example of examples) {
		assert.partialDeepStrictEqual(
			items.filter((item) => item.source_id === example.id),
			[
				{
					title: example.title || "Follow up on Example Vendor",
					why: `Follow-up set on Nov 17, 2026.${example.title ? ` ${example.title.replace(/\.$/, "")}.` : ""}`,
					primary_action: "Mark done",
					due_on: null,
					open_url: `/relationships?node=party:${example.party}&step=${example.id}`,
				},
			],
		);
		assert.deepEqual(
			(
				await db.query("select what, status from next_step where id = $1", [
					example.id,
				])
			).rows,
			[{ what: example.what, status: "open" }],
		);
	}
	assert.equal(Object.hasOwn(result, "unexplained_step_count"), false);
});

const longAction =
	"Confirm the accessibility requirements for the proposed suite with the landlord and ask for the revised drawing in writing";
const accentedAction =
	"Send the revised plan to Rene\u0301e at Example Lost Deal with the extra icons 📐 📍 📎 🗂 🏢 🔑";
const followUpFallback = "Follow up on Example Lost Deal";

for (const [scenario, what, title, savedText = what] of [
	[
		"a long step with a short first sentence",
		`Send the site plan. ${longAction}.`,
		followUpFallback,
	],
	["a long instruction", longAction, followUpFallback],
	[
		"an initial in a long instruction",
		"Send the revised floor plan to Á. Morgan and include the accessibility notes from the most recent walkthrough",
		followUpFallback,
	],
	[
		"a long call with common abbreviations",
		`Call Dr. Example and Mr. Reed at St. Example Inc. about the plan. ${longAction}.`,
		followUpFallback,
	],
	[
		"a call from the office",
		"Call from the office at noon",
		"Call from the office at noon",
	],
	[
		"a forwarded email",
		"Forward the email from Morgan to the landlord",
		"Forward the email from Morgan to the landlord",
	],
	[
		"a copied sender label",
		"Email from Morgan Example",
		"Email from Morgan Example",
	],
	[
		"a copied receipt label",
		"Email received from Morgan",
		"Email received from Morgan",
	],
	[
		"a step starting with Forward",
		"Forward the revised floor plan to Morgan",
		"Forward the revised floor plan to Morgan",
	],
	[
		"a short step with two sentences",
		"Call Á. Morgan. Confirm the date.",
		"Call Á. Morgan. Confirm the date.",
	],
	["copied wording with an ellipsis", "Send the plan...", "Send the plan..."],
	[
		"a copied status label",
		"Follow-up set for Morgan Example",
		"Follow-up set for Morgan Example",
	],
	[
		"stacked copied prefixes",
		"REVIEWER DECIDE: review follow-up: Send the plan",
		"Send the plan",
		"Send the plan",
	],
	["an action with an accented name and emoji", accentedAction, accentedAction],
] as const) {
	test(`Home titles use the complete action or decision for ${scenario}`, async () => {
		const step = randomUUID();
		await db.query("begin");
		try {
			await db.query("select set_config('engine.job', 'old_system', true)");
			await db.query(
				"insert into next_step (id, deal_id, owner_party_id, what) values ($1, $2, $3, $4)",
				[step, lostDeal, other, what],
			);
			await db.query("commit");
			const card = (await inbox({ user: "other-partner" })).get(step);
			assert.ok(card);
			assert.equal(card.title, title);
			assert.ok(typeof card.why === "string" && card.why.includes(savedText));
		} finally {
			await db.query("rollback");
			await db.query("begin");
			await db.query("select set_config('engine.job', 'old_system', true)");
			await db.query("delete from next_step where id = $1", [step]);
			await db.query("commit");
		}
	});
}

test("the focused deal step names its creator and source after a later edit", async () => {
	await db.query(`begin;
		select set_config('engine.user_id', '${other}', true);
		update next_step set due_on = '2026-12-02' where id = '${proposal}';
	commit;`);
	const response = await request(
		user,
		`deals/${meetingDeal}`,
		{ method: "GET" },
		{
			DEALS_READ_SCHEMA: "next",
		},
	);
	assert.equal(response.status, 200);
	const page: unknown = await response.json();
	assert.ok(isArguments(page) && Array.isArray(page.next_actions));
	const step: unknown = page.next_actions.find(
		(row: unknown) => isArguments(row) && row.id === proposal,
	);
	assert.ok(isArguments(step) && typeof step.set_at === "string");
	assert.partialDeepStrictEqual(step, {
		due_on: "2026-12-02",
		set_by: "Example Partner",
		set_from: "meeting",
	});
	assert.ok(Number.isFinite(Date.parse(step.set_at)));
});

test("each partner's Home link names their open step on the same deal", async () => {
	const ownerItems = await inbox();
	const otherItems = await inbox({ user: "other-partner" });
	assert.deepEqual(
		[
			ownerItems.get(proposal)?.open_url,
			otherItems.get(otherDealStep)?.open_url,
		],
		[
			`/deals?deal=${meetingDeal}&focus=next-step&step=${proposal}`,
			`/deals?deal=${meetingDeal}&focus=next-step&step=${otherDealStep}`,
		],
	);
	assert.equal(
		otherItems.get(completedDealStep)?.open_url,
		`/deals?deal=${meetingDeal}&focus=next-step&step=${completedDealStep}`,
	);
});

test("open and done building-only steps link to their building's sole open deal", async () => {
	const items = await inbox({ user: "other-partner" });
	assert.equal(items.get(buildingStep)?.open_url, `/deals?deal=${deal}`);
	assert.partialDeepStrictEqual(items.get(completedBuildingStep), {
		source_state: "done",
		disposition: "inbox",
		section: "done",
		open_url: `/deals?deal=${deal}`,
	});
	assert.equal(items.get(sharedBuildingStep)?.open_url, null);
});

test("a partner can undo their own current completion after reloading Home", async () => {
	const step = randomUUID();
	const party = randomUUID();
	await db.query(`begin;
		select set_config('engine.user_id', '${owner}', true);
		insert into party (id, kind, name) values ('${party}', 'person', 'Example Contact');
		insert into next_step (id, party_id, owner_party_id, what)
			values ('${step}', '${party}', '${owner}', 'Confirm sample terms');
		commit;`);
	const before = (await inbox()).get(step);
	const [status, receipt] = await save(user, `next-steps/${step}/end`, {
		idempotency_key: randomUUID(),
		base_version: before?.action_version,
		resolution: "done",
	});
	assert.equal(status, 200);
	const done = await inbox();
	assert.equal(done.get(completed)?.undo_completion, false);
	assert.partialDeepStrictEqual(done.get(step), {
		section: "done",
		action_version: receipt.change_id,
		undo_completion: true,
	});
	const [reopened] = await save(user, `next-steps/${step}/reopen`, {
		idempotency_key: randomUUID(),
		base_version: done.get(step)?.action_version,
	});
	assert.equal(reopened, 200);
	assert.partialDeepStrictEqual((await inbox()).get(step), {
		source_state: "needs_attention",
		undo_completion: false,
	});
});
