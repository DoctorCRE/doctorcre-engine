import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [USER, CLIENT, DEAL, EMAIL, OTHER, PARTNER, IMPORTED] = [
	id(1),
	id(2),
	id(3),
	id(4),
	id(5),
	id(6),
	id(7),
];
const job = { job: "mail_capture", for_user: "alex" };
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into how_found (slug, label) values ('inbound', 'Inbound'), ('not_recorded', 'Not recorded');
 insert into role (slug, label) values ('client', 'Client'), ('lead', 'Lead');
 insert into stage (role, slug, label) values ('lead', 'new', 'New'), ('lead', 'qualified', 'Qualified');
 insert into deal_kind (slug, label) values ('lease', 'Lease'), ('purchase', 'Purchase');
 insert into phase (slug, label) values ('research', 'Research'), ('site_selection', 'Site Selection'), ('negotiation', 'Negotiating'), ('legal', 'Legal'), ('closing', 'Closing');
 insert into party (id, kind, name, how_found) values ('${USER}', 'person', 'Alex Example', null), ('${CLIENT}', 'company', 'Example Clinic', 'inbound');
 insert into app_user (id, slug) values ('${USER}', 'alex');
 insert into party (id, kind, name) values ('${PARTNER}', 'person', 'Casey Example');
 insert into app_user (id, slug) values ('${PARTNER}', 'casey');
 insert into party (id, kind, name, how_found, how_found_detail) values ('${IMPORTED}', 'person', 'Imported Example', 'not_recorded', 'Legacy import note');
 insert into outside_id (source, value, party_id) values ('old_system', 'example-import', '${IMPORTED}');
 insert into party_role (party_id, role) values ('${CLIENT}', 'client');
 insert into party_email (party_id, address, label) values ('${USER}', 'alex@example.test', 'work'), ('${CLIENT}', 'clinic@example.test', 'work');
 insert into deal (id, name, kind, owner_user_id) values ('${DEAL}', 'Example Deal', 'lease', '${USER}'), ('${OTHER}', 'Other Example', 'purchase', '${USER}');
 insert into deal_party (deal_id, party_id, role) values ('${DEAL}', '${CLIENT}', 'client');
 insert into deal_phase_change (deal_id, happened_at, phase) values ('${DEAL}', now() - interval '2 days', 'research');
 select set_config('engine.job', 'mail_capture', true), set_config('engine.user_id', '${USER}', true);
 insert into activity (id, kind, happened_at) values ('${EMAIL}', 'email', now() - interval '1 hour');
 insert into activity_about (activity_id, party_id) values ('${EMAIL}', '${CLIENT}');
 insert into email (activity_id, message_id, sender, subject, body) values ('${EMAIL}', 'example-624@example.test', 'clinic@example.test', 'Example tour', 'The tour is confirmed.');
 insert into email_mailbox (activity_id, user_id) values ('${EMAIL}', '${USER}'); commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});
const propose = (args: object) =>
	save(job, "proposals", {
		idempotency_key: randomUUID(),
		activity_id: EMAIL,
		evidence: "The tour is confirmed.",
		...args,
	});
const decide = (p: unknown, args: object) =>
	save({ user: "alex" }, `proposals/${p}/decision`, {
		idempotency_key: randomUUID(),
		decision: "accept",
		...args,
	});

const emailLead = (address: string) => ({
	idempotency_key: randomUUID(),
	address,
	display_name: "Dr. Example",
	summary: "Asked about opening a dental office.",
	first_seen_at: "2026-11-05T17:00:00Z",
	message_ref: "example-mail-reference",
	applies_to: "new_matter",
	confidence: 0.9,
	evidence_quote: "I am opening a dental office.",
});
const suggestSender = (request: object, caller = job) =>
	save(caller, "proposals/email-lead", request);
