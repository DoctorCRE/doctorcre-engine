import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sql } from "kysely";
import { registerDocTools } from "../doc-tools.ts";
import { nextPartnerRead, nextTransaction } from "../next-connection.ts";
import { doorTest } from "../test-door.ts";

const door = doorTest();
const joe = randomUUID();
const dell = randomUUID();
const deal = randomUUID();
const party = randomUUID();
const clientParty = randomUUID();
const shared = randomUUID();
const privateCall = randomUUID();
const deletedCall = randomUUID();
const privateStepText = "Review the private plan";
const assignedText = "Send the brochure";
const completedText = "Reviewed private notes";
const sharedText = "Example shared call";
const privateText = "Example private call";

before(async () => {
	await door.setup();
	await door.db.query(`
		set local engine.job = 'old_system';
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example One'), ('${dell}', 'person', 'Example Two'),
			('${party}', 'company', 'Example Practice'),
			('${clientParty}', 'company', 'Example Client');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into role (slug, label) values ('lead', 'Lead'), ('vendor', 'Vendor'), ('client', 'Client');
		insert into stage (role, slug, label) values ('lead', 'qualified', 'Qualified');
		insert into how_found (slug, label) values ('referral', 'Referral');
		update party set how_found = 'referral' where id in ('${party}', '${clientParty}');
		insert into party_role (party_id, role, stage, owner_user_id) values
			('${party}', 'lead', 'qualified', '${joe}'), ('${party}', 'vendor', null, '${joe}'),
			('${clientParty}', 'client', null, null);
		insert into client (party_id) values ('${clientParty}');
		insert into phase (slug, label) values ('negotiation', 'Negotiation');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Lease', '${joe}');
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${clientParty}', 'client');
		insert into deal_phase_change (deal_id, happened_at, phase)
			values ('${deal}', '2025-01-01', 'negotiation');
		insert into activity (id, kind, happened_at, summary) values
			('${shared}', 'call', '2025-01-02', '${sharedText}');
		set local engine.job = 'agent';
		set local engine.user_id = '${joe}';
		insert into activity (id, kind, happened_at, summary) values
			('${privateCall}', 'call', '2025-01-03', '${privateText}'),
			('${deletedCall}', 'call', '2025-01-04', 'Example deleted call');
		delete from activity where id = '${deletedCall}';
		insert into activity_about (activity_id, deal_id)
			values ('${shared}', '${deal}'), ('${privateCall}', '${deal}');
		insert into activity_about (activity_id, party_id)
			values ('${shared}', '${party}'), ('${privateCall}', '${party}');
		insert into next_step (deal_id, owner_party_id, what, due_on, call_activity_id, call_evidence_quote) values
			('${deal}', '${joe}', '${privateStepText}', '2025-01-04', '${privateCall}', '${privateText}'),
			('${deal}', '${dell}', '${assignedText}', '2025-01-04', '${privateCall}', '${privateText}');
		insert into next_step (deal_id, owner_party_id, what, resolution, done_at, call_activity_id, call_evidence_quote)
			values ('${deal}', '${joe}', '${completedText}', 'done', '2025-01-05', '${privateCall}', '${privateText}');
		set local engine.job = 'old_system';
		set local engine.user_id = '';
		insert into imported_change (id, table_name, record, field, source_event, old_value_absent, new_value_absent)
		select id, 'activity', jsonb_build_object('id', activity_id), 'summary', jsonb_build_object(
			'id', id, 'verb', 'add-deal-note', 'cause', 'human_stated', 'actor_id', '${joe}',
			'subject_id', '${deal}', 'new_value', jsonb_build_object('note', summary)), true, false
		from (select gen_random_uuid() as id, a.id as activity_id, summary from activity a) entries;
	`);
});
after(() => door.cleanup());

type Partner = "joe" | "dell";
const partners = ["joe", "dell"] as const;
// Both partners see every call, including one the other partner recorded.
const expected = (_user: Partner) => [privateText, sharedText];

async function read<T>(user: Partner, path: string) {
	const response = await door.request(
		{ user },
		path,
		{ method: "GET" },
		{
			DEALS_READ_SCHEMA: "next",
			LEADS_READ_SCHEMA: "next",
			DIRECTORY_READ_SCHEMA: "next",
			ACTIVITY_READ_SCHEMA: "next",
		},
	);
	assert.equal(response.status, 200);
	return response.json<T>();
}

type Summary = { summary: string };
const summaries = (entries: Summary[]) => entries.map(({ summary }) => summary);

function assertSteps(result: unknown, _user: Partner) {
	const text = JSON.stringify(result);
	assert.ok(text.includes(assignedText));
	assert.ok(text.includes(privateStepText));
}

