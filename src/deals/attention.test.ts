import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { nextTransaction } from "../next-connection.ts";
import { copyTest } from "../test-copy.ts";
import { readNextBoard } from "./next-board.ts";
import { readNextDealDetail } from "./next-detail.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const joe = id(1);
const dell = id(2);
const clinic = id(3);
const broker = id(4);
const fresh = () => randomUUID();

const centralToday = () =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Chicago",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());

const addDays = (day: string, count: number) => {
	const [year, month, date] = day.split("-").map(Number);
	return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) + count))
		.toISOString()
		.slice(0, 10);
};

const weekday = (day: string) => {
	const [year, month, date] = day.split("-").map(Number);
	const index = new Date(
		Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1),
	).getUTCDay();
	return index === 0 ? 7 : index;
};

// The second Monday–Friday strictly after the email's Central day.
const secondWorkingDayAfter = (day: string) => {
	let cursor = day;
	let found = 0;
	while (found < 2) {
		cursor = addDays(cursor, 1);
		if (weekday(cursor) < 6) found += 1;
	}
	return cursor;
};

const at = (day: string) => `'${day} 12:00:00 America/Chicago'`;

const { db, setup, cleanup, connectionString } = copyTest();
const today = centralToday();

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into role (slug, label) values
			('client', 'Client'), ('client_contact', 'Client contact'),
			('listing_agent', 'Listing agent'), ('landlord_rep', 'Landlord rep');
		insert into phase (slug, label) values ('closed', 'Closed'), ('negotiation', 'Negotiation');
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Joe'), ('${dell}', 'person', 'Dell'),
			('${broker}', 'person', 'Example Broker');
		insert into party (id, kind, name, how_found) values
			('${clinic}', 'company', 'Example Clinic', 'referral');
		insert into party_role (party_id, role) values ('${clinic}', 'client');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into party_email (party_id, address, label) values
			('${joe}', 'joe@example.test', 'work'), ('${dell}', 'dell@example.test', 'work'),
			('${clinic}', 'clinic@example.test', 'work'), ('${broker}', 'broker@example.test', 'work');
		commit;`);
});
after(cleanup);

const runSql = async (text: string) => {
	try {
		await db.query(text);
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
};
const job = (text: string) =>
	runSql(
		`begin; select set_config('engine.job', 'old_system', true); ${text} commit;`,
	);
const asJoe = (text: string) =>
	runSql(`begin; select set_config('engine.job', '', true);
		select set_config('engine.user_id', '${joe}', true); ${text} commit;`);

async function deal(name: string, createdOn = today) {
	const dealId = fresh();
	await job(`insert into deal (id, name, owner_user_id, created_at) values
		('${dealId}', '${name}', '${joe}', ${at(createdOn)});
		insert into deal_party (deal_id, party_id, role) values
		('${dealId}', '${clinic}', 'client');`);
	return dealId;
}

async function step(
	dealId: string,
	dueOn: string,
	createdOn = today,
	resolution?: { kind: "done" | "cancelled"; on: string },
	owner = joe,
) {
	const stepId = fresh();
	const ending =
		resolution?.kind === "done"
			? `, resolution, done_at) values ('${stepId}', '${dealId}', '${owner}', 'Send the survey', '${dueOn}', ${at(createdOn)}, 'done', ${at(resolution.on)})`
			: resolution?.kind === "cancelled"
				? `, resolution, resolution_reason, resolved_at) values ('${stepId}', '${dealId}', '${owner}', 'Send the survey', '${dueOn}', ${at(createdOn)}, 'cancelled', 'Example stop', ${at(resolution.on)})`
				: `) values ('${stepId}', '${dealId}', '${owner}', 'Send the survey', '${dueOn}', ${at(createdOn)})`;
	await job(
		`insert into next_step (id, deal_id, owner_party_id, what, due_on, created_at ${ending};`,
	);
}

async function mail(
	dealId: string,
	on: string,
	sender: string,
	conversation: string | null,
) {
	const activityId = fresh();
	const thread = conversation === null ? "null" : `'${conversation}'`;
	await job(`insert into activity (id, kind, happened_at) values
		('${activityId}', 'email', ${at(on)});
		insert into email (activity_id, message_id, conversation_id, sender, subject, body) values
		('${activityId}', '<${activityId}@example.test>', ${thread}, '${sender}', 'Example survey', 'Please send the survey.');
		insert into activity_about (activity_id, deal_id) values ('${activityId}', '${dealId}');`);
}

async function suggestion(dealId: string, on: string) {
	const activityId = fresh();
	const proposalId = fresh();
	await job(`insert into activity (id, kind, happened_at) values
		('${activityId}', 'meeting', ${at(on)});
		insert into activity_about (activity_id, deal_id) values ('${activityId}', '${dealId}');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, created_at)
		values ('${proposalId}', 'next_step', '${activityId}', 'meeting', 'Example evidence', 'old_system',
			'${dealId}', 'Send the survey', ${at(on)});`);
}

async function seen(dealId: string) {
	const page = await nextTransaction(connectionString, "read", (tx) =>
		readNextDealDetail(tx, dealId),
	);
	assert.ok(!("error" in page));
	const board = await nextTransaction(connectionString, "read", (tx) =>
		readNextBoard(tx, { partner: "joe" }),
	);
	const card = board.deals.find((row) => row.id === dealId);
	if (card) assert.deepEqual(card.attention, page.attention);
	return { attention: page.attention, onBoard: card !== undefined, board };
}

test("a late open step is the reason, and a due-today or checklist step is not", async () => {
	const late = await deal("Example late survey", addDays(today, -30));
	await step(late, addDays(today, -1), addDays(today, -20));
	await step(late, addDays(today, -3), addDays(today, -20), undefined, dell);
	const dueToday = await deal("Example due today");
	await step(dueToday, today);
	const checklist = await deal("Example checklist only");
	await step(checklist, addDays(today, 7));
	await job(`insert into next_step (deal_id, what, item_title, source_ref, due_on) values
		('${checklist}', 'Send the survey', 'Send survey', 'Example checklist', '${addDays(today, -2)}');`);
	const parked = await deal("Example parked late", addDays(today, -30));
	await step(parked, addDays(today, -2), addDays(today, -20));
	await asJoe(
		`update deal set parking_reason = 'other' where id = '${parked}';`,
	);
	const ended = await deal("Example ended late", addDays(today, -30));
	await step(ended, addDays(today, -2), addDays(today, -20));
	await job(`insert into deal_phase_change (deal_id, happened_at, phase) values
		('${ended}', now(), 'closed');`);

	const lateSeen = await seen(late);
	assert.deepEqual(lateSeen.attention, {
		reason: "A next step is late.",
		since: addDays(today, -2),
	});
	assert.equal(lateSeen.onBoard, true);
	assert.equal((await seen(dueToday)).attention, null);
	assert.equal((await seen(checklist)).attention, null);
	const parkedSeen = await seen(parked);
	assert.equal(parkedSeen.attention, null);
	assert.equal(parkedSeen.onBoard, true);
	const endedSeen = await seen(ended);
	assert.equal(endedSeen.attention, null);
	assert.equal(endedSeen.onBoard, false);
});

test("a critical date inside 7 days is the reason, and a later or dropped one is not", async () => {
	const soon = await deal("Example date soon");
	await step(soon, addDays(today, 14));
	await job(`insert into critical_date (deal_id, kind, due_on, source) values
		('${soon}', 'loi_expiry', '${addDays(today, 7)}', 'Example lease'),
		('${soon}', 'lease_end', '${addDays(today, 3)}', 'Example lease');`);
	const later = await deal("Example date later");
	await step(later, addDays(today, 14));
	const dropped = fresh();
	await job(`insert into critical_date (id, deal_id, kind, due_on, source) values
		('${dropped}', '${later}', 'loi_expiry', '${addDays(today, -1)}', 'Example lease'),
		(gen_random_uuid(), '${later}', 'lease_end', '${addDays(today, 8)}', 'Example lease');`);
	await asJoe(
		`update critical_date set status = 'dropped', resolution_reason = 'Example drop' where id = '${dropped}';`,
	);

	assert.deepEqual((await seen(soon)).attention, {
		reason: "A critical date is within 7 days or past and not done.",
		since: addDays(today, -4),
	});
	assert.equal((await seen(later)).attention, null);
});

test("a deal with no step and no suggestion says so, from the day the work stopped", async () => {
	const bare = await deal("Example no step");
	const finished = await deal("Example finished step", addDays(today, -30));
	await step(finished, addDays(today, -10), addDays(today, -20), {
		kind: "done",
		on: addDays(today, -4),
	});
	const cancelled = await deal("Example cancelled step", addDays(today, -30));
	await step(cancelled, addDays(today, -10), addDays(today, -20), {
		kind: "cancelled",
		on: addDays(today, -3),
	});
	const covered = await deal("Example has a step");
	await step(covered, addDays(today, 7));

	assert.deepEqual((await seen(bare)).attention, {
		reason: "This deal has no next step and no suggestion.",
		since: today,
	});
	assert.deepEqual((await seen(finished)).attention, {
		reason: "This deal has no next step and no suggestion.",
		since: addDays(today, -4),
	});
	assert.deepEqual((await seen(cancelled)).attention, {
		reason: "This deal has no next step and no suggestion.",
		since: addDays(today, -3),
	});
	assert.equal((await seen(covered)).attention, null);
});

test("an unanswered client or broker email waits two working days", async () => {
	const sentOn = addDays(today, -7);
	const since = secondWorkingDayAfter(sentOn);
	assert.ok(since <= today);
	const waiting = await deal("Example waiting email");
	await step(waiting, addDays(today, 7));
	await mail(waiting, sentOn, "clinic@example.test", "example-thread");
	const fromBroker = await deal("Example broker email");
	await step(fromBroker, addDays(today, 7));
	await job(`insert into deal_party (deal_id, party_id, role) values
		('${fromBroker}', '${broker}', 'listing_agent');`);
	await mail(fromBroker, sentOn, "broker@example.test", "broker-thread");
	const freshMail = await deal("Example fresh email");
	await step(freshMail, addDays(today, 7));
	await mail(freshMail, today, "clinic@example.test", "fresh-thread");
	const stranger = await deal("Example stranger email");
	await step(stranger, addDays(today, 7));
	await mail(stranger, sentOn, "stranger@example.test", "stranger-thread");
	const answered = await deal("Example answered email");
	await step(answered, addDays(today, 7));
	await mail(answered, sentOn, "clinic@example.test", "answered-thread");
	await mail(
		answered,
		addDays(sentOn, 1),
		"dell@example.test",
		"answered-thread",
	);
	const otherThread = await deal("Example other thread");
	await step(otherThread, addDays(today, 7));
	await mail(otherThread, sentOn, "clinic@example.test", "client-thread");
	await mail(
		otherThread,
		addDays(sentOn, 1),
		"dell@example.test",
		"partner-thread",
	);
	const noThread = await deal("Example no thread");
	await step(noThread, addDays(today, 7));
	await mail(noThread, sentOn, "clinic@example.test", null);
	await mail(noThread, addDays(sentOn, 1), "dell@example.test", "some-thread");
	const stillOpen = await deal("Example open no thread");
	await step(stillOpen, addDays(today, 7));
	await mail(stillOpen, sentOn, "clinic@example.test", null);

	const expected = {
		reason: "A client or broker email has had no answer for 2 working days.",
		since,
	};
	assert.deepEqual((await seen(waiting)).attention, expected);
	assert.deepEqual((await seen(fromBroker)).attention, expected);
	assert.deepEqual((await seen(otherThread)).attention, expected);
	assert.deepEqual((await seen(stillOpen)).attention, expected);
	assert.equal((await seen(freshMail)).attention, null);
	assert.equal((await seen(stranger)).attention, null);
	assert.equal((await seen(answered)).attention, null);
	assert.equal((await seen(noThread)).attention, null);
});

test("a suggestion that has waited two calendar days is the reason", async () => {
	const waited = await deal("Example old suggestion");
	await suggestion(waited, addDays(today, -2));
	const recent = await deal("Example new suggestion");
	await suggestion(recent, addDays(today, -1));

	assert.deepEqual((await seen(waited)).attention, {
		reason: "A suggestion has waited 2 days.",
		since: today,
	});
	assert.equal((await seen(recent)).attention, null);
});

test("fourteen quiet days is the reason when a step is still open, and it sorts first", async () => {
	const quiet = await deal("Example Zebra quiet", addDays(today, -30));
	await step(quiet, addDays(today, 7), addDays(today, -30));
	const activityId = fresh();
	await job(`insert into activity (id, kind, happened_at, summary) values
		('${activityId}', 'note', ${at(addDays(today, -14))}, 'Example note');
		insert into activity_about (activity_id, deal_id) values ('${activityId}', '${quiet}');`);
	const recent = await deal("Example recent note", addDays(today, -30));
	await step(recent, addDays(today, 7), addDays(today, -30));
	const recentActivity = fresh();
	await job(`insert into activity (id, kind, happened_at, summary) values
		('${recentActivity}', 'note', ${at(addDays(today, -13))}, 'Example note');
		insert into activity_about (activity_id, deal_id) values ('${recentActivity}', '${recent}');`);
	const calm = await deal("Example Alpha calm");
	await step(calm, addDays(today, 7));

	assert.deepEqual((await seen(quiet)).attention, {
		reason: "Nothing has happened for 14 days.",
		since: today,
	});
	assert.equal((await seen(recent)).attention, null);
	const board = await nextTransaction(connectionString, "read", (tx) =>
		readNextBoard(tx, { partner: "joe" }),
	);
	const quietAt = board.deals.findIndex((row) => row.id === quiet);
	const calmAt = board.deals.findIndex((row) => row.id === calm);
	assert.ok(quietAt >= 0 && calmAt > quietAt);
});

test("a hand-set flag is not the deal's attention", async () => {
	const flagged = await deal("Example flagged");
	await step(flagged, addDays(today, 7));
	await asJoe(
		`update deal set needs_attention = true where id = '${flagged}';`,
	);
	const { rows } = await db.query<{ needs_attention: boolean }>(
		"select needs_attention from deal where id = $1",
		[flagged],
	);
	assert.equal(rows[0]?.needs_attention, true);
	assert.equal((await seen(flagged)).attention, null);
});

test("an invoiced deal with a late step answers null", async () => {
	const invoiced = await deal("Example invoiced late", addDays(today, -30));
	await step(invoiced, addDays(today, -2), addDays(today, -20));
	await job(`insert into imported_deal_invoiced (deal_id, invoiced_on) values
		('${invoiced}', '${today}');`);

	const result = await seen(invoiced);
	assert.equal(result.attention, null);
	assert.equal(result.onBoard, false);
});

test("imported history that ends a deal answers null", async () => {
	const ended = await deal("Example imported ended", addDays(today, -30));
	await step(ended, addDays(today, -2), addDays(today, -20));
	const happened = "2020-01-15 15:00:00+00";
	await job(`insert into deal_phase_change (deal_id, happened_at, phase) values
		('${ended}', '${happened}', 'negotiation');
		insert into imported_deal_board (deal_id, phase, phase_at, outcome, closed_on) values
		('${ended}', 'closed', '${happened}', 'won', '2020-01-15');`);

	const result = await seen(ended);
	assert.equal(result.attention, null);
	assert.equal(result.onBoard, false);
});

test("the first matching rule wins when two rules match", async () => {
	const lateAndDated = await deal(
		"Example late and dated",
		addDays(today, -30),
	);
	await step(lateAndDated, addDays(today, -1), addDays(today, -20));
	await job(`insert into critical_date (deal_id, kind, due_on, source) values
		('${lateAndDated}', 'loi_expiry', '${addDays(today, 1)}', 'Example lease');`);
	const quiet = await deal("Example quiet and stepless", addDays(today, -30));

	assert.deepEqual((await seen(lateAndDated)).attention, {
		reason: "A next step is late.",
		since: today,
	});
	assert.deepEqual((await seen(quiet)).attention, {
		reason: "This deal has no next step and no suggestion.",
		since: addDays(today, -30),
	});
});
