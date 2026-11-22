import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { z } from "zod";
import { withPartnerAuth } from "../partner-auth.ts";
import { readSchema } from "../test-copy.ts";
import { doorTest } from "../test-door.ts";
import { partnerApp } from "../worker.ts";

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
		insert into phase values ('research', 'Research'), ('legal', 'Legal');
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
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, evidence, from_phase, to_phase, phase_stated, phase_on) values
			('${phase}', 'phase_move', '${decisionCall}', 'call', 'call_capture', '${decisionDeal}', 'Move to Legal.', 'research', 'legal', true, '2025-01-05'),
			('${stale}', 'phase_move', '${decisionCall}', 'call', 'call_capture', '${decisionDeal}', 'Move to Legal next day.', 'research', 'legal', true, '2025-01-06');
		select set_config('engine.job', 'old_system', true);
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

test("call outcomes require a PartnerApp session and an existing deal", async () => {
	assert.equal((await read(deal, null)).status, 401);
	assert.equal((await read("not-a-deal")).status, 404);
	const missing = await read(id(99));
	assert.equal(missing.status, 404);
	assert.partialDeepStrictEqual(await missing.json(), { error: "not_found" });
});

test("the existing decision route replays acceptance, refuses a stale phase and dismisses a call suggestion", async () => {
	const decide = (proposal: string, decision: string, key = randomUUID()) =>
		request(`proposals/${proposal}/decision`, "joe", {
			decision,
			idempotency_key: key,
		});
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