const contact = (address: string) =>
	db.query(
		`select p.id, p.name, p.how_found, r.stage, r.owner_user_id
		from party_email e join party p on p.id = e.party_id
		left join party_role r on r.party_id = p.id and r.role = 'lead'
		where e.address = $1`,
		[address],
	);

test("mail capture stores an unknown sender once and the mailbox owner accepts it as one lead", async () => {
	const address = "dentist@example.test";
	const request = emailLead(address.toUpperCase());
	const [stored, proposal] = await suggestSender(request);
	assert.equal(stored, 201);
	assert.equal(proposal.status, "pending");
	assert.deepEqual(await suggestSender(request), [
		201,
		{ ...proposal, replayed: true },
	]);
	assert.deepEqual(
		await suggestSender({
			...request,
			idempotency_key: randomUUID(),
			address,
			message_ref: "later-mail",
		}),
		[200, { ...proposal, existing: true }],
	);
	assert.deepEqual(
		(
			await db.query(
				`select c.status, c.name, c.qualification, c.source_row, p.activity_id
		from proposal p join candidate c on c.id = p.candidate_id where p.id = $1`,
				[proposal.proposal_id],
			)
		).rows,
		[
			{
				status: "unreviewed",
				name: request.display_name,
				qualification: request.summary,
				source_row: {
					address,
					message_ref: request.message_ref,
					first_seen_at: request.first_seen_at,
					reading: {
						applies_to: request.applies_to,
						confidence: request.confidence,
						evidence_quote: request.evidence_quote,
					},
				},
				activity_id: null,
			},
		],
	);
	assert.equal((await contact(address)).rowCount, 0);
	assert.equal(
		(
			await save(
				{ user: "casey" },
				`proposals/${proposal.proposal_id}/decision`,
				{
					idempotency_key: randomUUID(),
					decision: "accept",
				},
			)
		)[0],
		404,
	);
	const key = randomUUID();
	const [accepted, answer] = await decide(proposal.proposal_id, {
		idempotency_key: key,
	});
	assert.equal(accepted, 200);
	assert.equal(answer.status, "accepted");
	const [lead] = (await contact(address)).rows;
	assert.deepEqual(lead, {
		id: lead.id,
		name: request.display_name,
		how_found: "inbound",
		stage: "new",
		owner_user_id: USER,
	});
	assert.deepEqual(answer.created, { party_id: lead.id });
	assert.deepEqual(
		await decide(proposal.proposal_id, { idempotency_key: key }),
		[200, { ...answer, replayed: true }],
	);
	assert.equal(
		(await decide(proposal.proposal_id, {}))[1].error,
		"already_decided",
	);
	assert.equal((await contact(address)).rowCount, 1);
	assert.equal((await suggestSender(emailLead(address)))[1].status, "accepted");
});

test("a dismissed sender stays dismissed without creating a contact", async () => {
	const address = "dismissed@example.test";
	const [, p] = await suggestSender(emailLead(address));
	const [status, decision] = await decide(p.proposal_id, {
		decision: "dismiss",
	});
	assert.equal(status, 200);
	assert.equal(decision.status, "dismissed");
	assert.deepEqual(decision.created, {});
	assert.deepEqual(await suggestSender(emailLead(address)), [
		200,
		{
			proposal_id: p.proposal_id,
			status: "dismissed",
			existing: true,
		},
	]);
	assert.equal(
		(
			await db.query(
				"select status from candidate where source_row->>'address' = $1",
				[address],
			)
		).rows[0].status,
		"declined",
	);
	assert.equal((await contact(address)).rowCount, 0);
});

test("two mailboxes can suggest the same sender, but only one acceptance creates the lead", async () => {
	const address = "shared-sender@example.test";
	const [first, p] = await suggestSender(emailLead(address));
	const [second, other] = await suggestSender(emailLead(address), {
		...job,
		for_user: "casey",
	});
	assert.equal(first, 201);
	assert.equal(second, 201);
	const results = await Promise.all([
		decide(p.proposal_id, {}),
		save({ user: "casey" }, `proposals/${other.proposal_id}/decision`, {
			idempotency_key: randomUUID(),
			decision: "accept",
		}),
	]);
	assert.deepEqual(results.map(([code]) => code).sort(), [200, 422]);
	assert.equal(
		results.find(([code]) => code === 422)?.[1].rule,
		"email_lead_sender_known",
	);
	assert.equal((await contact(address)).rowCount, 1);
});

