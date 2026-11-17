import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [USER, CLIENT, DEAL, EMAIL, OTHER] = [id(1), id(2), id(3), id(4), id(5)];
const job = { job: "mail_capture", for_user: "alex" };
before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into how_found (slug, label) values ('inbound', 'Inbound');
 insert into role (slug, label) values ('client', 'Client'), ('lead', 'Lead');
 insert into stage (role, slug, label) values ('lead', 'new', 'New'), ('lead', 'qualified', 'Qualified');
 insert into deal_kind (slug, label) values ('lease', 'Lease'), ('purchase', 'Purchase');
 insert into phase (slug, label) values ('research', 'Research'), ('site_selection', 'Site Selection'), ('negotiation', 'Negotiating'), ('legal', 'Legal'), ('closing', 'Closing');
 insert into party (id, kind, name, how_found) values ('${USER}', 'person', 'Alex Example', null), ('${CLIENT}', 'company', 'Example Clinic', 'inbound');
 insert into app_user (id, slug) values ('${USER}', 'alex');
 insert into party_role (party_id, role) values ('${CLIENT}', 'client');
 insert into party_email (party_id, address, label) values ('${USER}', 'alex@example.test', 'work'), ('${CLIENT}', 'clinic@example.test', 'work');
 insert into deal (id, name, kind, owner_user_id) values ('${DEAL}', 'Example Deal', 'lease', '${USER}'), ('${OTHER}', 'Other Example', 'purchase', '${USER}');
 insert into deal_party (deal_id, party_id, role) values ('${DEAL}', '${CLIENT}', 'client');
 insert into deal_phase_change (deal_id, happened_at, phase) values ('${DEAL}', now() - interval '2 days', 'research');
 select set_config('engine.job', 'mail_capture', true), set_config('engine.user_id', '${USER}', true);
 insert into activity (id, kind, happened_at) values ('${EMAIL}', 'email', now() - interval '1 hour');
 insert into activity_about (activity_id, party_id) values ('${EMAIL}', '${CLIENT}');
 insert into email (activity_id, message_id, sender, subject, body) values ('${EMAIL}', 'example-624@example.test', 'clinic@example.test', 'Example tour', 'The tour is confirmed.'); commit;`);
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

test("suggestions converge across retries, edits create a step without changing its proposal, and only a user decides once", async () => {
	const args = {
		kind: "next_step",
		deal_id: DEAL,
		what: "Call the example clinic",
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
	assert.equal(
		(
			await db.query(
				"select count(*)::int as n from activity_about where activity_id=$1 and deal_id is not null",
				[EMAIL],
			)
		).rows[0].n,
		2,
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
  select set_config('engine.job', 'old_system', true), set_config('engine.user_id', '', true);
  insert into activity (id, kind, happened_at) values ('${id(23)}', 'email', now());
  insert into activity_about (activity_id, party_id) values ('${id(23)}', '${CLIENT}');
  insert into email (activity_id, message_id, sender, subject, body) values ('${id(23)}', 'unowned@example.test', 'clinic@example.test', 'Other mailbox', 'Example'); commit;`);
	const [ok, body] = await save(job, "router-queue?limit=1", {}, "GET");
	assert.equal(ok, 200);
	assert.ok(Array.isArray(body.emails));
	assert.equal(body.emails.length, 1);
	assert.equal(body.emails[0].activity_id, EMAIL);
	assert.equal(body.emails[0].sender.party_id, CLIENT);
	assert.equal(body.next_cursor, EMAIL);
	const [, page] = await save(
		job,
		`router-queue?limit=1&after=${EMAIL}`,
		{},
		"GET",
	);
	assert.ok(Array.isArray(page.emails));
	assert.equal(page.emails.length, 1);
	assert.equal(page.emails[0].activity_id, id(21));
	assert.equal(page.next_cursor, null);
	assert.equal((await save(job, "router-queue?days=8", {}, "GET"))[0], 400);
	assert.equal(
		(await save({ user: "alex" }, "router-queue", {}, "GET"))[0],
		404,
	);
	assert.equal((await save({ user: "alex" }, "proposals", {}, "POST"))[0], 404);
});
