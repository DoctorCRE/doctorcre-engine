import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql } from "kysely";
import { z } from "zod";
import { nextTransaction } from "../next-connection.ts";
import { withPartnerAuth } from "../partner-auth.ts";
import { readSchema } from "../test-copy.ts";
import { doorTest } from "../test-door.ts";
import { partnerApp } from "../worker.ts";
import { callOutcomeQuery } from "./call-outcomes.ts";

const { db, readerUrl, writerUrl, connectionString, setup, cleanup } =
	doorTest();
const appOrigin = "https://app.example.test";
const secret = randomBytes(32).toString("hex");
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const joe = id(1);
const dell = id(2);
const deal = id(10);
const otherDeal = id(11);
const emptyDeal = id(12);
const decisionDeal = id(13);
const call = id(20);
const privateCall = id(21);
const outsideCall = id(22);
const copiedCall = id(23);
const noSuggestions = id(24);
const ordinaryCall = id(25);
const decisionCall = id(26);
const pending = id(30);
const copied = id(31);
const outsideProposal = id(32);
const privateProposal = id(33);
const assignedElsewhere = id(39);
const accepted = id(34);
const dismissed = id(35);
const phase = id(36);
const stale = id(37);
const skip = id(38);
const assigned = id(40);
const existingStep = id(41);
const callIds = z.object({
	calls: z.array(
		z.object({
			activity_id: z.uuid(),
			proposals: z.array(z.object({ proposal_id: z.uuid() })),
		}),
	),
});
const proof = new Map<string, { cookie: string; csrfToken: string }>();

