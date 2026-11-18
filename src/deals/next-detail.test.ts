import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { nextTransaction } from "../next-connection.ts";
import { readSnapshot } from "../reader.ts";
import { copyTest, readSchema } from "../test-copy.ts";
import worker from "../worker.ts";
import { readDealDetail } from "./detail.ts";
import { readNextDealDetail } from "./next-detail.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const by = `'${id(1)}', '${id(1)}'`;

// A doctor's deal with a broker, a partner helping, an open and a newer done step, a call, a note and an email,
// and a clinic's deal whose client the copy holds back because its source is not mapped yet.
const OLD = `
create table public.email (id uuid primary key, mailbox_account text not null, message_id text);
alter table public.activity add column email_id uuid references public.email;
insert into public.email values ('${id(90)}', 'partner-one@example.test', '<tour@example.test>');
insert into public.actor (id, slug, kind, display_name) values
 ('${id(1)}', 'partner_one', 'human', 'Example Partner One'),
 ('${id(2)}', 'partner_two', 'human', 'Example Partner Two');
insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
insert into public.party (id, kind, name, created_by, updated_by) values
 ('${id(11)}', 'person', 'Dr. Jo Example', ${by}),
 ('${id(12)}', 'org', 'Example Unmapped Clinic', ${by}),
 ('${id(13)}', 'person', 'Example Listing Broker', ${by});
insert into public.client_status (slug, label) values ('engaged', 'Example engaged');
insert into public.client (id, party_id, status, acquisition_source, created_by, updated_by) values
 ('${id(20)}', '${id(11)}', 'engaged', 'Example referral', ${by}),
 ('${id(21)}', '${id(12)}', 'engaged', 'Example unmapped source', ${by});
insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1), ('startup', 'Example startup', 2);
insert into public.deal_phase (slug, label) values ('touring', 'Example touring'), ('negotiation', 'Example negotiation');
insert into public.participant_role (slug, label) values ('lead', 'Example lead'), ('support', 'Example support'),
 ('listing_side', 'Example listing side');
insert into public.deal (id, client_id, name, deal_type, phase, owner, attention, next_date, created_by, updated_by, created_at) values
 ('${id(30)}', '${id(20)}', 'Example startup office', 'startup', 'touring', 'partner_one', true, '2030-01-15', ${by}, '2025-01-01'),
 ('${id(31)}', '${id(21)}', 'Example clinic lease', 'lease', 'negotiation', 'partner_two', false, null, ${by}, '2025-01-02');
insert into public.deal_participant (deal_id, actor_id, party_id, role, from_at, set_by) values
 ('${id(30)}', '${id(1)}', null, 'lead', '2025-01-01', '${id(1)}'),
 ('${id(30)}', '${id(2)}', null, 'support', '2025-01-01', '${id(1)}'),
 ('${id(30)}', null, '${id(13)}', 'listing_side', '2025-01-01', '${id(1)}');
insert into public.event (id, subject_type, subject_id, field, old_value, new_value, occurred_at, actor_id, verb, cause) values
 ('${id(40)}', 'deal', '${id(30)}', 'phase', null, '{"phase":"touring"}', '2025-01-02', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(41)}', 'deal', '${id(31)}', 'phase', null, '{"phase":"negotiation"}', '2025-01-03', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(42)}', 'deal', '${id(30)}', 'attention', '{"attention":false}', '{"attention":true}', '2025-01-03', '${id(1)}', 'update-deal', 'human_stated');
insert into public.next_action (id, subject_type, subject_id, owner_id, description, due_on, status, created_at, created_by, updated_by) values
 ('${id(50)}', 'deal', '${id(30)}', '${id(1)}', 'Example send the survey', '2030-01-15', 'open', '2025-01-04', ${by}),
 ('${id(51)}', 'deal', '${id(30)}', '${id(2)}', 'Example book the tour', '2025-01-20', 'done', '2025-01-05', ${by});
insert into public.activity_kind (slug, label, is_contact) select s, s, true from unnest(array['call', 'email_in']) s;
insert into public.activity (id, kind, occurred_at, actor_id, summary, deal_id, email_context, email_id) values
 ('${id(60)}', 'call', '2025-02-01T15:00:00Z', '${id(1)}', 'Example call about tours', '${id(30)}', null, null),
 ('${id(61)}', 'email_in', '2025-02-02T16:00:00Z', '${id(1)}', 'Email from Dr. Jo Example: Example tour times', '${id(30)}',
  '{"sender": {"email": "doctor@example.test"}, "subject": "Example tour times", "conversation_id": "example-thread"}', '${id(90)}');
insert into public.deal_note (id, deal_id, kind, text, actor_id, created_at) values
 ('${id(70)}', '${id(30)}', 'note', 'Example note about parking', '${id(2)}', '2025-02-03T17:00:00Z');
`;

