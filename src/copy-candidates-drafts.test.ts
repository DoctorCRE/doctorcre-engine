import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { copyTest, readSchema } from "./test-copy.ts";
import { doorTest } from "./test-door.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const { db, setup, cleanup } = copyTest();
const copy = await readSchema("copy-candidates-drafts.sql");
const rows = async (sql: string) =>
	(await db.query(sql)).rows.map(Object.values);
type CopyRefusal = { old_id: string; reason: string; value: string | null };
const run = async (database = db): Promise<CopyRefusal[]> => {
	const result = await database.query<CopyRefusal>(`begin; ${copy}; commit;`);
	assert.ok(Array.isArray(result));
	return result.at(-2)?.rows ?? [];
};
const [user, agent, sweep, helper] = [id(1), id(2), id(3), id(4)] as const;
// Old lead n is on party n - 10; leads 20 to 27 are copied, except 24, and 22 and 23 share a party.
const copiedLeads = [20, 21, 22, 23, 25, 26, 27];
const party = (lead: number) => id(lead === 23 ? 12 : lead - 10);
const insert = (table: string, row: Record<string, string | number>) =>
	`insert into public.${table} (${Object.keys(row)}) values (${Object.values(row).map((v) => `'${v}'`)});`;
const draft = (n: number, lead: number, fields = {}) =>
	insert("lead_contact_draft", {
		id: id(n),
		lead_id: id(lead),
		party_id: id(lead - 10),
		owner_id: user,
		subject: "Example subject",
		body: "Example body",
		scheduled_for: "2025-04-01",
		time_zone: "America/Chicago",
		created_by: sweep,
		created_at: "2025-01-01",
		...fields,
	});
const candidate = (n: number, status: string, fields = {}) =>
	insert("candidate_pool", {
		id: id(n),
		source: "Example pool",
		source_key: `key-${n}`,
		source_seq: n,
		source_row: `{"column": "Example ${n}"}`,
		name: `Example candidate ${n}`,
		score_basis: "Example qualification",
		status,
		created_by: sweep,
		updated_by: sweep,
		created_at: "2025-01-01",
		updated_at: "2025-01-02",
		...fields,
	});
const statusEvent = (
	n: number,
	actor: string,
	status: string,
	extra = "",
	sponsor: string | null = null,
) =>
	`insert into public.event (occurred_at,actor_id,verb,subject_type,subject_id,field,new_value,cause,sponsoring_human_slug) values ('2025-02-05','${actor}','promote-pool','candidate_pool','${id(n)}','status','{"status": "${status}"${extra}}','human_stated',${sponsor ? `'${sponsor}'` : "null"});`;