before(async () => {
	await setup();
	await db.query(await readSchema("partner-auth.sql"));
	await db.query(`
		begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example Viewer'), ('${dell}', 'person', 'Example Owner');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into job values ('call_capture', 'Example call capture');
		insert into phase values ('research', 'Research'), ('legal', 'Legal'), ('closing', 'Closing');
		select set_config('engine.user_id', '${dell}', true);
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'Example first deal', '${dell}'),
			('${otherDeal}', 'Example second deal', '${dell}'),
			('${emptyDeal}', 'Example empty deal', '${dell}'),
			('${decisionDeal}', 'Example phase decision', '${dell}');
		insert into deal_phase_change (deal_id, phase, happened_at)
			values ('${decisionDeal}', 'research', '2025-01-01T18:00Z');

		select set_config('engine.user_id', '', true);
		insert into activity (id, kind, happened_at) values ('${copiedCall}', 'call', '2025-01-01T18:00Z');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${joe}', true);
		insert into activity (id, kind, happened_at) values ('${ordinaryCall}', 'call', '2025-01-11T18:00Z');
		select set_config('engine.job', 'call_capture', true);
		insert into activity (id, kind, happened_at) values
			('${call}', 'call', '2025-01-04T02:00Z'),
			('${outsideCall}', 'call', '2025-01-07T18:00Z'),
			('${noSuggestions}', 'call', '2025-01-02T18:00Z'),
			('${decisionCall}', 'call', '2025-01-05T18:00Z');
		select set_config('engine.user_id', '${dell}', true);
		insert into activity (id, kind, happened_at) values ('${privateCall}', 'call', '2025-01-08T18:00Z');
		insert into activity_about (activity_id, deal_id) values
			('${call}', '${deal}'), ('${call}', '${otherDeal}'), ('${privateCall}', '${deal}'),
			('${outsideCall}', '${otherDeal}'), ('${copiedCall}', '${deal}'),
			('${noSuggestions}', '${deal}'), ('${ordinaryCall}', '${deal}'),
			('${decisionCall}', '${decisionDeal}');

		select set_config('engine.user_id', '${joe}', true);
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence, created_at) values
			('${pending}', 'log_call', '${call}', 'call', 'call_capture', '${deal}', 'Review the example plan.', 'Review the plan.', '2025-01-04T03:00Z'),
			('${accepted}', 'log_call', '${call}', 'call', 'call_capture', '${deal}', 'The tour is booked.', 'The tour is booked.', '2025-01-04T04:00Z'),
			('${dismissed}', 'log_call', '${call}', 'call', 'call_capture', '${deal}', 'Send the plan.', 'Send the plan.', '2025-01-04T05:00Z'),
			('${outsideProposal}', 'log_call', '${call}', 'call', 'call_capture', '${otherDeal}', 'Outside this deal.', 'Outside this deal.', '2025-01-04T03:00Z'),
			('${privateProposal}', 'next_step', '${privateCall}', 'call', 'call_capture', '${deal}', 'Private evidence.', 'Private evidence.', '2025-01-08T19:00Z'),
			('${skip}', 'log_call', '${decisionCall}', 'call', 'call_capture', '${decisionDeal}', 'Skip this note.', 'Skip this note.', '2025-01-05T19:00Z');
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence, owner_party_id)
			values ('${assignedElsewhere}', 'next_step', '${call}', 'call', 'call_capture', '${deal}', 'Other partner task.', 'Other partner task.', '${dell}');
		select set_config('engine.job', 'old_system', true);
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, evidence, from_phase, to_phase) values
			('${phase}', 'phase_move', '${decisionCall}', 'call', 'old_system', '${decisionDeal}', 'Move to Legal.', 'research', 'legal'),
			('${stale}', 'phase_move', '${decisionCall}', 'call', 'old_system', '${decisionDeal}', 'Move elsewhere.', 'research', 'closing');
		insert into next_step (id, deal_id, what, owner_party_id, due_on)
			values ('${existingStep}', '${decisionDeal}', 'Send the plan', '${joe}', '2025-02-08');
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence, owner_party_id, due_on)
			values ('${assigned}', 'next_step', '${decisionCall}', 'call', 'old_system', '${decisionDeal}',
				' SEND  THE plan. ', 'Send the plan.', '${joe}', '2025-02-09');
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence)
			values ('${copied}', 'log_call', '${copiedCall}', 'call', 'old_system', '${deal}', 'Copied note.', 'Copied evidence.');
		select set_config('engine.job', '', true);
		update proposal set status = 'accepted' where id = '${accepted}';
		update proposal set status = 'dismissed' where id = '${dismissed}';
		commit;
		insert into doctorcre_auth."user"
			(id, partner_user_id, name, email, "emailVerified", "createdAt", "updatedAt")
			values ('joe', '${joe}', 'Example Viewer', 'viewer@example.test', true, now(), now()),
				('dell', '${dell}', 'Example Owner', 'owner@example.test', true, now(), now());
		insert into doctorcre_auth.account (id, "userId", "providerId", "accountId", "createdAt", "updatedAt")
			values ('viewer', 'joe', 'google', 'viewer', now(), now()),
				('owner', 'dell', 'google', 'owner', now(), now());
	`);
	await withPartnerAuth(
		{ appOrigin, connectionString, secret },
		async ({ auth }) => {
			const { internalAdapter } = await auth.$context;
			for (const user of ["joe", "dell"]) {
				const { token } = await internalAdapter.createSession(user);
				const {
					rows: [session],
				} = await db.query<{ csrfToken: string }>(
					'select "csrfToken" from doctorcre_auth.session where token = $1',
					[token],
				);
				assert.ok(session);
				const signature = createHmac("sha256", secret)
					.update(token)
					.digest("base64");
				proof.set(user, {
					cookie: `__Host-doctorcre_session=${encodeURIComponent(`${token}.${signature}`)}`,
					csrfToken: session.csrfToken,
				});
			}
		},
	);
});
after(cleanup);

function request(path: string, user: string | null, body?: object) {
	const auth = user ? proof.get(user) : undefined;
	return partnerApp.request(
		`${appOrigin}/api/engine/${path}`,
		{
			method: body ? "POST" : "GET",
			headers: {
				...(auth && { Cookie: auth.cookie, "x-carr-csrf": auth.csrfToken }),
				Origin: appOrigin,
				"Sec-Fetch-Site": "same-origin",
			},
			...(body && { body: JSON.stringify(body) }),
		},
		{
			DATABASE: { connectionString: readerUrl },
			DATABASE_WRITER: { connectionString: writerUrl },
			PARTNER_AUTH_DATABASE: { connectionString },
			PARTNER_APP_ORIGIN: appOrigin,
			PARTNER_AUTH_SECRET: secret,
		},
	);
}