test("each partner's deal timeline shows every call, its history and steps", async () => {
	for (const user of partners) {
		const { activities, events, next_actions } = await read<{
			activities: Summary[];
			events: { activity_id: string }[];
			next_actions: { description: string }[];
		}>(user, `deals/${deal}`);
		assert.deepEqual(summaries(activities), expected(user));
		assert.ok(events.some(({ activity_id }) => activity_id === privateCall));
		assert.ok(events.some(({ activity_id }) => activity_id === shared));
		assertSteps(next_actions, user);
	}
});

test("the Deals board picks the newest call or completed step", async () => {
	for (const user of partners) {
		const { deals } = await read<{
			deals: {
				id: string;
				last_step: Summary;
				next_step: string;
				open_actions: unknown;
			}[];
		}>(user, "deals");
		const row = deals.find(({ id }) => id === deal);
		assert.ok(row);
		assert.equal(row.last_step.summary, completedText);
		assertSteps(row.open_actions, user);
	}
});

test("lead correspondence includes every call", async () => {
	for (const user of partners) {
		const { detail } = await read<{ detail: { correspondence: Summary[] } }>(
			user,
			`leads?lead_id=${party}`,
		);
		assert.deepEqual(summaries(detail.correspondence), expected(user));
	}
});

test("vendor last contact and recent entries include every call", async () => {
	for (const user of partners) {
		const {
			record: { relationship },
		} = await read<{
			record: {
				relationship: {
					last_contact_note: string;
					recent_entries: Summary[];
				};
			};
		}>(user, `vendors/${party}?contract=vendor-directory.v2`);
		assert.equal(relationship.last_contact_note, expected(user)[0]);
		assert.deepEqual(summaries(relationship.recent_entries), expected(user));
	}
});

test("Doc's record tool reads calls for the partner whose turn it is", async () => {
	for (const user of partners) {
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		const client = new Client({ name: "test", version: "1" });
		const server = new McpServer({ name: "Doc", version: "1" });
		const source = `deal:${deal}`;
		registerDocTools(server, {
			readConnection: door.readerUrl,
			partner: user,
			partnerId: user === "joe" ? joe : dell,
			draft: undefined,
			state: { reads: 0, sources: {} },
			timeout: 5000,
		});
		try {
			await server.connect(serverTransport);
			await client.connect(clientTransport);
			await client.callTool({
				name: "find",
				arguments: { query: deal, kind: "deal" },
			});
			const answer = await client.callTool({
				name: "read",
				arguments: { source },
			});
			assert.ok(Array.isArray(answer.content));
			const [content] = answer.content;
			assert.equal(content?.type, "text");
			const result = JSON.parse(content.text);
			assert.deepEqual(summaries(result.activity), expected(user));
			assertSteps(result.next_steps, user);
		} finally {
			await client.close();
			await server.close();
		}
	}
});

test("Recent Activity includes the call the other partner recorded", async () => {
	for (const user of partners) {
		const { catch_up } = await read<{
			catch_up: { timeline: (Summary & { verb: string })[] };
		}>(user, `recent-activity?query=${deal}`);
		assert.deepEqual(
			summaries(catch_up.timeline.filter(({ verb }) => verb === "call")),
			expected(user),
		);
		assertSteps(catch_up.timeline, user);
	}
});

test("Calendar shows every call follow-up to both partners", async () => {
	for (const user of partners) {
		const body = await read(user, "calendar/critical-dates");
		assertSteps(body, user);
		assert.ok(!JSON.stringify(body).includes(privateText));
	}
});

test("Updates history shows call step wording to both partners", async () => {
	for (const user of partners) {
		assertSteps(await read(user, "updates/changes"), user);
	}
});

test("direct reads without a viewer show every call and its audit text", async () => {
	await nextTransaction(door.readerUrl, "read", async (tx) => {
		const calls = await tx
			.selectFrom("activity")
			.select("summary")
			.where("kind", "=", "call")
			.orderBy("summary")
			.execute();
		assert.deepEqual(
			calls.map(({ summary }) => summary),
			[privateText, sharedText],
		);
		const changes = await tx
			.selectFrom("change")
			.select(["old_value", "new_value"])
			.where("table_name", "=", "activity")
			.execute();
		assert.match(JSON.stringify(changes), /Example private call/);
		const imported = await tx
			.selectFrom("imported_change")
			.select("source_event")
			.execute();
		assert.match(JSON.stringify(imported), /Example shared call/);
		assert.match(JSON.stringify(imported), /Example private call/);
	});
});

