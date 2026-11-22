import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { z } from "zod";
import { readSchema } from "./test-copy.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, save, request } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALEX = id(1),
	BLAIR = id(2),
	AUTOMATIC = id(3),
	REVIEW = id(4),
	STEPS = id(5),
	CALL = id(6),
	EARLY = id(7),
	FUTURE = id(8),
	CROSSED = id(9),
	NO_PHASE = id(10),
	SUGGESTED = id(11),
	EDITED_OWNER = id(12),
	BACKDATED = id(13),
	MEETING = id(14),
	MEETING_DEAL = id(15),
	EMAIL = id(16),
	EMAIL_DEAL = id(17),
	CLIENT = id(18);
const job = { job: "call_capture", for_user: "alex" };

before(async () => {
	await setup();
	await db.query(await readSchema("add-call-review-step-merge.sql"));
	await db.query(await readSchema("add-private-call-log.sql"));
	await db.query(await readSchema("add-private-call-log.sql"));
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into job values ('call_capture', 'Example call capture');
		insert into party (id, kind, name) values ('${ALEX}', 'person', 'Alex Example'), ('${BLAIR}', 'person', 'Blair Example');
		insert into app_user (id, slug) values ('${ALEX}', 'alex'), ('${BLAIR}', 'blair');
		insert into how_found values ('referral', 'Referral');
		insert into party (id, kind, name, how_found) values ('${CLIENT}', 'company', 'Example Client', 'referral');
		insert into role (slug, label) values ('client', 'Client');
		insert into party_role (party_id, role) values ('${CLIENT}', 'client');
		insert into phase values ('research', 'Research'), ('legal', 'Legal');
		insert into deal (id, name, owner_user_id)
		select id, 'Example Deal ' || id, '${ALEX}'
		from unnest(array['${AUTOMATIC}', '${REVIEW}', '${STEPS}', '${EARLY}', '${FUTURE}', '${CROSSED}',
			'${NO_PHASE}', '${SUGGESTED}', '${EDITED_OWNER}', '${BACKDATED}', '${MEETING_DEAL}', '${EMAIL_DEAL}']::uuid[]) as fixture(id);
		insert into deal_phase_change (deal_id, phase, happened_at)
		select id, 'research', '2026-01-05T15:00:00Z' from deal where id <> '${NO_PHASE}';
		select set_config('engine.job', 'call_capture', true), set_config('engine.user_id', '${ALEX}', true);
		insert into activity (id, kind, happened_at) values ('${CALL}', 'call', '2026-01-07T15:00:00Z');
		insert into activity_about (activity_id, deal_id) select '${CALL}', id from deal;
		select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
		insert into activity (id, kind, happened_at) values ('${MEETING}', 'meeting', '2026-01-07T15:00:00Z');
		insert into activity_about (activity_id, deal_id) values ('${MEETING}', '${MEETING_DEAL}');
		insert into activity (id, kind, happened_at) values ('${EMAIL}', 'email', '2026-01-07T15:00:00Z');
		insert into activity_about (activity_id, deal_id) values ('${EMAIL}', '${EMAIL_DEAL}');
		insert into email (activity_id, message_id, sender, subject, body)
		values ('${EMAIL}', 'example-step@example.test', 'clinic@example.test', 'Example tour', 'Send available times.');
		insert into email_mailbox (activity_id, user_id) values ('${EMAIL}', '${ALEX}');
		commit;`);
});
after(cleanup);

const read = (deal: string, caller = job) =>
	save(caller, `deals/${deal}`, {}, "GET");
const post = (path: string, args: object) =>
	save(job, path, { idempotency_key: randomUUID(), ...args });
const propose = (args: object) =>
	post("proposals", {
		activity_id: CALL,
		evidence: "We agreed on the next move.",
		...args,
	});
const decide = (id: unknown) =>
	save({ user: "alex" }, `proposals/${id}/decision`, {
		idempotency_key: randomUUID(),
		decision: "accept",
	});

test("accepting a copied call log leaves one call and adds one note at the call's time", async () => {
	const copiedCall = id(19);
	const copiedDeal = id(20);
	const what = "Agreed to review the example floor plan.";
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into deal (id, name, owner_user_id) values ('${copiedDeal}', 'Example copied call deal', '${ALEX}');
		insert into activity (id, kind, happened_at) values ('${copiedCall}', 'call', '2026-01-07T15:00:00Z');
		insert into activity_about (activity_id, deal_id) values ('${copiedCall}', '${copiedDeal}');
		insert into activity_about (activity_id, party_id) values ('${copiedCall}', '${BLAIR}');
		select set_config('engine.user_id', '${ALEX}', true);
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, party_id, what, evidence) values
			('${id(21)}', 'log_call', '${copiedCall}', 'call', 'old_system', '${copiedDeal}', null, '${what}', '${what}'),
			('${id(22)}', 'log_call', '${copiedCall}', 'call', 'old_system', null, '${BLAIR}', '${what}', '${what}');
		commit;`);
	for (const [proposalId, dealId, partyId] of [
		[id(21), copiedDeal, null],
		[id(22), null, BLAIR],
	] as const) {
		const decision = { idempotency_key: randomUUID(), decision: "accept" };
		const accept = () =>
			save({ user: "alex" }, `proposals/${proposalId}/decision`, decision);
		const [accepted, answer] = await accept();
		assert.equal(accepted, 200);
		assert.deepEqual(answer.created, { activity_id: proposalId });
		assert.deepEqual(await accept(), [200, { ...answer, replayed: true }]);
		assert.deepEqual(
			(
				await db.query(
					`select a.id, a.kind, a.happened_at = source.happened_at as original_time,
						a.summary, a.changed_by_user_id
					from activity a join activity_about b on b.activity_id = a.id
					join activity source on source.id = $3
					where (b.deal_id = $1 or b.party_id = $2) and a.kind in ('call', 'note')
					order by a.id`,
					[dealId, partyId, copiedCall],
				)
			).rows,
			[
				{
					id: copiedCall,
					kind: "call",
					original_time: true,
					summary: null,
					changed_by_user_id: null,
				},
				{
					id: proposalId,
					kind: "note",
					original_time: true,
					summary: what,
					changed_by_user_id: ALEX,
				},
			],
		);
	}
});