const read = (dealId: string, user: string | null = "joe") =>
	request(`deals/${dealId}/call-outcomes`, user);

const decide = (
	proposal: string,
	decision: string,
	key = randomUUID(),
	edits?: object,
) =>
	request(`proposals/${proposal}/decision`, "joe", {
		decision,
		idempotency_key: key,
		edits,
	});

test("a deal’s recorded calls include the proposal evidence and current decisions", async () => {
	const response = await read(deal);
	assert.equal(response.status, 200);
	const result = await response.json();
	assert.partialDeepStrictEqual(result, {
		deal_id: deal,
		deal_name: "Example first deal",
		calls: [
			{
				activity_id: call,
				started_at: "2025-01-04T02:00:00+00:00",
				call_date: "2025-01-03",
				proposals: [
					{
						proposal_id: pending,
						kind: "log_call",
						status: "pending",
						evidence: "Review the plan.",
						what: "Review the example plan.",
					},
					{ proposal_id: accepted, status: "accepted" },
					{ proposal_id: dismissed, status: "dismissed" },
				],
			},
			{ activity_id: noSuggestions, proposals: [] },
			{
				activity_id: copiedCall,
				proposals: [{ proposal_id: copied, status: "pending" }],
			},
		],
	});
	assert.deepEqual(callIds.parse(result).calls, [
		{
			activity_id: call,
			proposals: [pending, accepted, dismissed].map((proposal_id) => ({
				proposal_id,
			})),
		},
		{ activity_id: noSuggestions, proposals: [] },
		{ activity_id: copiedCall, proposals: [{ proposal_id: copied }] },
	]);
});

test("call outcomes are scoped to the session partner and deal", async () => {
	const asOther = await read(deal, "dell");
	assert.equal(asOther.status, 200);
	assert.deepEqual(
		callIds.parse(await asOther.json()).calls.map((row) => row.activity_id),
		[privateCall],
	);
	const elsewhere = await read(otherDeal);
	assert.equal(elsewhere.status, 200);
	assert.deepEqual(callIds.parse(await elsewhere.json()).calls, [
		{ activity_id: outsideCall, proposals: [] },
		{ activity_id: call, proposals: [{ proposal_id: outsideProposal }] },
	]);
	const empty = await read(emptyDeal);
	assert.equal(empty.status, 200);
	assert.deepEqual(callIds.parse(await empty.json()).calls, []);
});

test("the database call rule uses the current viewer and shares copied calls", async () => {
	for (const [viewer, expected] of [
		[joe, [call, copiedCall, ordinaryCall]],
		[dell, [privateCall, copiedCall]],
		["", [copiedCall]],
	] as const) {
		await nextTransaction(readerUrl, "read", async (tx) => {
			if (viewer) {
				await sql`select set_config('engine.user_id', ${viewer}, true)`.execute(
					tx,
				);
			}
			const rows = await tx
				.selectFrom("activity")
				.select("id")
				.where("id", "in", [call, privateCall, copiedCall, ordinaryCall])
				.where(
					sql<boolean>`call_visible_to(changed_by_user_id, changed_by_job, changed_for_user_id)`,
				)
				.orderBy("id")
				.execute();
			assert.deepEqual(
				rows.map(({ id }) => id),
				expected,
			);
		});
	}
});

test("call outcomes require a PartnerApp session and an existing deal", async () => {
	assert.equal((await read(deal, null)).status, 401);
	assert.equal((await read("not-a-deal")).status, 404);
	const missing = await read(id(99));
	assert.equal(missing.status, 404);
	assert.partialDeepStrictEqual(await missing.json(), { error: "not_found" });
});