test("either partner, and only a partner, can correct a call's caller", async () => {
	const outsider = randomUUID();
	await door.db.query(`
		set local engine.job = 'old_system';
		insert into party (id, kind, name) values ('${outsider}', 'person', 'Example Outsider');
		insert into app_user (id, slug) values ('${outsider}', 'example-outsider');
	`);
	const correct = (viewer: string, call = privateCall) =>
		nextTransaction(door.writerUrl, "save", async (tx) => {
			await sql`select set_config('engine.user_id', ${viewer}, true)`.execute(
				tx,
			);
			await tx
				.updateTable("activity")
				.set({ from_party_id: party })
				.where("id", "=", call)
				.execute();
		});
	await assert.rejects(correct(outsider), { code: "42501" });
	await correct(dell);
	await correct(joe);
	const canRead = (viewer: Partner, call = privateCall) =>
		nextPartnerRead(door.readerUrl, viewer, (tx) =>
			tx
				.selectFrom("activity")
				.select("summary")
				.where("id", "=", call)
				.executeTakeFirst(),
		);
	for (const user of partners)
		assert.deepEqual(await canRead(user), { summary: privateText });
	await correct(dell, shared);
	assert.deepEqual(await canRead("dell", shared), { summary: sharedText });
});

test("both partners see a call's phase reason and the moved or lost phase", async () => {
	const moved = randomUUID();
	await door.db.query(`
		set local engine.user_id = '${joe}';
		insert into job values ('call_capture', 'Call capture') on conflict do nothing;
		insert into phase (slug, label) values ('touring', 'Touring'), ('dead', 'Lost') on conflict do nothing;
		insert into deal (id, name, owner_user_id) values ('${moved}', 'Example Phase Deal', '${joe}');
		insert into deal_party (deal_id, party_id, role) values ('${moved}', '${clientParty}', 'client');
		insert into activity_about (activity_id, deal_id) values ('${privateCall}', '${moved}');
		insert into deal_phase_change (deal_id, happened_at, phase) values ('${moved}', '2025-01-01', 'negotiation');
	`);
	const move = (phase: "touring" | "dead", when: string) =>
		door.db.query(`
		set local engine.job = 'call_capture';
		set local engine.user_id = '${joe}';
		insert into deal_phase_change (deal_id, happened_at, phase, reason, call_activity_id, call_move_id)
			values ('${moved}', '${when}', '${phase}', 'Example private phase reason', '${privateCall}', gen_random_uuid());
	`);
	const details = (user: Partner) => read(user, `deals/${moved}`);
	await move("touring", "2025-01-07");
	for (const user of partners)
		assert.partialDeepStrictEqual(await details(user), {
			phase: "touring",
			phase_change: { reason: "Example private phase reason" },
		});
	await move("dead", "2025-01-08");
	await nextPartnerRead(door.readerUrl, "dell", async (tx) => {
		const history = await tx
			.selectFrom("change")
			.select("new_value")
			.where("table_name", "=", "deal_phase_change")
			.execute();
		assert.match(JSON.stringify(history), /Example private phase reason/);
	});
	await assert.rejects(
		nextPartnerRead(door.readerUrl, "dell", (tx) =>
			sql`select reason from next.deal_phase_change where deal_id = ${moved}`.execute(
				tx,
			),
		),
		{ code: "42501" },
	);
	for (const user of partners)
		assert.partialDeepStrictEqual(await details(user), {
			phase: "dead",
			lost_reason: "Example private phase reason",
		});
});

test("watch and reminder readers show checklist wording from a call to both partners", async () => {
	const gone = randomUUID();
	const watched = randomUUID();
	await door.db.query(`
		set local engine.user_id = '${joe}';
		insert into job values ('cadence', 'Cadence') on conflict do nothing;
		insert into deal (id, name, owner_user_id) values ('${watched}', 'Example Watch Deal', '${dell}');
		insert into activity_about (activity_id, deal_id) values ('${privateCall}', '${watched}');
		insert into next_step (id, deal_id, owner_party_id, what, due_on, item_title, source_ref, call_activity_id, call_evidence_quote) values
			(gen_random_uuid(), '${watched}', '${joe}', 'Example checklist', '2025-01-04', 'Private checklist', 'example:source', '${privateCall}', '${privateText}'),
			('${gone}', '${watched}', '${joe}', 'Example checklist', '2025-01-04', 'Deleted checklist', 'example:source', '${privateCall}', '${privateText}'),
			(gen_random_uuid(), '${watched}', '${dell}', 'Example checklist', '2025-01-04', 'Assigned checklist', 'example:source', '${privateCall}', '${privateText}');
		delete from next_step where id = '${gone}';
	`);
	const job = { job: "cadence" };
	for (const user of partners) {
		const [status, watch] = await door.save(
			job,
			`deal-watches/deal/${watched}?subscriber=${user}&since=2025-01-01T00:00:00Z`,
			{},
			"GET",
		);
		assert.equal(status, 200);
		const text = JSON.stringify(watch);
		assert.match(text, /Assigned checklist/);
		assert.match(text, /Private checklist/);
		assert.match(text, /Deleted checklist/);
	}
	const [status, reminders] = await door.save(
		job,
		`deals/${watched}/checklist-reminders`,
		{},
		"GET",
	);
	assert.equal(status, 200);
	assert.match(JSON.stringify(reminders), /Assigned checklist/);
	assert.match(JSON.stringify(reminders), /Private checklist/);
});