test("private call logs save on the call once, including when its summary is blank", async () => {
	for (const [index, summary] of [null, "", "Original summary."].entries()) {
		const callId = id(100 + index);
		const happenedAt = `2026-01-0${7 + index}T15:00:00.000Z`;
		const recorder = ["", "call_capture", "old_system"][index];
		await db.query("begin");
		await db.query(
			"select set_config('engine.job', $1, true), set_config('engine.user_id', $2, true)",
			[recorder, ALEX],
		);
		await db.query(
			`insert into activity (id, kind, happened_at, summary)
			values ($1, 'call', $2, $3)`,
			[callId, happenedAt, summary],
		);
		await db.query(
			`insert into activity_about (activity_id, deal_id, party_id)
			values ($1, $2, null), ($1, null, $3)`,
			[callId, REVIEW, CLIENT],
		);
		await db.query("commit");
		const readActor = async () => {
			const response = await request(
				{ user: "alex" },
				`recent-activity?query=${CLIENT}`,
				{ method: "GET" },
				{ ACTIVITY_READ_SCHEMA: "next" },
			);
			assert.equal(response.status, 200);
			const activity = z
				.object({
					state: z.literal("completed"),
					catch_up: z.object({
						timeline: z.array(
							z.object({ actor: z.string(), occurred_at: z.string() }),
						),
					}),
				})
				.parse(await response.json());
			const entry = activity.catch_up.timeline.find(
				(item) => item.occurred_at === happenedAt,
			);
			assert.ok(entry);
			return entry.actor;
		};
		assert.equal(await readActor(), recorder || "alex");
		const [stored, proposal] = await propose({
			kind: "log_call",
			activity_id: callId,
			what: "Agreed on timing.",
			...(index === 1 ? { party_id: CLIENT } : { deal_id: REVIEW }),
		});
		assert.equal(stored, 201);
		const decision = { idempotency_key: randomUUID(), decision: "accept" };
		const accept = () =>
			save(
				{ user: "alex" },
				`proposals/${proposal.proposal_id}/decision`,
				decision,
			);
		const [status, answer] = await accept();
		assert.equal(status, 200);
		assert.deepEqual(answer.created, { activity_id: callId });
		assert.deepEqual(await accept(), [200, { ...answer, replayed: true }]);
		assert.equal(await readActor(), "alex");
		assert.deepEqual(
			(
				await db.query(
					`select id, kind, summary from activity a where id = $1 or
						(kind = 'note' and exists (select from activity_about b
							where b.activity_id = a.id and (b.deal_id = $2 or b.party_id = $3)))`,
					[callId, REVIEW, CLIENT],
				)
			).rows,
			[
				{
					id: callId,
					kind: "call",
					summary: summary
						? "Original summary.\n\nAgreed on timing."
						: "Agreed on timing.",
				},
			],
		);
	}
});

