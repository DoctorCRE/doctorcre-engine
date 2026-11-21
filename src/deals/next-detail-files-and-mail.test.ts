import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql } from "kysely";
import { nextTransaction } from "../next-connection.ts";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";
import { nextDealDetailQuery } from "./next-detail.ts";

const { db, readerUrl, setup, cleanup, request, save } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dealId = id(10);
const otherDealId = id(11);
const documents = Array.from({ length: 21 }, (_, i) => id(100 + i));
const bindings = { DEALS_READ_SCHEMA: "next" };
const alex = { user: "alex" };
const casey = { user: "casey" };

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into how_found (slug, label) values ('inbound', 'Inbound');
		insert into party (id, kind, name) values ('${id(1)}', 'person', 'Alex Example'),
			('${id(2)}', 'person', 'Casey Example');
		insert into party (id, kind, name, how_found)
			values ('${id(3)}', 'company', 'Example Clinic', 'inbound');
		insert into app_user (id, slug) values ('${id(1)}', 'alex'), ('${id(2)}', 'casey');
		insert into role (slug, label) values ('client', 'Client');
		insert into party_role (party_id, role) values ('${id(3)}', 'client');
		insert into deal_kind (slug, label) values ('lease', 'Lease');
		insert into phase (slug, label) values ('research', 'Research');
		insert into deal (id, name, kind, owner_user_id) values
			('${dealId}', 'Example Clinic lease', 'lease', '${id(1)}'),
			('${otherDealId}', 'Example second lease', 'lease', '${id(2)}');
		insert into deal_party (deal_id, party_id, role) values ('${dealId}', '${id(3)}', 'client');
		insert into deal_phase_change (deal_id, happened_at, phase)
			values ('${dealId}', '2026-01-01', 'research'), ('${otherDealId}', '2026-01-01', 'research');

		insert into document_kind (slug, label) values ('other', 'Other');
		insert into document (id, deal_id, name, r2_bucket, r2_key, content_type, sha256, bytes, kind, created_at)
			select doc.id, '${dealId}', 'Example plan.pdf', 'deal_documents', 'example/' || doc.id,
				'application/pdf', repeat('a', 64), 12, 'other', '2026-01-01'::date + doc.n::int
			from unnest(array[${documents.slice(0, 20).map((value) => `'${value}'`)}]::uuid[]) with ordinality doc(id, n);
		insert into document (deal_id, name, r2_bucket, r2_key, content_type, sha256, bytes, kind)
			values ('${otherDealId}', 'Example different plan.pdf', 'deal_documents', 'example/other',
				'application/pdf', repeat('c', 64), 19, 'other');

		insert into activity (id, kind, happened_at, summary) values
			('${id(20)}', 'email', '2026-01-10T16:00:00Z', 'A request for the plan.'),
			('${id(21)}', 'email', '2026-01-11T16:00:00Z', 'The plan is attached.'),
			('${id(22)}', 'call', '2026-01-12T16:00:00Z', 'A call about the plan.'),
			('${id(23)}', 'meeting', '2026-01-13T16:00:00Z', E'Plan review\n\nDiscussed the layout.'),
			('${id(24)}', 'email', '2026-01-14T16:00:00Z', 'A reply about the layout.'),
			('${id(25)}', 'meeting', '2026-01-15T16:00:00Z', null);
		insert into email (activity_id, message_id, sender, sender_name, subject, body, conversation_id) values
			('${id(20)}', 'plan@example.test', 'pat@example.test', 'Pat Example',
				'Re: Example plan request', 'Could you send the plan?', 'example-plan-thread'),
			('${id(21)}', 'attached@example.test', 'sam@example.test', null,
				'Example attached plan', 'I attached the plan.', 'example-plan-thread'),
			('${id(24)}', 'layout@example.test', 'sam@example.test', null,
				'Example layout reply', 'The layout works.', 'example-plan-thread');
		insert into email_summary (activity_id, source_activity_id, source_hash, generator_version, status, text, provenance, recorded_at)
			values ('${id(20)}', '${id(20)}', 'sha256:' || repeat('a', 64), 'example.v1', 'available',
				'Pat asked for the floor plan.', '{"action_title":"HOLD: Send the floor plan to Pat"}', '2026-01-11'),
			('${id(24)}', '${id(24)}', 'sha256:' || repeat('b', 64), 'example.v1', 'available',
				'Pat confirmed the layout.', '{"action_title":"Record the layout approval"}', '2026-01-15');
		insert into email_mailbox (activity_id, user_id) values ('${id(20)}', '${id(1)}'), ('${id(21)}', '${id(2)}');
		insert into activity_about (activity_id, deal_id) values
			('${id(20)}', '${dealId}'), ('${id(22)}', '${dealId}'), ('${id(23)}', '${dealId}'),
			('${id(24)}', '${dealId}'), ('${id(25)}', '${otherDealId}');
		insert into activity_about (activity_id, party_id) values ('${id(20)}', '${id(3)}'), ('${id(21)}', '${id(3)}');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what, owner_party_id, due_on, created_at)
			values ('${id(30)}', 'next_step', '${id(20)}', 'email', 'Could you send the plan?', 'old_system',
				'${dealId}', 'Send the plan', '${id(1)}', '2026-02-01', '2026-01-10'),
				('${id(31)}', 'next_step', '${id(21)}', 'email', 'I attached the plan.', 'old_system',
				'${otherDealId}', 'Check the other plan', null, null, '2026-01-11'),
				('${id(32)}', 'next_step', '${id(22)}', 'call', 'Check the plan.', 'old_system',
				'${dealId}', 'Call about the plan', null, null, '2026-01-12'),
				('${id(33)}', 'next_step', '${id(20)}', 'email', 'Could you send the plan?', 'old_system',
				'${dealId}', 'Print the plan', null, null, '2026-01-10');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, created_at)
			values ('${id(34)}', 'file_to_deal', '${id(21)}', 'email', 'I attached the plan.', 'old_system',
				'${dealId}', '2026-01-11'),
				('${id(35)}', 'file_to_deal', '${id(20)}', 'email', 'Could you send the plan?', 'old_system',
				'${dealId}', '2026-01-10');
		select set_config('engine.job', '', true), set_config('engine.user_id', '${id(1)}', true);
		update proposal set status = 'dismissed' where id = '${id(33)}';
		insert into document (id, deal_id, name, r2_bucket, r2_key, content_type, sha256, bytes, kind, version, supersedes_id, created_at)
			values ('${documents[20]}', '${dealId}', 'Example plan.pdf', 'deal_documents', 'example/updated',
				'application/pdf', repeat('b', 64), 15, 'other', 2, '${documents[0]}', '2026-01-22');
		insert into critical_date (id, deal_id, kind, due_on, source, created_at)
			values ('${id(40)}', '${dealId}', 'loi_expiry', '2026-02-01', 'Example offer', '2026-01-01');
		insert into next_step (id, deal_id, what, owner_party_id)
			values ('${id(42)}', '${dealId}', 'Confirm the plan', '${id(2)}');
		select set_config('engine.job', 'old_system', true);
		insert into critical_date (id, deal_id, kind, due_on, source)
			values ('${id(41)}', '${dealId}', 'due_diligence', '2026-02-02', 'Example contract');
		insert into next_step (id, deal_id, what, owner_party_id)
			values ('${id(43)}', '${dealId}', 'Send the offer', '${id(1)}');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function detail(caller: typeof alex, deal = dealId) {
	const response = await request(
		caller,
		`deals/${deal}`,
		{ method: "GET" },
		bindings,
	);
	assert.equal(response.status, 200);
	const body: unknown = await response.json();
	assert.ok(body && typeof body === "object");
	return body;
}