const COPIES: [file: string, input?: string][] = [
	["copy-parties.sql"],
	[
		"copy-leads-clients.sql",
		`create temp table copy_how_found (old_type text, source text, how_found text, primary key (old_type, source)) on commit drop;
 insert into copy_how_found values ('client', 'Example referral', 'referral');`,
	],
	["copy-deals.sql"],
	["copy-activity.sql"],
	["copy-emails.sql"],
	["copy-deal-next-steps.sql"],
	["copy-change-history.sql"],
];

const { db, setup, cleanup, connectionString } = copyTest();

before(async () => {
	await setup();
	await db.query(`begin; ${OLD} commit;`);
	for (const [file, input = ""] of COPIES) {
		await db.query(
			`begin; select set_config('engine.job', 'old_system', true); ${input}`,
		);
		await db.query(await readSchema(file));
		await db.query("commit");
	}
	await db.query(`begin;
		select set_config('engine.user_id', '${id(1)}', true);
		insert into next_step (id, deal_id, what, item_title, source_ref)
		values ('${id(80)}', '${id(30)}', 'Example call about the sign', 'Confirm signage', 'example-call');
		insert into critical_date (id, deal_id, kind, due_on, source)
		values ('${id(81)}', '${id(30)}', 'loi_expiry', '2030-02-01', 'Example offer');
		commit;`);
});
after(cleanup);

const byId = <T extends { id: string | null }>(rows: T[]) =>
	rows.toSorted((a, b) => String(a.id).localeCompare(String(b.id)));
const ROLES: Record<string, string> = { listing_side: "listing_agent" };

// What a partner reads on the page: the header, next steps, parties, the timeline and the emails.
async function oldPage(deal: string) {
	const page = await readSnapshot(connectionString, (tx) =>
		readDealDetail(tx, deal),
	);
	assert.ok(!("error" in page) && "next_step" in page, "an open deal");
	return {
		header: [page.name, page.type, page.phase, page.owner, page.attention],
		client: page.client_name,
		next_step: [page.next_step, page.next_date],
		steps: page.next_actions.map((s) => [
			s.description,
			s.owner,
			s.due_on,
			s.status,
		]),
		// Today's page lists the deal owner among its parties; the new page shows the owner once, in the header.
		parties: page.participants
			.filter((p) => p.role !== "lead")
			.map((p) => [ROLES[String(p.role)] ?? p.role, p.name]),
		timeline: byId([
			...page.activities.map((a) => ({ ...a, text: a.summary })),
			...page.thread.map((n) => ({ ...n, occurred_at: n.created_at })),
		]).map((a) => [a.id, a.occurred_at, a.actor, a.text]),
		emails: page.email_threads.map((e) => [e.subject, e.latest_message_at]),
	};
}