test("the existing decision route replays acceptance, refuses a stale phase and dismisses a call suggestion", async () => {
	const key = randomUUID();
	const response = await decide(phase, "accept", key);
	assert.equal(response.status, 200);
	const saved = await response.json();
	assert.partialDeepStrictEqual(saved, {
		proposal_id: phase,
		status: "accepted",
	});
	const replay = await decide(phase, "accept", key);
	assert.equal(replay.status, 200);
	assert.ok(saved && typeof saved === "object");
	assert.deepEqual(await replay.json(), { ...saved, replayed: true });
	const conflict = await decide(stale, "accept");
	assert.equal(conflict.status, 409);
	assert.partialDeepStrictEqual(await conflict.json(), {
		error: "version_conflict",
		current_phase: "legal",
	});
	const skipped = await decide(skip, "dismiss");
	assert.equal(skipped.status, 200);
	assert.partialDeepStrictEqual(await skipped.json(), {
		proposal_id: skip,
		status: "dismissed",
		created: {},
	});
	const { rows } = await db.query(
		"select phase, changed_by_user_id from deal_phase_change where deal_id = $1 and phase = 'legal'",
		[decisionDeal],
	);
	assert.deepEqual(rows, [{ phase: "legal", changed_by_user_id: joe }]);
});

test("a decision on another partner’s private call has the same refusal as an unknown proposal", async () => {
	for (const decision of ["accept", "dismiss"]) {
		const hidden = await decide(privateProposal, decision);
		const unknown = await decide(id(99), decision);
		assert.equal(hidden.status, unknown.status);
		assert.partialDeepStrictEqual(await hidden.json(), { error: "not_found" });
	}
});

test("a decision on a hidden suggestion from a visible call returns not found", async () => {
	const response = await read(deal);
	assert.equal(response.status, 200);
	const source = callIds
		.parse(await response.json())
		.calls.find((row) => row.activity_id === call);
	assert.ok(source);
	assert.ok(!source.proposals.some((p) => p.proposal_id === assignedElsewhere));

	for (const decision of ["accept", "dismiss"]) {
		const hidden = await decide(assignedElsewhere, decision);
		assert.equal(hidden.status, 404);
		assert.partialDeepStrictEqual(await hidden.json(), { error: "not_found" });
	}
});

test("accepting a private log stays pending and writes no shared note", async () => {
	const response = await decide(pending, "accept");
	assert.equal(response.status, 409);
	assert.partialDeepStrictEqual(await response.json(), {
		error: "private_call",
	});
	assert.partialDeepStrictEqual(await (await read(deal)).json(), {
		calls: [
			{
				proposals: [
					{
						proposal_id: pending,
						status: "pending",
						accept_blocked: "private_call",
					},
				],
			},
		],
	});
	assert.equal(
		(await db.query("select from activity where id = $1", [pending])).rowCount,
		0,
	);
});

test("accepting an assigned action leaves an existing step and its date intact", async () => {
	const response = await decide(assigned, "accept");
	assert.equal(response.status, 409);
	assert.partialDeepStrictEqual(await response.json(), {
		error: "open_step_exists",
		next_step_id: existingStep,
	});
	assert.deepEqual(
		(
			await db.query(
				"select id, status, due_on::text from next_step where deal_id = $1",
				[decisionDeal],
			)
		).rows,
		[{ id: existingStep, status: "open", due_on: "2025-02-08" }],
	);
	assert.partialDeepStrictEqual(await (await read(decisionDeal)).json(), {
		calls: [
			{
				proposals: [
					{
						proposal_id: assigned,
						status: "pending",
						accept_blocked: "open_step_exists",
					},
				],
			},
		],
	});
	assert.equal((await decide(assigned, "dismiss")).status, 200);
});

