import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";
import { nextChecklistStep } from "./checklist.ts";

const { db, setup, cleanup, save, request } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [
	joe,
	dell,
	lease,
	pending,
	stepped,
	suggested,
	moved,
	parked,
	closed,
	dead,
	invoiced,
	itemStep,
	openStep,
	stepProposal,
	phaseProposal,
	meeting,
	otherMeeting,
] = Array.from({ length: 17 }, (_, n) => id(n + 1));
const path = "deals/workflow-suggestions";
const job = { job: "workflow_suggestions" };
const run = (key = randomUUID()) => save(job, path, { idempotency_key: key });
const what = "RFP / LOI versions and submission";
const evidence = `From the checklist · ${what} is next in Negotiating`;

before(async () => {
	await setup();
	await db
		.query(`begin;
		select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
		insert into party (id, kind, name) values ('${joe}', 'person', 'Joe Example'), ('${dell}', 'person', 'Dell Example');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		select set_config('engine.user_id', '${joe}', true);
		insert into deal_kind (slug, label) values ('lease', 'Lease');
		insert into phase (slug, label) values
			('pending', 'Prospective Client'), ('negotiation', 'Negotiating'), ('research', 'Research'),
			('site_selection', 'Site Selection'), ('closed', 'Closed'), ('dead', 'Lost');
		insert into deal (id, name, kind, owner_user_id, parking_reason) values
			('${lease}', 'Example Lease', 'lease', '${joe}', null),
			('${pending}', 'Example Pending', 'lease', '${joe}', null),
			('${stepped}', 'Example With Step', 'lease', '${joe}', null),
			('${suggested}', 'Example With Suggestion', 'lease', '${joe}', null),
			('${moved}', 'Example Phase Move', 'lease', '${dell}', null),
			('${parked}', 'Example Parked', 'lease', '${joe}', 'client_paused'),
			('${closed}', 'Example Closed', 'lease', '${joe}', null),
			('${dead}', 'Example Dead', 'lease', '${joe}', null),
			('${invoiced}', 'Example Invoiced', 'lease', '${joe}', null);
		insert into deal_phase_change (deal_id, happened_at, phase, reason) values
			('${lease}', '2026-01-01T12:00:00Z', 'negotiation', null),
			('${pending}', '2026-01-01T12:00:00Z', 'pending', null),
			('${stepped}', '2026-01-01T12:00:00Z', 'negotiation', null),
			('${suggested}', '2026-01-01T12:00:00Z', 'negotiation', null),
			('${moved}', '2026-01-01T12:00:00Z', 'negotiation', null),
			('${parked}', '2026-01-01T12:00:00Z', 'negotiation', null),
			('${closed}', '2026-01-01T12:00:00Z', 'closed', null),
			('${dead}', '2026-01-01T12:00:00Z', 'dead', 'Example lost'),
			('${invoiced}', '2026-01-01T12:00:00Z', 'negotiation', null);
		insert into typical_length (deal_kind, todo, days) values ('lease', 'loi_submission', 14);
		insert into next_step (id, deal_id, what, item_title, source_ref, owner_party_id) values
			('${itemStep}', '${lease}', 'Example checklist', 'Read the plan', 'example:plan', '${joe}');
		insert into next_step (id, deal_id, what, owner_party_id) values
			('${openStep}', '${stepped}', 'Call the clinic', '${joe}');
		insert into imported_deal_invoiced (deal_id, invoiced_on) values ('${invoiced}', '2026-01-15');
		select set_config('engine.job', 'agent', true), set_config('engine.user_id', '', true);
		insert into activity (id, kind, happened_at) values
			('${meeting}', 'meeting', '2026-01-02T15:00:00Z'),
			('${otherMeeting}', 'meeting', '2026-01-02T16:00:00Z');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what) values
			('${stepProposal}', 'next_step', '${meeting}', 'meeting', 'Example follow-up', 'agent', '${suggested}', 'Call the clinic');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, from_phase, to_phase) values
			('${phaseProposal}', 'phase_move', '${otherMeeting}', 'meeting', 'Example phase note', 'agent', '${moved}', 'research', 'site_selection');
		commit;`)
		.catch(async (error: unknown) => {
			await db.query("rollback");
			throw error;
		});
});
after(cleanup);

test("the next checklist step skips a finished to-do and a critical date", () => {
	assert.deepEqual(
		nextChecklistStep(
			[
				{
					id: "negotiation",
					label: "Negotiating",
					items: [
						{
							id: "loi_submission",
							label: what,
							status: "complete",
						},
						{ id: "critical-date:1", label: "LOI expiry", status: "due" },
						{
							id: "loi_grid",
							label: "Live terms comparison and counters",
							status: "not_recorded",
						},
					],
				},
			],
			"negotiation",
		),
		{
			todo: "loi_grid",
			label: "Live terms comparison and counters",
			phaseLabel: "Negotiating",
		},
	);
	assert.equal(
		nextChecklistStep(
			[{ id: "pending", label: "Prospective Client", items: [] }],
			"pending",
		),
		null,
	);
	assert.equal(nextChecklistStep([], null), null);
});