async function newPage(deal: string) {
	const page = await nextTransaction(connectionString, "read", (tx) =>
		readNextDealDetail(tx, deal),
	);
	assert.ok(!("error" in page));
	return {
		header: [page.name, page.type, page.phase, page.owner, page.attention],
		client: page.client_name,
		next_step: [page.next_step, page.next_date],
		steps: page.next_actions
			.filter((s) => s.title === null)
			.map((s) => [s.description, s.owner, s.due_on, s.status]),
		parties: page.participants.map((p) => [p.role, p.name]),
		timeline: byId(page.activities).map((a) => [
			a.id,
			a.occurred_at,
			a.actor,
			a.summary,
		]),
		emails: page.email_threads.map((e) => [e.subject, e.latest_message_at]),
	};
}

test("the new section answers a deal page as today's tables do", async () => {
	assert.deepEqual(await newPage(id(30)), await oldPage(id(30)));
});

test("the page shows the steps, parties, timeline and email the copy brought", async () => {
	const page = await newPage(id(30));
	assert.deepEqual(page.client, "Dr. Jo Example");
	assert.deepEqual(page.next_step, ["Example send the survey", "2030-01-15"]);
	assert.deepEqual(page.parties, [
		["listing_agent", "Example Listing Broker"],
		["support", "Example Partner Two"],
	]);
	assert.deepEqual(
		page.timeline.map(([, , actor, text]) => [actor, text]),
		[
			["partner_one", "Example call about tours"],
			["partner_one", "Email from Dr. Jo Example: Example tour times"],
			["partner_two", "Example note about parking"],
		],
	);
	assert.deepEqual(page.emails, [
		["Example tour times", "2025-02-02T16:00:00+00:00"],
	]);
});

test("a deal whose client is not copied shows no client and the rest of its page", async () => {
	const { client, ...rest } = await oldPage(id(31));
	const page = await newPage(id(31));
	assert.equal(client, "Example Unmapped Clinic");
	assert.deepEqual(page, { ...rest, client: null });
});

test("an unknown deal is not found", async () => {
	const page = await nextTransaction(connectionString, "read", (tx) =>
		readNextDealDetail(tx, id(99)),
	);
	assert.deepEqual(page, { error: "not_found" });
});

const get = (path: string, schema?: string) =>
	worker.request(
		`https://app.example.test/api/engine${path}`,
		{ headers: { Cookie: "__Host-dealroom_session=example" } },
		{
			DEALS_READ_SCHEMA: schema,
			DATABASE: { connectionString },
			CARR: {
				fetch: async () =>
					Response.json({
						actor: { slug: "partner_one", display: "Example Partner" },
						csrf_token: "example",
					}),
			},
		},
	);

for (const schema of [undefined, "next"]) {
	test(`signed-in board uses ${schema ?? "the old schema"}`, async () => {
		const response = await get("/deals?workspace=all", schema);
		assert.equal(response.status, 200);
		const board = await response.json();
		assert.partialDeepStrictEqual(board, {
			schema_version: "local-deals-board.v2",
			actor: "partner_one",
			deals: [
				{
					id: id(30),
					next_step: "Example send the survey",
					next_date: "2030-01-15",
					items: schema ? [{ title: "Confirm signage", status: "open" }] : [],
				},
			],
			closed_deals: [],
			lost_deals: [],
			accounts: [],
		});
		assert.ok(
			board &&
				typeof board === "object" &&
				"deals" in board &&
				Array.isArray(board.deals),
		);
		assert.equal(board.deals.length, schema ? 1 : 2);
	});

	test(`signed-in detail uses ${schema ?? "the old schema"}`, async () => {
		const response = await get(`/deals/${id(30)}`, schema);
		assert.equal(response.status, 200);
		assert.partialDeepStrictEqual(await response.json(), {
			schema_version: "deal-timeline.v1",
			deal_id: id(30),
			next_step: "Example send the survey",
			email_threads: [{ conversation_id: "example-thread" }],
			events: [{ field: "attention" }],
			...(schema
				? {
						critical_dates: [{ due_on: "2030-02-01" }],
						activities: [{ summary: "Example note about parking" }],
					}
				: {
						critical_dates: [],
						thread: [{ text: "Example note about parking" }],
					}),
		});
		assert.equal((await get(`/deals/${id(99)}`, schema)).status, 404);
	});
}