test("a call log requires a linked recorded call and a summary, and dismissal writes no activity", async () => {
	const base = { kind: "log_call", deal_id: REVIEW, what: "Example call" };
	for (const invalid of [
		{ activity_id: MEETING, deal_id: MEETING_DEAL },
		{ what: undefined },
		{ deal_id: undefined, party_id: ALEX },
	]) {
		assert.equal((await propose({ ...base, ...invalid }))[0], 422);
	}
	const [stored, proposal] = await propose(base);
	assert.equal(stored, 201);
	const [dismissed, answer] = await save(
		{ user: "alex" },
		`proposals/${proposal.proposal_id}/decision`,
		{ idempotency_key: randomUUID(), decision: "dismiss" },
	);
	assert.equal(dismissed, 200);
	assert.deepEqual(answer.created, {});
	assert.equal(
		(
			await db.query("select id from activity where id = $1", [
				proposal.proposal_id,
			])
		).rowCount,
		0,
	);
});

test("a registered job reads a deal and uses the answer to save a phase move", async () => {
	const [status, deal] = await read(AUTOMATIC);
	const { rows } = await db.query(
		`select (select max(id) from change where table_name = 'deal' and record = jsonb_build_object('id', $1::uuid)) as id,
			to_jsonb(changed_at) #>> '{}' as phase_saved_at from deal_phase_change where deal_id = $1`,
		[AUTOMATIC],
	);
	assert.equal(status, 200);
	assert.ok(Number(rows[0].id) > 0);
	assert.deepEqual(deal, {
		deal_id: AUTOMATIC,
		phase: "research",
		phase_saved_at: rows[0].phase_saved_at,
		change_id: Number(rows[0].id),
		next_step: null,
	});
	const [denied, refusal] = await read(AUTOMATIC, {
		...job,
		job: "unknown_example",
	});
	assert.deepEqual([denied, refusal.error], [403, "unknown_job"]);
	assert.equal((await read(randomUUID()))[0], 404);
	const [saved] = await post(`deals/${AUTOMATIC}/changes`, {
		seen_change_id: deal.change_id,
		phase: { from: deal.phase, to: "legal", activity_id: CALL },
	});
	assert.equal(saved, 200);
	const [, latest] = await read(AUTOMATIC);
	assert.equal(latest.phase, "legal");
	const [, noPhase] = await read(NO_PHASE);
	assert.equal(noPhase.phase, null);
	assert.equal(noPhase.phase_saved_at, null);
	const [initial, invalid] = await post(`deals/${NO_PHASE}/changes`, {
		seen_change_id: noPhase.change_id,
		phase: { from: null, to: "legal", activity_id: CALL },
	});
	assert.deepEqual([initial, invalid.fields], [400, ["phase.from"]]);
});

test("a backdated phase move reports when the partner saved it", async () => {
	const [, before] = await read(BACKDATED);
	const [saved, moved] = await save(
		{ user: "alex" },
		`deals/${BACKDATED}/changes`,
		{
			idempotency_key: randomUUID(),
			seen_change_id: before.change_id,
			phase: { from: "research", to: "legal", on: "2026-01-06" },
		},
	);
	assert.equal(saved, 200, JSON.stringify(moved));
	assert.equal(moved.phase_changed_at, "2026-01-06T06:00:00+00:00");
	const {
		rows: [phase],
	} = await db.query(
		`select to_jsonb(changed_at) #>> '{}' as saved_at, changed_at > happened_at as backdated
		from deal_phase_change where deal_id = $1 and phase = 'legal'`,
		[BACKDATED],
	);
	assert.equal(phase.backdated, true);
	const [status, deal] = await read(BACKDATED);
	assert.equal(status, 200);
	assert.equal(deal.phase, "legal");
	assert.equal(deal.phase_saved_at, phase.saved_at);
});