for (const [index, scenario] of [
	{ source: null, expectedDue: "2025-02-08" },
	{
		source: "defaulted",
		expectedDue: "2025-02-08",
		edits: { due_on: "2025-02-10" },
	},
	{ source: "stated", expectedDue: "2025-02-09" },
	{
		source: "stated",
		expectedDue: "2025-02-10",
		edits: {
			what: "Send the plan.",
			owner_party_id: dell,
			due_on: "2025-02-10",
		},
	},
	{ source: null, expectedDue: "2025-02-08", meeting: true },
	{
		source: null,
		expectedDue: "2025-02-08",
		what: "  SEND\u00a0ΟΣ. ",
		suggested: "send ος.",
	},
	{
		source: null,
		expectedDue: "2025-02-08",
		native: true,
		what: "  SEND\u00a0ΟΣ. ",
		suggested: "send ος.",
	},
].entries()) {
	const kind = scenario.meeting ? "meeting" : "call";
	const job =
		scenario.meeting || scenario.native ? "call_capture" : "old_system";
	const details = scenario.suggested
		? `final sigma in ${scenario.native ? "native" : "copied"} action text`
		: `${scenario.source ?? "unknown"} date provenance${scenario.edits?.what ? " and edited owner and text" : ""}`;
	test(`${kind} acceptance joins the held step with ${details}`, async () => {
		const target = id(101 + index * 4);
		const activity = id(102 + index * 4);
		const step = id(103 + index * 4);
		const action = id(104 + index * 4);
		const what = scenario.what ?? "  SEND\u00a0the\u2003\tplan.\u3000";
		const suggested =
			scenario.suggested ??
			(scenario.edits?.what ? "Send the old plan." : "send the plan.");
		await db.query(`
			begin;
			select set_config('engine.job', '${job}', true), set_config('engine.user_id', '${joe}', true);
			insert into deal (id, name, owner_user_id) values ('${target}', 'Example action deal ${index}', '${joe}');
			insert into activity (id, kind, happened_at) values ('${activity}', '${kind}', '2025-01-06T18:00Z');
			insert into activity_about (activity_id, deal_id) values ('${activity}', '${target}');
			insert into next_step (id, deal_id, what, owner_party_id, due_on, hold_until)
				values ('${step}', '${target}', '${what}', '${scenario.edits?.owner_party_id ?? joe}', '2025-02-08', '2025-02-15');
			insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence, owner_party_id, due_on, due_source)
				values ('${action}', 'next_step', '${activity}', '${kind}', '${job}', '${target}',
					'${suggested}', 'Example quote.',
					${scenario.meeting ? "null" : `'${joe}'`},
					'2025-02-09', ${scenario.source ? `'${scenario.source}'` : "null"});
			commit;
		`);
		if (kind === "call") {
			assert.partialDeepStrictEqual(await (await read(target)).json(), {
				calls: [{ proposals: [{ proposal_id: action, accept_blocked: null }] }],
			});
		}
		const key = randomUUID();
		const response = await decide(action, "accept", key, scenario.edits);
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.ok(body && typeof body === "object");
		assert.partialDeepStrictEqual(body, {
			status: "accepted",
			created: { next_step_id: step },
		});
		assert.deepEqual(
			await (await decide(action, "accept", key, scenario.edits)).json(),
			{ ...body, replayed: true },
		);
		const { rows } = await db.query(
			`select s.id, s.what, s.status, s.due_on::text, s.hold_until::text, p.merged_step_id
			from proposal p join next_step s on s.deal_id = p.deal_id where p.id = $1`,
			[action],
		);
		assert.deepEqual(rows, [
			{
				id: step,
				what: scenario.edits?.what ?? what,
				status: "open",
				due_on: scenario.expectedDue,
				hold_until: "2025-02-15",
				merged_step_id: step,
			},
		]);
	});
}

for (const [kind, proposal] of [
	["pending next-step", privateProposal],
	["accepted call log", accepted],
]) {
	test(`a ${kind} proposal cannot record a merged step`, async () => {
		await db.query(
			`begin; select set_config('engine.user_id', '${joe}', true)`,
		);
		try {
			await assert.rejects(
				db.query("update proposal set merged_step_id = $1 where id = $2", [
					existingStep,
					proposal,
				]),
				{ code: "23514", constraint: "proposal_merged_step_decided" },
			);
		} finally {
			await db.query("rollback");
		}
	});
}