test("a known sender gets no new suggestion", async () => {
	assert.deepEqual(await suggestSender(emailLead("clinic@example.test")), [
		200,
		{ status: "known_party" },
	]);
});

test("a copied candidate keeps its place when intake proposes the same sender again", async () => {
	const candidate = id(9);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into candidate (id, source, source_key, source_row, name, qualification)
		values ('${candidate}', 'outlook-intake', 'email-sha256:alex:5dc7d19c68a369e06408a0be0edcda795d8df1225bdaa66f6a57fb803fd836b6',
			'{}', 'Copied Example', 'Inbound email'); commit;`);
	assert.deepEqual(
		await suggestSender(emailLead("copied-sender@example.test")),
		[200, { candidate_id: candidate, status: "already_queued" }],
	);
});

test("accepting a new lead replaces an imported not-recorded how-found value", async () => {
	const activity = id(8);
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into activity (id, kind, happened_at) values ('${activity}', 'call', '2026-11-05T17:00:00Z');
		insert into activity_about (activity_id, party_id) values ('${activity}', '${IMPORTED}'); commit;`);
	const [stored, p] = await propose({
		kind: "new_lead",
		activity_id: activity,
		party_id: IMPORTED,
		how_found: "inbound",
	});
	assert.equal(stored, 201);
	assert.equal((await decide(p.proposal_id, {}))[0], 200);
	assert.deepEqual(
		(
			await db.query(
				"select how_found, how_found_detail from party where id = $1",
				[IMPORTED],
			)
		).rows,
		[{ how_found: "inbound", how_found_detail: null }],
	);
});

test("suggestions converge across retries, edits create a step without changing its proposal, and only a user decides once", async () => {
	const args = {
		kind: "next_step",
		deal_id: DEAL,
		what: "Call the example clinic",
		owner_party_id: PARTNER,
	};
	const [status, p] = await propose(args);
	assert.equal(status, 201);
	assert.deepEqual(await propose(args), [
		200,
		{ proposal_id: p.proposal_id, status: "pending", existing: true },
	]);
	const denied = await save(job, `proposals/${p.proposal_id}/decision`, {
		idempotency_key: randomUUID(),
		decision: "accept",
	});
	assert.equal(denied[0], 403);
	assert.equal(denied[1].error, "user_decides");
	const key = randomUUID();
	const request = {
		idempotency_key: key,
		edits: {
			what: "Send the example plan",
			owner_party_id: USER,
			due_on: "2026-12-01",
		},
	};
	const [ok, answer] = await decide(p.proposal_id, request);
	assert.equal(ok, 200);
	assert.deepEqual(answer.created, { next_step_id: p.proposal_id });
	assert.deepEqual(await decide(p.proposal_id, request), [
		200,
		{ replayed: true, ...answer },
	]);
	const row = (
		await db.query(
			"select p.what as proposed, n.what, n.owner_party_id, n.due_on::text from proposal p join next_step n on n.id=p.id where p.id=$1",
			[p.proposal_id],
		)
	).rows[0];
	assert.deepEqual(row, {
		proposed: args.what,
		what: "Send the example plan",
		owner_party_id: USER,
		due_on: "2026-12-01",
	});
	assert.equal((await decide(p.proposal_id, {}))[1].error, "already_decided");
	assert.equal((await propose(args))[1].status, "accepted");
});