test("both partners can list every deal file and open an earlier version", async () => {
	const bytes = "Example file";
	const bucket = {
		get: async (key: string) =>
			key === `example/${documents[0]}` ? new Response(bytes) : null,
	};
	for (const caller of [alex, casey]) {
		const page = await detail(caller);
		assert.ok("documents" in page && Array.isArray(page.documents));
		assert.deepEqual(
			page.documents.map((doc) => doc.id),
			documents.toReversed(),
		);
		assert.partialDeepStrictEqual(page.documents[0], {
			version: 2,
			bytes: 15,
			actor: "alex",
		});
		const first = page.documents.at(-1);
		assert.partialDeepStrictEqual(first, {
			name: "Example plan.pdf",
			version: 1,
			bytes: 12,
			content_type: "application/pdf",
			actor: "old_system",
		});
		const open = await request(
			caller,
			`documents/${first.id}`,
			{ method: "GET" },
			{
				DEAL_DOCUMENTS: bucket,
			},
		);
		assert.equal(open.status, 200);
		assert.equal(open.headers.get("Content-Type"), "application/pdf");
		assert.match(
			open.headers.get("Content-Disposition") ?? "",
			/Example%20plan\.pdf/,
		);
		assert.equal(await open.text(), bytes);
	}
});

test("both partners see who saved a critical date or next step", async () => {
	const { rows } = await db.query<{ saved_at: string }>(
		"select to_jsonb(changed_at) as saved_at from critical_date where id = $1",
		[id(40)],
	);
	assert.ok(rows[0]);
	for (const caller of [alex, casey]) {
		assert.partialDeepStrictEqual(await detail(caller), {
			critical_dates: [
				{ id: id(40), actor: "alex", updated_at: rows[0].saved_at },
				{ id: id(41), actor: "old_system" },
			],
			next_actions: [
				{ id: id(42), owner: "casey", actor: "alex" },
				{ id: id(43), owner: "alex", actor: "old_system" },
			],
		});
	}
});