test("matching checklist and property steps do not get merged", async () => {
	const checklistDeal = id(15);
	const checklistCall = id(27);
	const checklistItem = id(42);
	const action = id(43);
	await db.query(`
		begin;
		select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '${joe}', true);
		insert into deal (id, name, owner_user_id) values ('${checklistDeal}', 'Example checklist deal', '${joe}');
		insert into activity (id, kind, happened_at) values ('${checklistCall}', 'call', '2025-01-06T18:00Z');
		insert into activity_about (activity_id, deal_id) values ('${checklistCall}', '${checklistDeal}');
		insert into property (id, address) values ('${id(16)}', '123 Example Way');
		insert into next_step (property_id, what, owner_party_id) values ('${id(16)}', 'Review lease terms', '${joe}');
		insert into next_step (id, deal_id, what, owner_party_id, item_title, item_bullets, source_ref)
			values ('${checklistItem}', '${checklistDeal}', 'Review lease terms', '${joe}', 'Review lease terms', '[]', 'example:copy');
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence, owner_party_id)
			values ('${action}', 'next_step', '${checklistCall}', 'call', 'old_system', '${checklistDeal}',
				'Review lease terms', 'Review lease terms.', '${joe}');
		commit;
	`);
	const response = await decide(action, "accept");
	assert.equal(response.status, 200);
	assert.partialDeepStrictEqual(await response.json(), {
		proposal_id: action,
		status: "accepted",
		created: { next_step_id: action },
	});
	assert.deepEqual(
		(
			await db.query(
				`select s.id, s.status, p.merged_step_id from next_step s
				left join proposal p on p.id = s.id where s.deal_id = $1 order by s.id`,
				[checklistDeal],
			)
		).rows,
		[
			{ id: checklistItem, status: "open", merged_step_id: null },
			{ id: action, status: "open", merged_step_id: null },
		],
	);
});

test("the latest 50 visible calls bound proposal aggregation", async (t) => {
	const historyDeal = id(14);
	await db.query(`
		begin;
		select set_config('engine.job', 'call_capture', true), set_config('engine.user_id', '${joe}', true);
		insert into deal (id, name, owner_user_id) values ('${historyDeal}', 'Example long history', '${joe}');
		select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
		with history as (
			insert into activity (kind, happened_at)
			select 'call', '2000-01-01'::timestamptz + n * interval '1 day'
			from generate_series(1, 5000) n returning id
		) insert into activity_about (activity_id, deal_id) select id, '${historyDeal}' from history;
		select set_config('engine.job', 'call_capture', true), set_config('engine.user_id', '${dell}', true);
		with hidden as (
			insert into activity (kind, happened_at)
			select 'call', '2025-01-01'::timestamptz + n * interval '1 day'
			from generate_series(1, 60) n returning id
		) insert into activity_about (activity_id, deal_id) select id, '${historyDeal}' from hidden;
		select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '${joe}', true);
		insert into proposal (kind, activity_id, activity_kind, proposed_by_job, deal_id, what, evidence)
			select 'log_call', activity_id, 'call', 'old_system', deal_id, 'Example note', 'Example evidence'
			from activity_about where deal_id = '${historyDeal}';
		commit;
		analyze activity;
		analyze activity_about;
		analyze proposal;
	`);
	const response = await read(historyDeal);
	assert.equal(response.status, 200);
	const result = callIds.parse(await response.json());
	assert.equal(result.calls.length, 50);
	assert.ok(result.calls.every((call) => call.proposals.length === 1));
	const query = await nextTransaction(readerUrl, "read", async (tx) =>
		callOutcomeQuery(tx, joe, historyDeal).compile(),
	);
	const { rows } = await db.query<{ "QUERY PLAN": string }>(
		`explain (analyze, costs off, timing off, summary off) ${query.sql}`,
		[...query.parameters],
	);
	const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
	if (process.env.CALL_OUTCOMES_EXPLAIN === "1") t.diagnostic(plan);
	const aggregates = [...plan.matchAll(/Aggregate .*loops=(\d+)\)/g)];
	assert.equal(
		aggregates.reduce((total, match) => total + Number(match[1]), 0),
		50,
	);
});