test("an accepted next step keeps its proposed owner or defaults to the partner who accepts it", async () => {
	const cases = [
		{ owner: undefined, ownerEdit: undefined },
		{ owner: USER, ownerEdit: undefined },
		{ owner: undefined, ownerEdit: null },
		{ owner: undefined, ownerEdit: "" },
		{ owner: USER, ownerEdit: null },
	];
	for (const [index, { owner, ownerEdit }] of cases.entries()) {
		const [status, proposal] = await propose({
			kind: "next_step",
			deal_id: OTHER,
			what: `Check the example dates ${index}`,
			owner_party_id: owner,
		});
		assert.equal(status, 201);
		const [accepted] = await save(
			{ user: "casey" },
			`proposals/${proposal.proposal_id}/decision`,
			{
				idempotency_key: randomUUID(),
				decision: "accept",
				edits:
					ownerEdit === undefined ? undefined : { owner_party_id: ownerEdit },
			},
		);
		assert.equal(accepted, 200);
		const { rows } = await db.query(
			"select owner_party_id from next_step where id=$1",
			[proposal.proposal_id],
		);
		assert.deepEqual(rows, [{ owner_party_id: owner ?? PARTNER }]);
		const [ended] = await save(
			{ user: "casey" },
			`next-steps/${proposal.proposal_id}/end`,
			{
				idempotency_key: randomUUID(),
				resolution: "done",
			},
		);
		assert.equal(ended, 200);
	}
});

test("a conflicting next-step acceptance stays pending and can use an edited owner", async () => {
	const [created, existing] = await save({ user: "alex" }, "next-steps", {
		idempotency_key: randomUUID(),
		party_id: CLIENT,
		what: "Call the clinic",
	});
	assert.equal(created, 201);
	const [stored, proposal] = await propose({
		kind: "next_step",
		party_id: CLIENT,
		what: "Send available times",
	});
	assert.equal(stored, 201);
	const [status, conflict] = await decide(proposal.proposal_id, {});
	assert.deepEqual(
		[status, conflict.error, conflict.next_step_id],
		[409, "open_step_exists", existing.next_step_id],
	);
	const saved = () =>
		db.query(
			`select p.status, p.owner_party_id as suggested_owner, s.owner_party_id as step_owner
		from proposal p left join next_step s using (id) where p.id=$1`,
			[proposal.proposal_id],
		);
	assert.deepEqual((await saved()).rows, [
		{ status: "pending", suggested_owner: null, step_owner: null },
	]);
	assert.equal(
		(
			await decide(proposal.proposal_id, { edits: { owner_party_id: PARTNER } })
		)[0],
		200,
	);
	assert.deepEqual((await saved()).rows, [
		{ status: "accepted", suggested_owner: null, step_owner: PARTNER },
	]);
});

test("a phase quote is derived at storage and refuses a stale acceptance", async () => {
	const [status, p] = await propose({ kind: "phase_move", deal_id: DEAL });
	assert.equal(status, 201);
	assert.equal((await decide(p.proposal_id, {}))[0], 200);
	assert.equal(
		(
			await db.query(
				"select phase from deal_phase_change where deal_id=$1 order by happened_at desc limit 1",
				[DEAL],
			)
		).rows[0].phase,
		"site_selection",
	);
	const [, stale] = await propose({
		kind: "phase_move",
		deal_id: DEAL,
		evidence: "The LOI arrived.",
	});
	await db.query(
		`begin; select set_config('engine.user_id', '${USER}', true); insert into deal_phase_change (deal_id, happened_at, phase) values ('${DEAL}', now(), 'negotiation'); commit;`,
	);
	const [conflict, body] = await decide(stale.proposal_id, {});
	assert.equal(conflict, 409);
	assert.equal(body.current_phase, "negotiation");
	assert.equal(
		(
			await db.query("select status from proposal where id=$1", [
				stale.proposal_id,
			])
		).rows[0].status,
		"pending",
	);
	assert.equal(
		(
			await propose({
				kind: "phase_move",
				deal_id: DEAL,
				evidence: "Hello there",
			})
		)[1].error,
		"phase_not_eligible",
	);
});