test("the other partner reads a call's step wording and its quote in audit", async () => {
	const rows = await nextPartnerRead(door.readerUrl, "dell", (tx) =>
		tx
			.selectFrom("change")
			.select("new_value")
			.where("table_name", "=", "next_step")
			.execute(),
	);
	const text = JSON.stringify(rows);
	for (const wording of [assignedText, privateStepText, privateText])
		assert.ok(text.includes(wording), wording);
	const { rows: stored } = await door.db.query(
		`select new_value ->> 'call_evidence_quote' as quote from change
		where table_name = 'next_step' and new_value ->> 'what' = $1`,
		[assignedText],
	);
	assert.deepEqual(stored, [{ quote: privateText }]);
});

test("the partner reader can narrow step history with the change index", async () => {
	const step = randomUUID();
	const { rows } = await nextPartnerRead(door.readerUrl, "dell", async (tx) => {
		await sql`set local enable_seqscan = off`.execute(tx);
		return sql<{ "QUERY PLAN": string }>`
			explain (costs off) select id from change
			where table_name = 'next_step' and record = jsonb_build_object('id', ${step}::uuid)
		`.execute(tx);
	});
	assert.match(
		rows.map((row) => row["QUERY PLAN"]).join("\n"),
		/Index Cond: .*table_name = 'next_step'/,
	);
});