test("an open deal with no step gets one checklist suggestion, and a rerun adds nothing", async () => {
	const [wrong] = await save({ job: "nightly_checklist" }, path, {
		idempotency_key: randomUUID(),
	});
	assert.equal(wrong, 403);
	const keys = [randomUUID(), randomUUID()];
	const replies = await Promise.all(keys.map(run));
	for (const [status] of replies) assert.equal(status, 200);
	assert.deepEqual(
		replies
			.map(([, body]) => body)
			.sort((a, b) => Number(b.proposed) - Number(a.proposed)),
		[
			{ proposed: 2, already_proposed: 0 },
			{ proposed: 0, already_proposed: 2 },
		],
	);
	const { rows } = await db.query<{
		name: string;
		what: string;
		evidence: string;
		owner_party_id: string | null;
		dated: boolean;
	}>(
		`select d.name, p.what, p.evidence, p.owner_party_id,
			p.due_on = ((p.created_at at time zone 'America/Chicago')::date + 14) as dated
		from proposal p join deal d on d.id = p.deal_id
		where p.kind = 'workflow_step' and p.status = 'pending'
		order by d.name`,
	);
	assert.deepEqual(rows, [
		{
			name: "Example Lease",
			what,
			evidence,
			owner_party_id: null,
			dated: true,
		},
		{
			name: "Example Phase Move",
			what,
			evidence,
			owner_party_id: null,
			dated: true,
		},
	]);
	const key = keys[replies.findIndex(([, body]) => body.proposed === 2)];
	assert.ok(key);
	assert.deepEqual(await run(key), [
		200,
		{ replayed: true, proposed: 2, already_proposed: 0 },
	]);
	assert.deepEqual(await run(), [200, { proposed: 0, already_proposed: 2 }]);
});

test("the deal read shows the suggestion and Home does not", async () => {
	const {
		rows: [row],
	} = await db.query<{ id: string; due_on: string }>(
		`select id, due_on::text from proposal where deal_id = $1 and kind = 'workflow_step'`,
		[lease],
	);
	assert.ok(row);
	const response = await request(
		{ user: "joe" },
		`deals/${lease}`,
		{ method: "GET" },
		{ DEALS_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const page: unknown = await response.json();
	assert.ok(isArguments(page));
	assert.deepEqual(page.workflow_suggestions, [
		{ proposal_id: row.id, what, evidence, due_on: row.due_on },
	]);
	const home = await request(
		{ user: "joe" },
		"home/inbox?view=dashboard&contract=home-inbox.v6",
		{ method: "GET" },
		{ HOME_INBOX_READ_SCHEMA: "next" },
	);
	assert.equal(home.status, 200);
	assert.equal(JSON.stringify(await home.json()).includes(row.id), false);
});

test("Accept saves the clicking partner's step, and Dismiss lets a later run propose again", async () => {
	const proposalId = async (deal: string | undefined) => {
		assert.ok(deal);
		const { rows } = await db.query<{ id: string }>(
			`select id from proposal where deal_id = $1 and kind = 'workflow_step' and status = 'pending'`,
			[deal],
		);
		return rows[0]?.id;
	};
	const dismissed = await proposalId(moved);
	assert.ok(dismissed);
	assert.equal(
		(
			await save({ user: "joe" }, `proposals/${dismissed}/decision`, {
				idempotency_key: randomUUID(),
				decision: "dismiss",
			})
		)[0],
		200,
	);
	assert.deepEqual(await run(), [200, { proposed: 1, already_proposed: 1 }]);
	const again = await proposalId(moved);
	assert.ok(again);
	assert.notEqual(again, dismissed);
	const [accepted, answer] = await save(
		{ user: "joe" },
		`proposals/${again}/decision`,
		{ idempotency_key: randomUUID(), decision: "accept" },
	);
	assert.equal(accepted, 200);
	assert.deepEqual(answer.created, { next_step_id: again });
	const {
		rows: [step],
	} = await db.query<{ owner: string; what: string; due_on: string }>(
		`select u.slug as owner, s.what, s.due_on::text
		from next_step s join app_user u on u.id = s.owner_party_id where s.id = $1`,
		[again],
	);
	assert.deepEqual(step, {
		owner: "joe",
		what,
		due_on: (
			await db.query<{ due_on: string }>(
				"select due_on::text from proposal where id = $1",
				[again],
			)
		).rows[0]?.due_on,
	});
	const edited = await proposalId(lease);
	assert.ok(edited);
	const [editStatus, edit] = await save(
		{ user: "dell" },
		`proposals/${edited}/decision`,
		{
			idempotency_key: randomUUID(),
			decision: "accept",
			edits: {
				what: "Send the RFP",
				due_on: "2030-04-01",
				owner_party_id: joe,
			},
		},
	);
	assert.equal(editStatus, 200);
	assert.deepEqual(edit.created, { next_step_id: edited });
	const {
		rows: [owned],
	} = await db.query<{ owner: string; what: string; due_on: string }>(
		`select u.slug as owner, s.what, s.due_on::text
		from next_step s join app_user u on u.id = s.owner_party_id where s.id = $1`,
		[edited],
	);
	assert.deepEqual(owned, {
		owner: "joe",
		what: "Send the RFP",
		due_on: "2030-04-01",
	});
	assert.deepEqual(await run(), [200, { proposed: 0, already_proposed: 0 }]);
});