test("filing accepts the suggested deal, requires a correction reason, and never creates a deal", async () => {
	const [, p] = await propose({ kind: "file_to_deal", deal_id: DEAL });
	assert.equal((await decide(p.proposal_id, {}))[0], 200);
	const [, fresh] = await propose({ kind: "possible_new_deal" });
	assert.equal(
		(await decide(fresh.proposal_id, {}))[1].rule,
		"proposal_filing_open_deal",
	);
	assert.equal(
		(await decide(fresh.proposal_id, { deal_id: OTHER }))[1].rule,
		"proposal_filing_reason",
	);
	assert.equal(
		(
			await decide(fresh.proposal_id, {
				deal_id: OTHER,
				reason: "Partner corrected the filing",
			})
		)[0],
		200,
	);
	assert.equal(
		(await db.query("select count(*)::int as n from deal")).rows[0].n,
		2,
	);
	assert.deepEqual(
		(
			await db.query(
				"select deal_id from activity_about where activity_id=$1 and deal_id is not null",
				[EMAIL],
			)
		).rows.map((r) => r.deal_id),
		[OTHER],
	);
	assert.equal(
		(
			await db.query(
				"select party_id from activity_about where activity_id=$1 and party_id is not null",
				[EMAIL],
			)
		).rows[0].party_id,
		CLIENT,
	);
});

test("lead suggestions require activity linkage, and dismissed suggestions stay dismissed", async () => {
	const [, p] = await propose({
		kind: "new_lead",
		party_id: CLIENT,
		how_found: "inbound",
	});
	assert.equal((await decide(p.proposal_id, {}))[0], 200);
	const [, move] = await propose({
		kind: "lead_stage_move",
		party_id: CLIENT,
		from_stage: "new",
		to_stage: "qualified",
		strength: "strong",
	});
	assert.equal((await decide(move.proposal_id, {}))[0], 200);
	assert.equal(
		(
			await db.query(
				"select stage from party_role where party_id=$1 and role='lead'",
				[CLIENT],
			)
		).rows[0].stage,
		"qualified",
	);
	const [, dismissed] = await propose({
		kind: "next_step",
		party_id: CLIENT,
		what: "Example dismissed step",
	});
	assert.equal(
		(await decide(dismissed.proposal_id, { decision: "dismiss" }))[0],
		200,
	);
	assert.equal(
		(
			await propose({
				kind: "next_step",
				party_id: CLIENT,
				what: "Example dismissed step",
			})
		)[1].status,
		"dismissed",
	);
	assert.equal(
		(
			await propose({ kind: "new_lead", party_id: USER, how_found: "inbound" })
		)[0],
		422,
	);
	assert.equal(
		(await propose({ kind: "next_step", what: "Missing target" }))[1].rule,
		"proposal_one_record",
	);
	assert.equal(
		(
			await propose({
				kind: "next_step",
				deal_id: DEAL,
				what: "Missing source",
				activity_id: id(99),
			})
		)[0],
		404,
	);
});