test("call capture needs a recorded call to move a phase and cannot add a deal", async () => {
	for (const activity_id of [EMAIL, randomUUID()]) {
		const [, deal] = await read(EMAIL_DEAL);
		const [status, refusal] = await post(`deals/${EMAIL_DEAL}/changes`, {
			seen_change_id: deal.change_id,
			phase: { from: deal.phase, to: "legal", activity_id },
		});
		assert.deepEqual(
			[status, refusal.error, refusal.rule],
			[
				422,
				"database_refused_the_statement",
				"deal_phase_change_source_is_call",
			],
		);
	}
	const [status, refusal] = await post("deals", {
		name: "Example Call Capture Deal",
		client_id: CLIENT,
		owner: "alex",
		phase: "research",
	});
	assert.deepEqual(
		[status, refusal.error, refusal.rule],
		[422, "database_refused_the_statement", "deal_phase_change_call_source"],
	);
});

test("call capture reads the original save time of a copied backdated phase", async () => {
	const copiedDeal = id(18);
	const client = id(19);
	await db
		.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into outside_id (source, value, party_id) values ('old_system', '${ALEX}', '${ALEX}');
		insert into public.actor (id, slug, kind, display_name) values ('${ALEX}', 'alex', 'human', 'Alex Example');
		insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Active', true, 1);
		insert into public.party (id, kind, name, created_by, updated_by)
		values ('${client}', 'org', 'Example Client', '${ALEX}', '${ALEX}');
		insert into public.client (id, party_id, created_by, updated_by)
		values ('${client}', '${client}', '${ALEX}', '${ALEX}');
		insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Lease', 1);
		insert into public.deal_phase (slug, label) values ('legal', 'Legal');
		insert into public.deal (id, client_id, name, deal_type, phase, owner, created_by, updated_by)
		values ('${copiedDeal}', '${client}', 'Example copied deal', 'lease', 'legal', 'alex', '${ALEX}', '${ALEX}');
		insert into public.event (actor_id, verb, subject_type, subject_id, field, new_value, cause, occurred_at, recorded_at)
		values ('${ALEX}', 'update-deal', 'deal', '${copiedDeal}', 'phase', '{"phase":"legal"}', 'human_stated',
			'2026-01-06T06:00:00Z', '2026-01-08T15:00:00Z');
		${await readSchema("copy-deals.sql")}
		commit;`)
		.catch(async (error: unknown) => {
			await db.query("rollback");
			throw error;
		});
	const [status, deal] = await read(copiedDeal);
	assert.equal(status, 200);
	assert.equal(deal.phase, "legal");
	assert.equal(deal.phase_saved_at, "2026-01-08T15:00:00+00:00");
});

test("a call's stated phase and date survive acceptance without an email milestone quote", async () => {
	const args = { kind: "phase_move", deal_id: REVIEW, to: "legal" };
	const dated = { ...args, on: "2026-01-06" };
	const [stored, proposal] = await propose(dated);
	assert.equal(stored, 201);
	assert.equal((await propose(dated))[1].proposal_id, proposal.proposal_id);
	assert.equal(
		(await propose({ ...args, to: "research" }))[1].error,
		"phase_not_eligible",
	);
	const [withoutDate, stale] = await propose(args);
	assert.equal(withoutDate, 201);
	assert.equal((await decide(proposal.proposal_id))[0], 200);
	assert.equal((await decide(stale.proposal_id))[1].error, "version_conflict");
	const { rows } = await db.query(
		"select phase, (happened_at at time zone 'America/Chicago')::date::text as day from deal_phase_change where deal_id = $1 order by happened_at desc limit 1",
		[REVIEW],
	);
	assert.deepEqual(rows, [{ phase: "legal", day: "2026-01-06" }]);
});

test("a call cannot suggest a date before the current phase began", async () => {
	const [status, body] = await propose({
		kind: "phase_move",
		deal_id: STEPS,
		to: "legal",
		on: "2026-01-04",
	});
	assert.deepEqual([status, body.error], [422, "phase_not_eligible"]);
});

for (const [when, deal, date] of [
	["before the current phase began", EARLY, "date '2026-01-04'"],
	["after today", FUTURE, "(now() at time zone 'America/Chicago')::date + 2"],
]) {
	test(`acceptance refuses a stored phase date ${when}`, async () => {
		const proposal = randomUUID();
		await db.query(`begin; select set_config('engine.job', 'call_capture', true);
			insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job,
				deal_id, from_phase, to_phase, phase_stated, phase_on)
			values ('${proposal}', 'phase_move', '${CALL}', 'call', 'Example move', 'call_capture',
				'${deal}', 'research', 'legal', true, ${date});
			commit;`);
		const [status, body] = await decide(proposal);
		assert.deepEqual(
			[status, body.error, body.rule],
			[422, "database_refused_the_statement", "proposal_phase_date"],
		);
		const { rows } = await db.query(
			"select status from proposal where id = $1",
			[proposal],
		);
		assert.deepEqual(rows, [{ status: "pending" }]);
	});
}

test("call capture can assign a suggested next step by user slug", async () => {
	const args = {
		kind: "next_step",
		deal_id: REVIEW,
		what: "Send the example plan",
	};
	const [unknown, refusal] = await propose({
		...args,
		owner: "unknown_example",
	});
	assert.deepEqual([unknown, refusal.error], [400, "unknown_owner"]);
	assert.equal(
		(await propose({ ...args, owner: "blair", owner_party_id: ALEX }))[0],
		400,
	);
	const [stored, proposal] = await propose({ ...args, owner: "blair" });
	assert.equal(stored, 201);
	const { rows } = await db.query(
		"select owner_party_id from proposal where id = $1",
		[proposal.proposal_id],
	);
	assert.deepEqual(rows, [{ owner_party_id: BLAIR }]);
	await db.query(`begin; select set_config('engine.user_id', '${ALEX}', true);
		update proposal set status = 'accepted' where id = '${proposal.proposal_id}'; commit;`);
	const step = await db.query(
		"select owner_party_id from next_step where id = $1",
		[proposal.proposal_id],
	);
	assert.deepEqual(step.rows, [{ owner_party_id: BLAIR }]);
});

for (const { kind, activity, deal, edits, owner, otherOwner } of [
	{
		kind: "call",
		activity: CALL,
		deal: SUGGESTED,
		edits: undefined,
		owner: ALEX,
		otherOwner: BLAIR,
	},
	{
		kind: "call",
		activity: CALL,
		deal: EDITED_OWNER,
		edits: { owner_party_id: BLAIR },
		owner: BLAIR,
		otherOwner: ALEX,
	},
	{
		kind: "meeting",
		activity: MEETING,
		deal: MEETING_DEAL,
		edits: undefined,
		owner: ALEX,
		otherOwner: BLAIR,
	},
]) {
	test(`accepting a ${kind} suggestion replaces the ${edits ? "edited owner's" : "accepting partner's"} open step`, async () => {
		const [oldStatus, old] = await post("next-steps", {
			deal_id: deal,
			what: "Call the example office",
			owner_party_id: owner,
			due_on: "2026-02-01",
			hold_until: "2026-02-01",
		});
		const [otherStatus, other] = await post("next-steps", {
			deal_id: deal,
			what: "Check example times",
			owner_party_id: otherOwner,
		});
		assert.equal(oldStatus, 201);
		assert.equal(otherStatus, 201);
		const [stored, proposal] = await propose({
			kind: "next_step",
			activity_id: activity,
			deal_id: deal,
			what: "Send the example plan",
			...(edits && { owner: "alex" }),
		});
		assert.equal(stored, 201);
		const path = `proposals/${proposal.proposal_id}/decision`;
		const body = { idempotency_key: randomUUID(), decision: "accept", edits };
		const [denied, refusal] = await save(job, path, body);
		assert.deepEqual([denied, refusal.error], [403, "user_decides"]);
		const partner = { user: "alex" };
		const [status, result] = await save(partner, path, body);
		assert.equal(status, 200, JSON.stringify(result));
		assert.equal(result.status, "accepted");
		assert.deepEqual(result.created, { next_step_id: proposal.proposal_id });
		assert.deepEqual(await save(partner, path, body), [
			200,
			{ ...result, replayed: true },
		]);
		const { rows } = await db.query(
			`select id, owner_party_id, status, done_at, resolution_reason from next_step where deal_id = $1`,
			[deal],
		);
		const state = new Map(rows.map(({ id, ...step }) => [id, step]));
		assert.equal(state.size, 3);
		assert.deepEqual(state.get(old.next_step_id), {
			owner_party_id: owner,
			status: "cancelled",
			done_at: null,
			resolution_reason: "Replaced by a new next step",
		});
		assert.equal(state.get(other.next_step_id)?.status, "open");
		assert.equal(state.get(proposal.proposal_id)?.owner_party_id, owner);
		assert.deepEqual((await read(deal))[1].next_step, {
			id: proposal.proposal_id,
			due_on: null,
		});
	});
}

test("an email suggestion cannot replace the owner's open deal step", async () => {
	const [created, existing] = await post("next-steps", {
		deal_id: EMAIL_DEAL,
		what: "Call the clinic",
	});
	assert.equal(created, 201);
	const [stored, proposal] = await save(
		{ job: "mail_capture", for_user: "alex" },
		"proposals",
		{
			idempotency_key: randomUUID(),
			activity_id: EMAIL,
			kind: "next_step",
			deal_id: EMAIL_DEAL,
			what: "Send available times",
			evidence: "Send available times.",
		},
	);
	assert.equal(stored, 201);
	const [status, conflict] = await decide(proposal.proposal_id);
	assert.deepEqual(
		[status, conflict.error, conflict.next_step_id],
		[409, "open_step_exists", existing.next_step_id],
	);
	const { rows } = await db.query("select status from proposal where id = $1", [
		proposal.proposal_id,
	]);
	assert.deepEqual(rows, [{ status: "pending" }]);
});

test("replacement cancels the saving owner's ordinary step and clears an omitted date", async () => {
	const args = { deal_id: STEPS, what: "Call the example office" };
	const create = (fields: object) => post("next-steps", { ...args, ...fields });
	const [unknown, refusal] = await create({ owner: "unknown_example" });
	assert.deepEqual([unknown, refusal.error], [400, "unknown_owner"]);
	assert.equal(
		(await create({ owner: "blair", owner_party_id: null }))[0],
		400,
	);
	const [assigned, other] = await create({ owner: "blair" });
	assert.equal(assigned, 201);
	const [checklist, item] = await create({
		item: { title: "Review example", bullets: [], source_ref: "example" },
	});
	assert.equal(checklist, 201);
	const [oldStatus, old] = await create({
		due_on: "2026-02-01",
		hold_until: "2026-02-01",
	});
	assert.equal(oldStatus, 201);
	assert.deepEqual((await read(STEPS))[1].next_step, {
		id: old.next_step_id,
		due_on: "2026-02-01",
	});

	const replace = {
		...args,
		what: "Send an example update",
		replaces: "current",
		idempotency_key: randomUUID(),
	};
	const [status, current] = await save(job, "next-steps", replace);
	assert.equal(status, 201);
	assert.deepEqual(await save(job, "next-steps", replace), [
		201,
		{ ...current, replayed: true },
	]);
	assert.deepEqual((await read(STEPS))[1].next_step, {
		id: current.next_step_id,
		due_on: null,
	});
	const { rows } = await db.query(
		"select id, owner_party_id, status, done_at from next_step where deal_id = $1",
		[STEPS],
	);
	const state = new Map(rows.map(({ id, ...step }) => [id, step]));
	assert.equal(state.size, 4);
	assert.deepEqual(state.get(old.next_step_id), {
		owner_party_id: ALEX,
		status: "cancelled",
		done_at: null,
	});
	assert.equal(state.get(current.next_step_id)?.status, "open");
	assert.equal(state.get(other.next_step_id)?.status, "open");
	assert.equal(state.get(other.next_step_id)?.owner_party_id, BLAIR);
	assert.equal(state.get(item.next_step_id)?.status, "open");
});

test("a waiting replacement cancels the step committed ahead of it", {
	timeout: 10000,
}, async (t) => {
	const held = randomUUID();
	await db.query(`begin; select set_config('engine.job', 'call_capture', true);
		select id from deal where id = '${CROSSED}' for no key update;
		insert into next_step (id, deal_id, owner_party_id, what)
		values ('${held}', '${CROSSED}', '${ALEX}', 'First call task');`);
	let settled = false;
	const pending = post("next-steps", {
		deal_id: CROSSED,
		what: "Second call task",
		replaces: "current",
	}).finally(() => {
		settled = true;
	});
	try {
		let waiting = false;
		while (!settled && !waiting) {
			t.signal.throwIfAborted();
			waiting = (
				await db.query(`select exists (
				select from pg_locks where not granted
				and pg_backend_pid() = any(pg_blocking_pids(pid))
			) as waiting`)
			).rows[0].waiting;
		}
		await db.query("commit");
		const [status, current] = await pending;
		assert.equal(status, 201, JSON.stringify(current));
		assert.ok(waiting);
		const { rows } = await db.query(
			"select status from next_step where id = $1",
			[held],
		);
		assert.deepEqual(rows, [{ status: "cancelled" }]);
		assert.deepEqual((await read(CROSSED))[1].next_step, {
			id: current.next_step_id,
			due_on: null,
		});
	} finally {
		await db.query("rollback");
		await pending;
	}
});