let report: CopyRefusal[];

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job','old_system',true);
 insert into public.actor (id,slug,kind,display_name) values ('${user}','partner_one','human','Example User'),
  ('${agent}','claude','automation','Example agent'), ('${sweep}','example_sweep','automation','Example sweep'),
  ('${helper}','example_helper','human','Example helper');
 insert into party (id,kind,name) values ('${user}','person','Example User');
 insert into app_user (id, slug) values ('${user}', 'user-${user}');
 insert into outside_id (source,value,party_id) values ('old_system','${user}','${user}');
 insert into how_found (slug,label) values ('referral','Referral');
 insert into role (slug,label) values ('lead','Lead');
 insert into stage (role,slug,label) values ('lead','new','New');
 insert into public.lead_stage (slug,label) values ('new','New');
 insert into public.contact_state (slug,label,contactable,sort) values ('active','Example active',true,1);
 ${[20, 21, 22, 23, 24, 25, 26, 27]
		.map(
			(
				n,
			) => `insert into public.party (id,kind,name,created_by,updated_by) values ('${id(n - 10)}','person','Example ${n}','${user}','${user}');
 insert into public.lead (id,party_id,stage,created_by,updated_by) values ('${id(n)}','${id(n - 10)}','new','${user}','${user}');`,
		)
		.join("\n")}
 ${[...new Set(copiedLeads.map(party))]
		.map(
			(
				p,
			) => `insert into party (id,kind,name,how_found) values ('${p}','person','Example lead','referral');
 insert into party_role (party_id,role,stage) values ('${p}','lead','new');`,
		)
		.join("\n")}
 ${copiedLeads.map((n) => `insert into outside_id (source,value,party_id) values ('old_system','${id(n)}','${party(n)}');`).join("\n")}
 insert into lead_contact_draft (id,party_id,subject,body,scheduled_for,time_zone) values ('${id(99)}','${id(17)}','Existing','Existing','2025-04-01','UTC');
 insert into candidate (source,source_key,source_row,name,qualification) values ('Example pool','key-53','{}','Existing','Existing');
 ${draft(30, 20, { revision: 2, approved_by: user, approved_at: "2025-03-01" })}
 insert into public.event (occurred_at,actor_id,verb,subject_type,subject_id,new_value,cause) values
  ('2025-03-01','${user}','approve-lead-draft','lead','${id(20)}','{"draft_id": "${id(30)}"}','human_stated');
 ${draft(31, 21, { owner_id: sweep, time_zone: " " })}
 ${draft(32, 22)} ${draft(33, 23)} ${draft(34, 24)}
 ${draft(35, 25, { approved_by: helper, approved_at: "2025-03-01" })}
 ${draft(36, 26, { subject: " ", body: " " })}
 ${draft(37, 27)}
 ${candidate(40, "pool", { est_lease_event: "2027-01-01", est_basis: "Example basis", confirmed_at: "2025-01-03", confirmed_by: user })}
 ${candidate(41, "promoted", { promoted_lead_id: id(20) })} ${statusEvent(41, agent, "promoted", "", "partner_one")}
 ${candidate(42, "declined", { declined_at: "2025-02-02", declined_by: user, decline_reason: "Example decline" })}
 ${candidate(43, "suppressed_dup", { dup_tier: "suppressed", dup_subject_type: "lead", dup_basis: "Example duplicate" })}
 ${candidate(44, "expired", { updated_by: user, updated_at: "2025-02-04" })}
 ${candidate(45, "confirmed")} ${statusEvent(45, user, "confirmed", `, "party_id": "${id(10)}", "deal_id": null`)}
 ${candidate(46, "promoted", { promoted_lead_id: id(21) })}
 ${candidate(47, "declined", { declined_at: "2025-02-02", declined_by: sweep, decline_reason: "Example decline" })}
 ${candidate(48, "pool", { score_basis: " " })}
 ${candidate(49, "pool", { est_lease_event: "2027-01-01" })}
 ${candidate(50, "promoted", { promoted_lead_id: id(24) })} ${statusEvent(50, user, "promoted")}
 ${candidate(51, "suppressed_dup", { dup_tier: "suppressed", dup_subject_type: "lead", dup_basis: " " })}
 ${candidate(52, "pool", { source: "Example pool " })}
 ${candidate(53, "pool", { source_key: "key-53" })}
 ${candidate(54, "promoted", { promoted_lead_id: id(22) })} ${statusEvent(54, helper, "promoted")}
 ${candidate(55, "pool")} ${candidate(56, "expired", { updated_by: agent })}
 insert into public.event (occurred_at,recorded_at,actor_id,verb,subject_type,subject_id,new_value,cause,sponsoring_human_slug) values
  ('2025-01-01','2025-01-01','${sweep}','propose-email-lead','candidate_pool','${id(55)}','{}','ingest_email','partner_one'),
  ('2025-02-06','2025-02-06','${agent}','clear-the-deck-apply','clear_the_deck','${id(98)}','{"kind": "candidate", "action": "drop", "rows": [{"id": "${id(56)}"}]}','human_stated','partner_one');
 commit;`);
	report = await run();
});
after(cleanup);

// Each row as one line: its values, then when it last changed and by whom.
const who = `changed_at::date || ' ' || coalesce(changed_by_job || coalesce(' for ' || right(changed_for_user_id::text, 2), ''), 'user ' || right(changed_by_user_id::text, 2))`;
const lines = async (sql: string) => (await rows(sql)).map(([line]) => line);
const history = (table: string, n: number) =>
	lines(
		`select concat_ws(' | ', action, old_value, new_value - '{subject,body,scheduled_for,time_zone,source_row,name,qualification,source,source_key,created_at,estimated_lease_on,lease_estimate_source,owner_user_id,party_id,requires_human_send,dispatchable,role,id}'::text[], ${who}) from change where table_name = '${table}' and record = '{"id": "${id(n)}"}' order by id`,
	);
const listed = (pairs: string) => {
	const got = new Set(report.map((r) => `${r.old_id.slice(-2)} ${r.reason}`));
	for (const pair of pairs.split(", ")) assert.ok(got.has(pair), pair);
};

test("drafts copy with their approval and its history, and every draft that would need a guess is listed", async () => {
	assert.deepEqual(
		await lines(
			`select concat_ws(' | ', right(id::text, 2), right(party_id::text, 2), right(owner_user_id::text, 2), revision, approved, ${who}) from lead_contact_draft where id <> '${id(99)}'`,
		),
		["30 | 10 | 01 | 2 | t | 2025-03-01 user 01"],
	);
	assert.deepEqual(await history("lead_contact_draft", 30), [
		'insert | {"approved": false, "revision": 2} | 2025-01-01 old_system',
		'update | {"approved": false} | {"approved": true} | 2025-03-01 user 01',
	]);
	listed(
		"31 owner_not_a_user, 31 blank_time_zone, 32 several_drafts_on_one_lead, 33 several_drafts_on_one_lead, 34 lead_not_copied, 35 approval_needs_user, 36 blank_subject, 36 blank_body, 37 lead_has_another_draft",
	);
});

test("candidates keep their decision, its user and history, and refusals are listed rather than invented", async () => {
	assert.deepEqual(
		await lines(
			`select concat_ws(' | ', right(id::text, 2), status, reason, right(promoted_party_id::text, 2), estimated_lease_on, lease_estimate_source, qualification, ${who}) from candidate where source_key <> 'key-53' or id = '${id(53)}' order by id`,
		),
		[
			"40 | unreviewed | 2027-01-01 | Example basis | Example qualification | 2025-01-03 user 01",
			"41 | promoted | 10 | Example qualification | 2025-02-05 agent for 01",
			"42 | declined | Example decline | Example qualification | 2025-02-02 user 01",
			"43 | suppressed | Example duplicate | Example qualification | 2025-01-01 old_system",
			"44 | suppressed | Expired by Clear the deck | Example qualification | 2025-02-04 user 01",
			"49 | unreviewed | Example qualification | 2025-01-01 old_system",
			"55 | unreviewed | Example qualification | 2025-01-01 mail_capture for 01",
			"56 | suppressed | Expired by Clear the deck | Example qualification | 2025-02-06 agent for 01",
		],
	);
	const [context] = await lines(
		`select source_row from candidate where id = '${id(40)}'`,
	);
	assert.deepEqual(context.row, { column: "Example 40" });
	assert.equal(context.pool.source_seq, 40);
	assert.equal(context.pool.confirmed_by, user);
	assert.ok(!("source_row" in context.pool));
	assert.deepEqual(await history("candidate", 41), [
		'insert | {"reason": null, "status": "unreviewed", "lead_role": null, "promoted_party_id": null} | 2025-01-01 old_system',
		`update | {"status": "unreviewed", "lead_role": null, "promoted_party_id": null} | {"status": "promoted", "lead_role": "lead", "promoted_party_id": "${id(10)}"} | 2025-02-05 agent for 01`,
	]);
	assert.equal(
		(await history("candidate", 40)).at(-1),
		`update | {"confirmed_at": null, "confirmed_by": null} | {"confirmed_at": "2025-01-03T00:00:00+00:00", "confirmed_by": "${user}"} | 2025-01-03 user 01`,
	);
	listed(
		"45 confirmed_without_lead, 46 decision_needs_user, 47 decision_needs_user, 48 missing_qualification, 49 estimate_needs_source, 50 promoted_lead_not_copied, 51 rejection_needs_reason, 52 untrimmed_or_blank_source, 53 source_key_taken, 54 decision_needs_user",
	);
	assert.ok(
		report.some(
			(r) =>
				r.old_id === id(45) &&
				r.value &&
				JSON.parse(r.value).party_id === id(10),
		),
	);
});

test("a rerun lists the same values and leaves copied rows, stamps and history unchanged", async () => {
	const snapshot = () =>
		rows(
			"select (select jsonb_agg(c order by id) from candidate c), (select jsonb_agg(d order by id) from lead_contact_draft d), (select jsonb_agg(h order by id) from change h)",
		);
	const original = await snapshot();
	assert.deepEqual(await run(), report);
	assert.deepEqual(await snapshot(), original);
	assert.deepEqual(
		await rows(
			"select tgname from pg_trigger where tgrelid in ('candidate'::regclass, 'lead_contact_draft'::regclass, 'change'::regclass) and not tgisinternal and tgenabled <> 'O'",
		),
		[],
	);
});

test("a copied email lead can be decided by its own mailbox partner", async (t) => {
	const door = doorTest();
	await door.setup();
	t.after(async () => {
		await door.db.query("rollback");
		await door.cleanup();
	});
	const reading = {
		applies_to: "existing_deal",
		deal_id: id(71),
		confidence: 0.9,
		evidence_quote: "Could we see the space next week?",
	};
	const pending = (
		n: number,
		mailbox: string,
		basis: string,
		reading?: object,
		fields = {},
	) =>
		candidate(n, "pool", {
			source: "outlook-intake",
			source_row: JSON.stringify({
				mailbox_owner: mailbox,
				message_ref: `example-ref-${n}`,
				reading,
			}),
			email: `sender-${n}@example.test`,
			score_basis: `Inbound email: Example summary ${n}${basis}`,
			...fields,
		});
	await door.db.query(`begin; select set_config('engine.job', 'old_system', true);
 insert into public.actor (id, slug, kind, display_name) values
  ('${user}', 'partner_one', 'human', 'Example User'),
  ('${helper}', 'partner_two', 'human', 'Example Partner'),
  ('${sweep}', 'mail-example', 'automation', 'Example Mail Capture');
 insert into party (id, kind, name)
  values ('${user}', 'person', 'Example User'), ('${helper}', 'person', 'Example Partner');
 insert into app_user (id, slug) values ('${user}', 'partner_one'), ('${helper}', 'partner_two');
 insert into outside_id (source, value, party_id) values ('old_system', '${user}', '${user}');
 insert into how_found (slug, label) values ('inbound', 'Inbound');
 insert into role (slug, label) values ('lead', 'Lead');
 insert into stage (role, slug, label) values ('lead', 'new', 'New');
 insert into party_email (party_id, address, label)
  values ('${helper}', 'sender-65@example.test', 'work');
 ${pending(61, "partner_one", " Applies to open deal Example deal.", reading)}
 ${pending(62, "partner_two", "")}
 ${pending(63, "partner_one", " Possible new lead or matter.", { applies_to: "new_matter" })}
 ${pending(64, "unknown-mailbox", "")}
 ${pending(65, "partner_one", "", undefined, {
		email: "Sender-65@EXAMPLE.TEST",
		confirmed_at: "2025-01-03",
		confirmed_by: user,
 })}
 ${pending(66, "partner_one", "", undefined, { email: "invalid" })}
 commit;`);
	const refusals = await run(door.db);
	assert.deepEqual(
		refusals.map(({ old_id, reason }) => [old_id, reason]),
		[
			[id(64), "mailbox_not_copied"],
			[id(65), "known_party"],
			[id(66), "invalid_sender_address"],
		],
	);
	const suggestions = () =>
		door.db.query<{
			id: string;
			candidate_id: string;
			status: string;
			evidence: string;
			reading: unknown;
		}>(`select p.id, p.candidate_id, p.status, p.evidence, c.source_row -> 'reading' as reading
			from proposal p join candidate c on c.id = p.candidate_id
			where p.kind = 'email_lead' order by p.candidate_id`);
	const { rows: pendingSuggestions } = await suggestions();
	assert.deepEqual(
		pendingSuggestions.map(({ candidate_id, status, evidence, reading }) => [
			candidate_id,
			status,
			evidence,
			reading,
		]),
		[
			[id(61), "pending", "Example summary 61", reading],
			[id(62), "pending", "Example summary 62", null],
			[id(63), "pending", "Example summary 63", { applies_to: "new_matter" }],
		],
	);
	const [accept, dismiss, untouched] = pendingSuggestions;
	assert.ok(accept && dismiss && untouched);
	assert.deepEqual(
		(
			await door.db.query(
				"select changed_by_user_id from candidate where id = $1",
				[id(65)],
			)
		).rows,
		[{ changed_by_user_id: user }],
	);
	const decide = (user: string, proposal: string, decision: object) =>
		door.save({ user }, `proposals/${proposal}/decision`, {
			idempotency_key: randomUUID(),
			...decision,
		});
	assert.equal(
		(await decide("partner_two", accept.id, { decision: "accept" }))[0],
		404,
	);
	assert.equal(
		(await decide("partner_one", accept.id, { decision: "accept" }))[0],
		200,
	);
	const reason = "This sender is already working with another broker";
	assert.equal(
		(
			await decide("partner_two", dismiss.id, { decision: "dismiss", reason })
		)[0],
		200,
	);
	assert.deepEqual(
		(
			await door.db.query(`select e.address, p.how_found, l.stage, l.owner_user_id
			from party_email e join party p on p.id = e.party_id
			join party_role l on l.party_id = p.id and l.role = 'lead'`)
		).rows,
		[
			{
				address: "sender-61@example.test",
				how_found: "inbound",
				stage: "new",
				owner_user_id: user,
			},
		],
	);
	assert.deepEqual(
		(
			await door.db.query(
				"select id, status, reason from candidate order by id",
			)
		).rows,
		[
			{ id: id(61), status: "promoted", reason: null },
			{ id: id(62), status: "declined", reason },
			...[63, 64, 65, 66].map((n) => ({
				id: id(n),
				status: "unreviewed",
				reason: null,
			})),
		],
	);
	assert.deepEqual(await run(door.db), refusals);
	assert.deepEqual((await suggestions()).rows, [
		{ ...accept, status: "accepted" },
		{ ...dismiss, status: "dismissed" },
		untouched,
	]);
});