test("the queue pages oldest first within the mailbox stamp and excludes old mail", async () => {
	await db.query(`begin; select set_config('engine.job', 'mail_capture', true), set_config('engine.user_id', '${USER}', true);
  insert into activity (id, kind, happened_at) values ('${id(21)}', 'email', now()), ('${id(22)}', 'email', now() - interval '31 days');
  insert into activity_about (activity_id, party_id) values ('${id(21)}', '${CLIENT}'), ('${id(22)}', '${CLIENT}');
  insert into email (activity_id, message_id, sender, subject, body) values
   ('${id(21)}', 'second@example.test', 'clinic@example.test', 'Second example', 'Example'),
   ('${id(22)}', 'old@example.test', 'clinic@example.test', 'Old example', 'Example');
  insert into email_mailbox (activity_id, user_id) values
   ('${id(21)}', '${USER}'), ('${id(22)}', '${USER}');
  select set_config('engine.user_id', '${PARTNER}', true);
  insert into email_mailbox (activity_id, user_id) values ('${EMAIL}', '${PARTNER}');
  alter table email_mailbox disable trigger stamp_change;
  update email_mailbox set changed_at = now() - interval '4 days' where activity_id = '${id(21)}' and user_id = '${USER}';
  alter table email_mailbox enable trigger stamp_change;
  insert into activity (id, kind, happened_at) values ('${id(23)}', 'email', now());
  insert into activity_about (activity_id, party_id) values ('${id(23)}', '${CLIENT}');
  insert into email (activity_id, message_id, sender, subject, body) values ('${id(23)}', 'other@example.test', 'clinic@example.test', 'Other mailbox', 'Example');
  insert into email_mailbox (activity_id, user_id) values ('${id(23)}', '${PARTNER}');
  select set_config('engine.user_id', '${USER}', true);
  insert into activity (id, kind, happened_at) values ('${id(24)}', 'email', now());
  insert into email (activity_id, message_id, sender, subject, body) values ('${id(24)}', 'fresh@example.test', 'clinic@example.test', 'Fresh mailbox', 'Example');
  insert into activity_about (activity_id, party_id) values ('${id(24)}', '${CLIENT}');
  insert into email_mailbox (activity_id, user_id) values ('${id(24)}', '${USER}'); commit;`);
	const [ok, body] = await save(job, "router-queue?limit=1", {}, "GET");
	assert.equal(ok, 200);
	assert.ok(Array.isArray(body.emails));
	assert.equal(body.emails.length, 1);
	assert.equal(body.emails[0].activity_id, EMAIL);
	assert.equal(body.emails[0].sender.party_id, CLIENT);
	assert.equal(body.emails[0].mailbox_user, "alex");
	const [partnerStatus, partner] = await save(
		{ ...job, for_user: "casey" },
		"router-queue",
		{},
		"GET",
	);
	assert.equal(partnerStatus, 200);
	assert.ok(Array.isArray(partner.emails));
	assert.deepEqual(
		partner.emails.map((e) => [e.activity_id, e.mailbox_user]),
		[
			[EMAIL, "casey"],
			[id(23), "casey"],
		],
	);
	assert.equal(body.next_cursor, EMAIL);
	const [, page] = await save(
		job,
		`router-queue?limit=1&after=${EMAIL}`,
		{},
		"GET",
	);
	assert.ok(Array.isArray(page.emails));
	assert.equal(page.emails.length, 1);
	assert.equal(page.emails[0].activity_id, id(24));
	assert.equal(page.next_cursor, null);
	assert.equal((await save(job, "router-queue?days=8", {}, "GET"))[0], 400);
	assert.equal(
		(await save({ user: "alex" }, "router-queue", {}, "GET"))[0],
		404,
	);
	assert.equal((await save({ user: "alex" }, "proposals", {}, "POST"))[0], 404);
});

test("the queue suppresses only automatic filings removed by a partner", async () => {
	await db.query(`begin; select set_config('engine.job', 'mail_capture', true), set_config('engine.user_id', '${USER}', true);
 insert into activity (id, kind, happened_at) values ('${id(31)}', 'email', now() - interval '2 hours');
 insert into email (activity_id, message_id, sender, subject, body) values ('${id(31)}', 'suppression@example.test', 'clinic@example.test', 'Example filing', 'Example');
 insert into email_mailbox (activity_id, user_id) values ('${id(31)}', '${USER}');
 insert into activity_about (activity_id, party_id) values ('${id(31)}', '${CLIENT}');
 insert into activity_about (activity_id, deal_id) values ('${id(31)}', '${DEAL}');
 select set_config('engine.job', '', true);
 insert into activity_about (activity_id, deal_id) values ('${id(31)}', '${OTHER}');
 delete from activity_about where activity_id = '${id(31)}' and deal_id is not null; commit;`);
	const [status, body] = await save(job, "router-queue", {}, "GET");
	assert.equal(status, 200);
	assert.ok(Array.isArray(body.emails));
	assert.deepEqual(
		body.emails.find((e) => e.activity_id === id(31)).suppressed_deal_ids,
		[DEAL],
	);
});