async function homeReminders(caller: typeof alex) {
	const response = await request(
		caller,
		"home/inbox?view=dashboard",
		{ method: "GET" },
		{ HOME_INBOX_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const inbox: unknown = await response.json();
	assert.ok(isArguments(inbox) && isArguments(inbox.reminders));
	assert.ok(Array.isArray(inbox.reminders.items));
	return inbox.reminders.items.filter(isArguments);
}

test("deal follow-up uses the Home action title for the exact reply", async () => {
	const card = (await homeReminders(alex)).find(
		(item) => item.proposal_id === id(30),
	);
	assert.equal(card?.title, "Send the floor plan to Pat");
	const page = await detail(alex);
	assert.ok("email_follow_ups" in page && Array.isArray(page.email_follow_ups));
	assert.deepEqual(
		page.email_follow_ups.filter(isArguments).map(({ title }) => title),
		["Choose the deal for sam@example.test's email", card.title],
	);
});

test("deal follow-ups use the leading Home decision when the source email is unsummarized", async () => {
	const card = (await homeReminders(casey)).find(
		(item) =>
			isArguments(item.source_activity) && item.source_activity.id === id(21),
	);
	assert.equal(
		card?.title,
		"Review the proposed follow-up for Example second lease",
	);
	for (const target of [dealId, otherDealId]) {
		const page = await detail(casey, target);
		assert.ok(
			"email_follow_ups" in page && Array.isArray(page.email_follow_ups),
		);
		const followUp = page.email_follow_ups
			.filter(isArguments)
			.find(
				(item) => isArguments(item.email) && item.email.activity_id === id(21),
			);
		assert.equal(followUp?.title, card.title);
	}
});

test("both partners see individual correspondence and can decide email suggestions", async () => {
	const expected = [
		{
			activity_id: id(24),
			kind: "email",
			happened_at: "2026-01-14T16:00:00+00:00",
			sender: "sam@example.test",
			sender_name: null,
			subject: "Example layout reply",
		},
		{
			activity_id: id(23),
			kind: "meeting",
			happened_at: "2026-01-13T16:00:00+00:00",
			title: "Plan review",
		},
		{
			activity_id: id(20),
			kind: "email",
			happened_at: "2026-01-10T16:00:00+00:00",
			sender: "pat@example.test",
			sender_name: "Pat Example",
			subject: "Re: Example plan request",
		},
	];
	for (const caller of [alex, casey]) {
		const page = await detail(caller);
		assert.ok("correspondence" in page);
		assert.deepEqual(page.correspondence, expected);
		assert.ok(
			"email_follow_ups" in page && Array.isArray(page.email_follow_ups),
		);
		assert.equal(page.email_follow_ups.length, 2);
		assert.partialDeepStrictEqual(page, {
			email_follow_ups: [
				{
					proposal_id: id(34),
					kind: "file_to_deal",
					deal_id: dealId,
					evidence: "I attached the plan.",
					email: {
						activity_id: id(21),
						sender: "sam@example.test",
						sender_name: null,
						subject: "Example attached plan",
						summary: "The plan is attached.",
					},
				},
				{
					proposal_id: id(30),
					kind: "next_step",
					deal_id: dealId,
					what: "Send the plan",
					owner: "alex",
					due_on: "2026-02-01",
					email: {
						activity_id: id(20),
						sender: "pat@example.test",
						sender_name: "Pat Example",
						subject: "Re: Example plan request",
						happened_at: "2026-01-10T16:00:00+00:00",
					},
				},
			],
		});
	}
	assert.partialDeepStrictEqual(await detail(alex, otherDealId), {
		email_follow_ups: [{ proposal_id: id(31), owner: null }],
	});
	const other = await detail(alex, otherDealId);
	assert.ok("correspondence" in other);
	assert.deepEqual(other.correspondence, [
		{
			activity_id: id(25),
			kind: "meeting",
			happened_at: "2026-01-15T16:00:00+00:00",
			title: null,
		},
	]);
	const decide = (proposal: string, decision: "accept" | "dismiss") =>
		save(casey, `proposals/${proposal}/decision`, {
			decision,
			idempotency_key: randomUUID(),
		});
	assert.partialDeepStrictEqual(await decide(id(34), "accept"), [
		200,
		{
			proposal_id: id(34),
			status: "accepted",
			created: { activity_id: id(21) },
		},
	]);
	assert.partialDeepStrictEqual(await decide(id(30), "dismiss"), [
		200,
		{ proposal_id: id(30), status: "dismissed" },
	]);
	assert.deepEqual(
		(
			await db.query(
				"select deal_id from activity_about where activity_id = $1 and deal_id is not null",
				[id(21)],
			)
		).rows,
		[{ deal_id: dealId }],
	);
	const refreshed = await detail(alex);
	assert.ok("email_follow_ups" in refreshed);
	assert.deepEqual(refreshed.email_follow_ups, []);
	assert.ok(
		"correspondence" in refreshed && Array.isArray(refreshed.correspondence),
	);
	assert.deepEqual(
		refreshed.correspondence.map((entry) => entry.activity_id),
		[id(24), id(23), id(21), id(20)],
	);
});

test("an unsummarized filing uses the sender address in the Home and deal titles", async () => {
	const messages = `array['${id(60)}', '${id(61)}', '${id(62)}']::uuid[]`;
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into activity (id, kind, happened_at)
			select message, 'email', '2026-01-20'::date + day::int
			from unnest(${messages}) with ordinality m(message, day);
		insert into email (activity_id, message_id, sender, subject, body, conversation_id)
			select message, message || '@example.test', 'pat@example.test', 'Suite question',
				'About the suite.', 'example-suite-thread'
			from unnest(${messages}) message;
		insert into email_mailbox (activity_id, user_id)
			select message, '${id(1)}' from unnest(${messages}) message;
		insert into activity_about (activity_id, party_id)
			select message, '${id(3)}' from unnest(${messages}) message;
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, created_at)
			select gen_random_uuid(), 'file_to_deal', message, 'email', 'About the suite.', 'old_system',
				'${otherDealId}', '2026-01-20'::date + day::int
			from unnest(${messages}) with ordinality m(message, day);
		commit;`);
	const card = (await homeReminders(alex)).find(
		(item) =>
			isArguments(item.source_activity) && item.source_activity.id === id(62),
	);
	assert.equal(card?.title, "Choose the deal for pat@example.test's email");
	const page = await detail(alex, otherDealId);
	assert.ok("email_follow_ups" in page && Array.isArray(page.email_follow_ups));
	assert.deepEqual(
		page.email_follow_ups
			.filter((entry) => entry.kind === "file_to_deal")
			.map((entry) => [entry.email.activity_id, entry.title]),
		[[id(62), card.title]],
	);
});

test("deal detail looks up email summaries by source instead of scanning the mailbox", async () => {
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		with inserted as (
			insert into activity (id, kind, happened_at)
			select gen_random_uuid(), 'email', '2026-01-01' from generate_series(1, 15000)
			returning id
		)
		insert into email (activity_id, message_id, sender, subject, body)
			select id, id || '@summary-plan.example.test', 'sender@example.test', 'Example', 'An unrelated message.'
			from inserted;
		insert into activity_about (activity_id, party_id)
			select activity_id, '${id(3)}' from email where message_id = activity_id || '@summary-plan.example.test';
		insert into email_summary (activity_id, source_activity_id, source_hash, generator_version, status, text, provenance, recorded_at)
			select activity_id, activity_id, 'sha256:' || repeat('c', 64), 'example.v1',
				'available', 'An unrelated message.', '{}', '2026-01-02'
			from email where message_id = activity_id || '@summary-plan.example.test';
		insert into deal (id, name, kind, owner_user_id)
			values ('${id(800)}', 'Example summary lookup', 'lease', '${id(1)}');
		insert into deal_phase_change (deal_id, happened_at, phase)
			values ('${id(800)}', '2026-01-01', 'research');
		insert into proposal (kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what)
			select 'next_step', activity_id, 'email', 'An unrelated message.', 'old_system', '${id(800)}', 'Check the plan'
			from email_summary where source_hash = 'sha256:' || repeat('c', 64) order by activity_id limit 2;
		analyze email_summary;
		commit;`);
	const { rows } = await nextTransaction(readerUrl, "read", (tx) =>
		sql<{
			"QUERY PLAN": string;
		}>`explain (analyze, buffers, costs off, timing off)
			${nextDealDetailQuery(tx, id(800))}`.execute(tx),
	);
	const plan = rows
		.map((row) => row["QUERY PLAN"])
		.filter((line) => /email_summary|Index Cond:.*activity_id/.test(line))
		.join("\n");
	assert.doesNotMatch(plan, /Seq Scan on email_summary/);
	assert.match(
		plan,
		/Index (?:Only )?Scan using email_summary_email on email_summary \(actual rows=1(?:\.00)? loops=2\)/,
	);
});