test("the partner reader can narrow phase history to one deal by its key", async () => {
	const deal = randomUUID();
	const { rows } = await nextPartnerRead(door.readerUrl, "dell", async (tx) => {
		await sql`set local enable_seqscan = off`.execute(tx);
		return sql<{ "QUERY PLAN": string }>`
			explain (costs off) select phase from deal_phase_change where deal_id = ${deal}::uuid
		`.execute(tx);
	});
	assert.match(
		rows.map((row) => row["QUERY PLAN"]).join("\n"),
		/Index Cond: \(deal_id = /,
	);
});

test("the partner login has no direct read permission on call-bearing text", async () => {
	const { rows } = await door.db.query(
		`select census.tab, census.col from (values
			('activity', 'summary'), ('next_step', 'what'), ('next_step', 'item_title'),
			('next_step', 'item_bullets'), ('next_step', 'call_evidence_quote'), ('next_step', 'resolution_reason'),
			('deal_phase_change', 'reason'), ('imported_automatic_phase_move', 'reason'),
			('proposal', 'evidence'), ('proposal', 'reason'), ('proposal', 'what'), ('proposal', 'dismiss_reason'),
			('lead_stage_move', 'evidence_ref'), ('lead_stage_move', 'reason'),
			('change', 'old_value'), ('change', 'new_value'), ('imported_change', 'source_event'),
			('imported_deal_history', 'old_value'), ('imported_deal_history', 'new_value'),
			('imported_deal_history', 'human_quote'), ('imported_deal_history', 'agent_rationale'),
			('home_update', 'what'), ('doc_turn', 'answer'), ('doc_turn', 'claim_state')
		) census(tab, col)
		where has_column_privilege($1, 'next.' || census.tab, census.col, 'SELECT')`,
		[new URL(door.readerUrl).username],
	);
	assert.deepEqual(rows, []);
});

for (const kind of ["deal", "person", "company", "property"] as const) {
	test(`both partners read an accepted call step and its source on a ${kind}`, async () => {
		const target = randomUUID();
		const column =
			kind === "deal"
				? "deal_id"
				: kind === "property"
					? "property_id"
					: "party_id";
		const insert =
			kind === "deal"
				? `insert into deal (id, name, owner_user_id) values ('${target}', 'Example step deal', '${joe}')`
				: kind === "property"
					? `insert into property (id, address) values ('${target}', 'Example building')`
					: `insert into party (id, kind, name) values ('${target}', '${kind}', 'Example step party')`;
		await door.db.query(`
			set local engine.user_id = '${joe}';
			${insert};
			insert into activity_about (activity_id, ${column}) values ('${privateCall}', '${target}');
		`);
		const [status, proposal] = await door.save(
			{ job: "agent", for_user: "joe" },
			"proposals",
			{
				idempotency_key: randomUUID(),
				kind: "next_step",
				activity_id: privateCall,
				[column]: target,
				owner: "joe",
				what: "Example private instruction",
				evidence: privateText,
			},
		);
		assert.equal(status, 201, JSON.stringify(proposal));
		assert.equal(typeof proposal.proposal_id, "string");
		const id = String(proposal.proposal_id);
		const [accepted, decision] = await door.save(
			{ user: "joe" },
			`proposals/${id}/decision`,
			{
				idempotency_key: randomUUID(),
				decision: "accept",
			},
		);
		assert.equal(accepted, 200, JSON.stringify(decision));
		for (const user of partners) {
			await nextPartnerRead(door.readerUrl, user, async (tx) => {
				const step = await tx
					.selectFrom("next_step")
					.select("what")
					.where("id", "=", id)
					.executeTakeFirst();
				assert.deepEqual(step, { what: "Example private instruction" });
				const entries = await tx
					.selectFrom("change")
					.select("new_value")
					.where("table_name", "=", "next_step")
					.where(sql<boolean>`record = jsonb_build_object('id', ${id}::uuid)`)
					.execute();
				assert.match(JSON.stringify(entries), /Example private instruction/);
				const source = await tx
					.selectFrom("proposal")
					.select("activity_id")
					.where("id", "=", id)
					.executeTakeFirst();
				assert.deepEqual(source, { activity_id: privateCall });
			});
		}
	});
}

test("the other partner reads a call's step quote, resolution reason and proposal evidence", async () => {
	const [ended, proposal] = [randomUUID(), randomUUID()];
	const reason = "Example private resolution";
	const evidence = "Example private evidence";
	await door.db.query(`
		set local engine.job = 'agent';
		set local engine.user_id = '${joe}';
		insert into next_step (id, deal_id, owner_party_id, what, resolution, resolved_at, resolution_reason,
			call_activity_id, call_evidence_quote)
		values ('${ended}', '${deal}', '${joe}', 'Example ended step', 'cancelled', '2025-01-06', '${reason}',
			'${privateCall}', '${privateText}');
		insert into proposal (id, kind, activity_id, activity_kind, proposed_by_job, deal_id, owner_party_id, what, evidence)
		values ('${proposal}', 'next_step', '${privateCall}', 'call', 'agent', '${deal}', '${joe}',
			'Example proposed step', '${evidence}');
	`);
	await nextPartnerRead(door.readerUrl, "dell", async (tx) => {
		assert.deepEqual(
			await tx
				.selectFrom("next_step")
				.select(["call_evidence_quote", "resolution_reason"])
				.where("id", "=", ended)
				.executeTakeFirst(),
			{ call_evidence_quote: privateText, resolution_reason: reason },
		);
		assert.deepEqual(
			await tx
				.selectFrom("proposal")
				.select("evidence")
				.where("id", "=", proposal)
				.executeTakeFirst(),
			{ evidence },
		);
		const history = await tx
			.selectFrom("change")
			.select("new_value")
			.where("table_name", "=", "next_step")
			.where(sql<boolean>`record = jsonb_build_object('id', ${ended}::uuid)`)
			.execute();
		assert.match(JSON.stringify(history), new RegExp(reason));
	});
});

test("a registered job reads the latest private step’s ID and due date without a viewer", async () => {
	const [target, latest] = Array.from({ length: 2 }, () => randomUUID());
	await door.db.query(`
		set local engine.user_id = '${joe}';
		insert into deal (id, name, owner_user_id) values ('${target}', 'Example jobs deal', '${joe}');
		insert into activity_about (activity_id, deal_id) values ('${privateCall}', '${target}');
		insert into next_step (id, deal_id, owner_party_id, what, due_on, created_at, call_activity_id, call_evidence_quote) values
			(gen_random_uuid(), '${target}', '${dell}', 'Older wording', '2025-01-01', '2025-01-01', null, null),
			('${latest}', '${target}', '${joe}', 'Private wording', '2025-01-03', '2025-01-03', '${privateCall}', '${privateText}');
	`);
	const [status, result] = await door.save(
		{ job: "agent" },
		`deals/${target}`,
		{},
		"GET",
	);
	assert.equal(status, 200);
	assert.deepEqual(result.next_step, { id: latest, due_on: "2025-01-03" });
});