test("shared addresses stay unknown in both queued mail and its thread", async () => {
	await db.query(`begin; select set_config('engine.user_id', '${USER}', true);
 insert into party_email (party_id, address, label) values ('${USER}', 'clinic@example.test', 'personal');
 select set_config('engine.job', 'mail_capture', true);
 insert into activity (id, kind, happened_at) values ('${id(32)}', 'email', now() - interval '5 hours'), ('${id(33)}', 'email', now() - interval '4 hours');
 insert into activity_about (activity_id, deal_id) values ('${id(32)}', '${DEAL}'), ('${id(33)}', '${DEAL}');
 insert into email (activity_id, message_id, sender, subject, body) values ('${id(32)}', 'shared-old@example.test', 'clinic@example.test', 'Shared example', 'Example'), ('${id(33)}', 'shared-new@example.test', 'clinic@example.test', 'Re: Shared example', 'Example');
 insert into email_mailbox (activity_id, user_id) values ('${id(32)}', '${USER}'), ('${id(33)}', '${USER}'); commit;`);
	try {
		const [status, body] = await save(job, "router-queue", {}, "GET");
		assert.equal(status, 200);
		assert.ok(Array.isArray(body.emails));
		assert.equal(
			body.emails.find((e) => e.activity_id === id(32)).sender.party_id,
			null,
		);
		assert.equal(
			body.emails
				.find((e) => e.activity_id === id(33))
				.thread.find((e: { activity_id: string }) => e.activity_id === id(32))
				.sender.party_id,
			null,
		);
	} finally {
		await db.query(
			`begin; select set_config('engine.user_id', '${USER}', true); delete from party_email where party_id = '${USER}' and address = 'clinic@example.test'; commit;`,
		);
	}
});

test("the queue uses work domains, company clients and the deal market", async () => {
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into market (id, name) values ('${id(40)}', 'Example Metro');
 update deal set market_id = '${id(40)}' where id = '${DEAL}';
 insert into party (id, kind, name) values ('${id(41)}', 'person', 'Morgan Example');
 insert into party_email (party_id, address, label) values ('${USER}', 'alex@public.test', 'personal'), ('${id(41)}', 'morgan@public.test', 'work');
 insert into party_company (person_id, company_id) values ('${id(41)}', '${CLIENT}');
 select set_config('engine.job', 'mail_capture', true), set_config('engine.user_id', '${USER}', true);
 insert into activity (id, kind, happened_at) values ('${id(42)}', 'email', now() - interval '3 hours'), ('${id(43)}', 'email', now() - interval '4 hours');
 insert into activity_about (activity_id, deal_id) values ('${id(42)}', '${DEAL}'), ('${id(43)}', '${DEAL}');
 insert into email (activity_id, message_id, sender, subject, body) values ('${id(42)}', 'known@example.test', 'morgan@public.test', 'Example known', 'Example'), ('${id(43)}', 'unknown@example.test', 'stranger@public.test', 'Fwd: Example known', 'Example');
 insert into email_mailbox (activity_id, user_id) values ('${id(42)}', '${USER}'), ('${id(43)}', '${USER}'); commit;`);
	const [status, body] = await save(job, "router-queue", {}, "GET");
	assert.equal(status, 200);
	assert.ok(Array.isArray(body.emails));
	const known = body.emails.find((e) => e.activity_id === id(42));
	assert.equal(known.sender.internal, false);
	assert.equal(known.sender.role, "client");
	assert.deepEqual(known.sender.client_party_ids, [CLIENT]);
	assert.equal(
		body.emails.find((e) => e.activity_id === id(43)).sender.internal,
		false,
	);
	assert.equal(
		known.thread.find((e: { activity_id: string }) => e.activity_id === id(43))
			.sender.internal,
		false,
	);
	assert.equal(
		body.emails.find((e) => e.activity_id === EMAIL).sender.internal,
		true,
	);
	assert.ok(Array.isArray(body.open_deals));
	assert.equal(
		body.open_deals.find((d) => d.deal_id === DEAL).city,
		"Example Metro",
	);
});

test("the queue follows Outlook conversations and falls back to subject for mail without an id", async () => {
	await db.query(`begin; select set_config('engine.job', 'mail_capture', true), set_config('engine.user_id', '${USER}', true);
 insert into activity (id, kind, happened_at) values
  ('${id(51)}', 'email', now() - interval '60 days'), ('${id(52)}', 'email', now() - interval '2 days'),
  ('${id(53)}', 'email', now() - interval '1 day'), ('${id(54)}', 'email', now() - interval '1 hour'),
  ('${id(55)}', 'email', now()), ('${id(56)}', 'email', now() - interval '31 days');
 insert into email (activity_id, message_id, conversation_id, sender, sender_name, subject, body) values
  ('${id(51)}', 'prior@example.test', 'Thread-A', 'prior@outside.test', 'Prior Sender', 'Changed subject', 'Example'),
  ('${id(52)}', 'other-thread@example.test', 'Thread-B', 'prior@outside.test', null, 'New space', 'Example'),
  ('${id(53)}', 'no-thread@example.test', null, 'prior@outside.test', null, 'New space', 'Example'),
  ('${id(54)}', 'same-thread@example.test', 'Thread-A', 'current@outside.test', 'Current Sender', 'New space', 'Example'),
  ('${id(55)}', 'same-subject@example.test', null, 'clinic@example.test', 'Raw Name', ' Fwd: Re:  NEW   SPACE ', 'Example'),
  ('${id(56)}', 'old-subject@example.test', null, 'prior@outside.test', null, 'New space', 'Example');
 insert into activity_about (activity_id, deal_id) select id, '${DEAL}' from activity where id between '${id(51)}' and '${id(56)}';
 insert into email_mailbox (activity_id, user_id) values ('${id(54)}', '${USER}'), ('${id(55)}', '${USER}');
 insert into email_recipient (activity_id, position, address, kind) values
  ('${id(51)}', 1, 'clinic@example.test', 'to'), ('${id(51)}', 0, 'outside@outside.test', 'cc'),
  ('${id(54)}', 1, 'outside@outside.test', 'cc'), ('${id(54)}', 0, 'clinic@example.test', 'to');
 commit;`);
	const [status, body] = await save(job, "router-queue", {}, "GET");
	assert.equal(status, 200);
	assert.ok(Array.isArray(body.emails));
	const conversation = body.emails.find((e) => e.activity_id === id(54));
	const subject = body.emails.find((e) => e.activity_id === id(55));
	assert.equal(conversation.conversation_id, "Thread-A");
	assert.equal(conversation.sender.name, "Current Sender");
	assert.equal(subject.sender.name, "Example Clinic");
	assert.deepEqual(
		conversation.thread.map(
			(entry: { activity_id: string }) => entry.activity_id,
		),
		[id(51)],
	);
	assert.deepEqual(
		subject.thread.map((entry: { activity_id: string }) => entry.activity_id),
		[id(53)],
	);
	const prior = conversation.thread[0];
	assert.equal(prior.conversation_id, "Thread-A");
	assert.equal(prior.sender.name, "Prior Sender");
	const people = (
		recipients: { address: string; kind: string; party_id: string | null }[],
	) =>
		recipients.map(({ address, kind, party_id }) => [address, kind, party_id]);
	const clinic = ["clinic@example.test", "to", CLIENT];
	const outside = ["outside@outside.test", "cc", null];
	assert.deepEqual(people(conversation.recipients), [clinic, outside]);
	assert.deepEqual(people(prior.recipients), [outside, clinic]);
	assert.deepEqual(subject.recipients, []);
});
