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
 ('${id(13)}', 'person', 'Example Listing Broker', ${by}),
 ('${id(14)}', 'org', 'Example Inactive Account', ${by}),
 ('${id(15)}', 'org', 'Example Engaged Account', ${by});
insert into public.client_status (slug, label) values ('engaged', 'Example engaged'), ('prospect', 'Example prospect');
insert into public.client_type (slug, label) values ('national_account', 'Example account');
insert into public.client (id, party_id, status, acquisition_source, created_by, updated_by) values
 ('${id(20)}', '${id(11)}', 'engaged', 'Example referral', ${by}),
 ('${id(21)}', '${id(12)}', 'engaged', 'Example unmapped source', ${by});
insert into public.client (id, party_id, status, acquisition_source, client_type, prospect_engagement_status, created_by, updated_by) values
 ('${id(22)}', '${id(14)}', 'prospect', 'Example referral', 'national_account', 'inactive', ${by}),
 ('${id(23)}', '${id(15)}', 'engaged', 'Example referral', 'national_account', 'active', ${by});
update public.client set roster_ref = 'C-EX-23' where id = '${id(23)}';
update public.party set ref = 'P-EX-15' where id = '${id(15)}';
insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1), ('startup', 'Example startup', 2), ('renewal', 'Example renewal', 3);
insert into public.deal_phase (slug, label) values ('touring', 'Example touring'), ('negotiation', 'Example negotiation');
insert into public.participant_role (slug, label) values ('lead', 'Example lead'), ('support', 'Example support'),
 ('listing_side', 'Example listing side');
insert into public.deal (id, client_id, name, deal_type, phase, owner, attention, next_date, created_by, updated_by, created_at) values
 ('${id(30)}', '${id(20)}', 'Example startup office', 'startup', 'touring', 'partner_one', true, '2030-01-15', ${by}, '2025-01-01'),
 ('${id(31)}', '${id(21)}', 'Example clinic lease', 'lease', 'negotiation', 'partner_two', false, null, ${by}, '2025-01-02'),
 ('${id(32)}', '${id(20)}', 'Z Example earlier lease', 'lease', 'negotiation', 'partner_one', true, '2029-12-01', ${by}, '2025-01-03'),
 ('${id(35)}', '${id(20)}', 'Example copied renewal', 'renewal', 'negotiation', 'partner_one', false, null, ${by}, '2025-01-04');
update public.deal set city = 'Example West' where id = '${id(32)}';
insert into public.deal_participant (deal_id, actor_id, party_id, role, from_at, set_by) values
 ('${id(30)}', '${id(1)}', null, 'lead', '2025-01-01', '${id(1)}'),
 ('${id(30)}', '${id(2)}', null, 'support', '2025-01-01', '${id(1)}'),
 ('${id(30)}', null, '${id(13)}', 'listing_side', '2025-01-01', '${id(1)}');
insert into public.event (id, subject_type, subject_id, field, old_value, new_value, occurred_at, actor_id, verb, cause) values
 ('${id(40)}', 'deal', '${id(30)}', 'phase', null, '{"phase":"touring"}', '2025-01-02', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(41)}', 'deal', '${id(31)}', 'phase', null, '{"phase":"negotiation"}', '2025-01-03', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(42)}', 'deal', '${id(30)}', 'attention', '{"attention":false}', '{"attention":true}', '2025-01-03', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(43)}', 'deal', '${id(35)}', 'phase', '{"phase":"touring"}', '{"phase":"negotiation"}', '2025-03-02T02:00Z', '${id(1)}', 'update-deal', 'automation_job');
insert into public.next_action (id, subject_type, subject_id, owner_id, description, due_on, status, created_at, created_by, updated_by) values
 ('${id(50)}', 'deal', '${id(30)}', '${id(1)}', 'Example send the survey', '2030-01-15', 'open', '2025-01-04', ${by}),
 ('${id(51)}', 'deal', '${id(30)}', '${id(2)}', 'Example book the tour', '2025-01-20', 'done', '2025-01-05', ${by}),
 ('${id(52)}', 'deal', '${id(32)}', '${id(1)}', 'Example prepare the lease', '2029-12-01', 'open', '2025-01-05', ${by});
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
	["copy-client-websites.sql"],
	["copy-activity.sql"],
	["copy-emails.sql"],
	["copy-deal-next-steps.sql"],
	["copy-change-history.sql"],
];

const { db, setup, cleanup, connectionString } = copyTest();

before(async () => {
	await setup();
	await db.query(`begin; ${OLD} commit;`);
	await db.query(`insert into ops.client_portal (slug, deal_id, client_id, password_hash, disabled_at)
		values ('example-startup', '${id(30)}', '${id(20)}', '$2a$12$${"A".repeat(53)}', null),
		       ('example-earlier-lease', '${id(32)}', '${id(20)}', '$2a$12$${"B".repeat(53)}', now())`);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into market (id, name) values ('${id(91)}', 'Example West'), ('${id(92)}', 'Example East');
		commit;`);
	for (const [file, input = ""] of COPIES) {
		await db.query(
			`begin; select set_config('engine.job', 'old_system', true); ${input}`,
		);
		await db.query(await readSchema(file));
		await db.query("commit");
	}
	await db.query(`begin;
		select set_config('engine.user_id', '${id(1)}', true);
		insert into deal_client_website (slug, deal_id, client_party_id, password_hash)
		values ('example-former-client', '${id(32)}', '${id(14)}', '$2a$12$${"C".repeat(53)}');
		insert into next_step (id, deal_id, what, item_title, source_ref, due_on)
		values ('${id(80)}', '${id(30)}', 'Example call about the sign', 'Confirm signage', 'example-call', '2030-01-16');
		insert into critical_date (id, deal_id, kind, due_on, source)
		values ('${id(81)}', '${id(30)}', 'loi_expiry', '2030-02-01', 'Example offer');
		insert into property (id, address) values ('${id(83)}', '100 Example Road');
		insert into deal_property (deal_id, property_id) values ('${id(30)}', '${id(83)}');
		insert into document (id, name, r2_key, r2_bucket, content_type) values
			('${id(84)}', 'Example lease.pdf', 'example-lease', 'deal_documents', 'application/pdf');
		insert into lease (id, deal_id, party_id, property_id)
		values ('${id(85)}', '${id(30)}', '${id(11)}', '${id(83)}');
		insert into lease_version (lease_id, version, document_id, executed_on, expiration_on)
		values ('${id(85)}', 1, '${id(84)}', '2025-01-01', '2030-01-01');
		insert into deal_reason (slug, label) values ('renewal', 'Renewal') on conflict do nothing;
		insert into deal (id, name, kind, reason, renews_lease_id, owner_user_id)
		values ('${id(33)}', 'Example renewal', 'lease', 'renewal', '${id(85)}', '${id(2)}'),
			('${id(34)}', 'Example unpaid deal', 'lease', null, null, '${id(2)}');
		insert into critical_date (id, deal_id, kind, due_on, source)
		values ('${id(82)}', '${id(33)}', 'option_notice', '2000-01-03', 'Example option'),
			('${id(86)}', '${id(33)}', 'due_diligence', '2999-01-01', 'Example contract');
		update critical_date set status = 'open' where id in ('${id(82)}', '${id(86)}');
		insert into commission_tier (user_id, from_deal, partner_user_id, closing_share)
		values ('${id(2)}', 1, '${id(1)}', 0.8);
		insert into commission (deal_id, expected, gross)
		values ('${id(31)}', null, 200), ('${id(33)}', 20, 100), ('${id(34)}', null, 200);
		insert into commission_payment (id, deal_id, amount, invoiced_on, received_on)
		values ('${id(87)}', '${id(31)}', 100, '2025-02-01', '2025-02-03'),
			('${id(88)}', '${id(31)}', 100, '2025-02-02', '2025-02-03'),
			('${id(89)}', '${id(33)}', 100, '2025-02-01', '2025-02-03'),
			('${id(93)}', '${id(34)}', 100, '2025-02-01', '2025-02-03'),
			('${id(94)}', '${id(34)}', 100, '2025-02-02', null);
		insert into next_step (deal_id, what, resolution, done_at)
		values ('${id(32)}', 'Example confirm terms', 'done', '2025-02-04T18:00:00Z');
		update deal set closed_value = 1250, parking_reason = 'other', parking_note = 'Example waiting for plans'
		where id = '${id(31)}';
		update deal set owner_user_id = '${id(2)}', market_id = '${id(92)}' where id = '${id(32)}';
		update deal set parking_reason = 'client_paused' where id = '${id(32)}';
		update deal set parking_reason = null where id = '${id(32)}';
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
		timeline: byId([
			...page.activities,
			...page.thread.map((n) => ({
				...n,
				occurred_at: n.created_at,
				summary: n.text,
			})),
		]).map((a) => [a.id, a.occurred_at, a.actor, a.summary]),
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

const get = (path: string, schema?: string, partner = "partner_one") =>
	worker.request(
		`https://app.example.test/api/engine${path}`,
		{ headers: { Cookie: "__Host-dealroom_session=example" } },
		{
			DEALS_READ_SCHEMA: schema,
			DATABASE: { connectionString },
			CARR: {
				fetch: async () =>
					Response.json({
						actor: { slug: partner, display: "Example Partner" },
						csrf_token: "example",
					}),
			},
		},
	);

test("the board and detail carry the same imported automatic phase move", async () => {
	const board = await get("/deals?workspace=all", "next");
	const detail = await get(`/deals/${id(35)}`, "next");
	assert.equal(board.status, 200);
	assert.equal(detail.status, 200);
	const page = await detail.json();
	const boardData = await board.json();
	assert.ok(
		page &&
			typeof page === "object" &&
			"phase_change" in page &&
			"seen" in page,
	);
	assert.partialDeepStrictEqual(page, {
		phase_change: {
			event_id: id(43),
			prior_phase: "touring",
			phase: "negotiation",
			automatic: true,
			source: "copied",
			evidence_date: "2025-03-01",
		},
	});
	assert.equal(typeof page.seen, "number");
	assert.partialDeepStrictEqual(boardData, {
		deals: [{ id: id(35), phase_change: page.phase_change, seen: page.seen }],
	});
	assert.partialDeepStrictEqual(boardData, {
		deals: [{ id: id(30), phase_change: null }],
	});
});

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
					open_actions: [
						{
							id: id(50),
							owner: "partner_one",
							due_on: "2030-01-15",
							item_id: `next_action:${id(50)}`,
							description: "Example send the survey",
						},
					],
					last_step: {
						summary: "Email from Dr. Jo Example: Example tour times",
						occurred_at: "2025-02-02T16:00:00+00:00",
					},
				},
			],
			closed_deals: [],
			lost_deals: [],
			accounts: [
				{
					account_name: "Example Engaged Account",
					account_client_ref: "C-EX-23",
				},
			],
		});
		assert.ok(
			board &&
				typeof board === "object" &&
				"deals" in board &&
				Array.isArray(board.deals) &&
				"accounts" in board &&
				Array.isArray(board.accounts),
		);
		assert.equal(board.accounts.length, 1);
		assert.equal(board.deals.length, schema ? 3 : 4);
		if (schema) {
			assert.deepEqual(
				board.deals.map((deal) => deal.id),
				[id(32), id(30), id(35)],
			);
			assert.deepEqual(board.deals[0].last_step, {
				kind: "completed_action",
				summary: "Example confirm terms",
				occurred_at: "2025-02-04T18:00:00+00:00",
			});
			assert.equal(board.deals[1].open_actions.length, 1);
		}
	});

	test(`signed-in detail uses ${schema ?? "the old schema"}`, async () => {
		const response = await get(`/deals/${id(30)}`, schema);
		assert.equal(response.status, 200);
		const detail = await response.json();
		assert.partialDeepStrictEqual(detail, {
			schema_version: "deal-timeline.v1",
			deal_id: id(30),
			next_step: "Example send the survey",
			email_threads: [{ conversation_id: "example-thread" }],
			events: [{ id: id(42), verb: "update-deal", field: "attention" }],
			thread: [
				{
					id: id(70),
					kind: "note",
					text: "Example note about parking",
					actor: "partner_two",
					created_at: "2025-02-03T17:00:00+00:00",
				},
			],
			...(schema
				? {
						critical_dates: [{ due_on: "2030-02-01" }],
						activities: [{ id: id(61) }, { id: id(60) }],
					}
				: {
						critical_dates: [],
					}),
		});
		assert.ok(
			detail &&
				typeof detail === "object" &&
				"activities" in detail &&
				Array.isArray(detail.activities),
		);
		assert.equal(detail.activities.length, 2);
		assert.equal((await get(`/deals/${id(99)}`, schema)).status, 404);
	});
}

test("both partners see a deal's active client website", async () => {
	for (const partner of ["partner_one", "partner_two"]) {
		const response = await get(`/deals/${id(30)}`, "next", partner);
		assert.equal(response.status, 200);
		const body = await response.text();
		assert.partialDeepStrictEqual(JSON.parse(body), {
			client_portal_url: "https://share.doctorcre.com/example-startup",
		});
		assert.doesNotMatch(body, /password_hash|\$2a\$12\$/);
	}
});

test("a missing, disabled or client-mismatched website stays off the deal page", async () => {
	for (const deal of [id(31), id(32)]) {
		const response = await get(`/deals/${deal}`, "next");
		assert.equal(response.status, 200);
		assert.partialDeepStrictEqual(await response.json(), {
			client_portal_url: null,
		});
	}
});

test("website copy reports each unavailable registration and skips it", async () => {
	await db.query("begin");
	try {
		await db.query(`select set_config('engine.job', 'old_system', true);
			delete from outside_id where source = 'old_system' and deal_id = '${id(31)}';
			update ops.client_portal set disabled_at = now() where deal_id = '${id(30)}';
			insert into ops.client_portal (slug, deal_id, client_id, password_hash, disabled_at, updated_at)
			select slug, deal_id::uuid, client_id::uuid, '$2a$12$${"A".repeat(53)}',
				case when disabled then now() end, case when has_update then now() end
			from (values
				('example-conflict', '${id(30)}', '${id(20)}', false, true),
				('example-no-time', '${id(30)}', '${id(20)}', true, false),
				('example-no-deal', '${id(31)}', '${id(21)}', false, true),
				('example-wrong-client', '${id(32)}', '${id(22)}', false, true)
			) example(slug, deal_id, client_id, disabled, has_update)`);
		const results = await db.query(
			await readSchema("copy-client-websites.sql"),
		);
		assert.ok(Array.isArray(results));
		assert.deepEqual(
			results.at(-1)?.rows,
			[
				[id(30), "registration_conflict"],
				[id(30), "registration_update_time_missing"],
				[id(31), "deal_not_copied"],
				[id(32), "client_link_not_copied"],
			].map(([old_id, reason]) => ({
				old_id,
				field: "client_website",
				value: null,
				reason,
			})),
		);
		assert.deepEqual(
			(await db.query(`select slug from deal_client_website order by slug`))
				.rows,
			["example-earlier-lease", "example-former-client", "example-startup"].map(
				(slug) => ({ slug }),
			),
		);
	} finally {
		await db.query("rollback");
	}
});

test("signed-in detail shows saved items and checklist progress from lease facts", async () => {
	const response = await get(`/deals/${id(30)}`, "next");
	assert.equal(response.status, 200);
	assert.partialDeepStrictEqual(await response.json(), {
		items: [{ id: id(80), title: "Confirm signage", due_on: "2030-01-16" }],
		checklist: {
			schema_version: "deal-checklist.v1",
			template_state: "current",
			deal_type: "lease",
			phases: [
				{
					id: "research",
					items: [{ id: "representation", status: "not_recorded" }],
				},
				{
					id: "legal",
					items: [
						{ id: "contract_draft" },
						{ id: "attorney_comments" },
						{ id: "legal_review" },
						{ id: "ti_scope" },
					],
				},
				{
					id: "closing",
					items: [
						{
							id: "executed_lease",
							status: "complete",
							evidence_ref: "Example lease.pdf",
						},
						{
							id: "expiration_recorded",
							status: "complete",
							evidence_ref: "Example lease.pdf",
						},
					],
				},
			],
			due_items: [],
		},
	});
});

test("a proposed critical date stays off the deal checklist", async () => {
	const page = await nextTransaction(connectionString, "read", (tx) =>
		readNextDealDetail(tx, id(30)),
	);
	assert.ok(!("error" in page));
	const legal = page.checklist.phases.find((phase) => phase.id === "legal");
	assert.ok(legal);
	assert.equal(
		legal.items.some((item) => item.id === `critical-date:${id(81)}`),
		false,
	);
});

test("the renewal checklist tracks confirmed deadlines and a saved receipt", async () => {
	const response = await get(`/deals/${id(33)}`, "next");
	assert.equal(response.status, 200);
	assert.partialDeepStrictEqual(await response.json(), {
		checklist: {
			deal_type: "renewal",
			phases: [
				{ id: "research", items: [{ id: "current_lease_abstraction" }] },
				{
					id: "legal",
					items: [{ id: `critical-date:${id(86)}`, status: "upcoming" }],
				},
				{
					id: "closing",
					items: [{ id: "executed_lease", status: "not_recorded" }],
				},
				{
					id: "invoice",
					items: [{ id: "commission_received", status: "complete" }],
				},
			],
			due_items: [
				{
					id: `critical-date:${id(82)}`,
					status: "overdue",
					due_on: "2000-01-03",
					owner: "partner_two",
					evidence_ref: "Example option",
				},
			],
		},
	});
});

test("a copied renewal without a source lease shows only the common checklist", async () => {
	const response = await get(`/deals/${id(35)}`, "next");
	assert.equal(response.status, 200);
	const detail = await response.json();
	assert.partialDeepStrictEqual(detail, {
		checklist: { template_state: "deal_type_unknown", deal_type: null },
	});
	assert.ok(detail && typeof detail === "object" && "checklist" in detail);
	const { checklist } = detail;
	assert.ok(
		checklist &&
			typeof checklist === "object" &&
			"phases" in checklist &&
			Array.isArray(checklist.phases),
	);
	const items = checklist.phases.flatMap((phase) => {
		const items: unknown = phase.items;
		assert.ok(Array.isArray(items));
		return items.map((item) => item.id);
	});
	assert.deepEqual(items.toSorted(), [
		"attorney_comments",
		"business_terms",
		"commission_received",
		"contract_draft",
		"executed_comp",
		"invoice_recorded",
		"loi_grid",
		"loi_submission",
		"market_survey",
		"representation",
		"requirements",
	]);
});

test("the checklist records an invoice and completes receipt only when all payments arrived", async () => {
	for (const [deal, status] of [
		[id(31), "complete"],
		[id(34), "not_recorded"],
	]) {
		const response = await get(`/deals/${deal}`, "next");
		assert.equal(response.status, 200);
		assert.partialDeepStrictEqual(await response.json(), {
			checklist: {
				phases: [
					{
						id: "invoice",
						items: [
							{
								id: "invoice_recorded",
								status: "complete",
								evidence_ref: "Invoiced Feb 1, 2025",
							},
							{
								id: "commission_received",
								status,
								evidence_ref:
									status === "complete"
										? "2 commission payments received"
										: null,
							},
						],
					},
				],
			},
		});
	}
});

test("signed-in detail names every field changed by one new-schema save", async () => {
	const response = await get(`/deals/${id(31)}`, "next");
	assert.equal(response.status, 200);
	const detail = await response.json();
	assert.ok(
		detail &&
			typeof detail === "object" &&
			"events" in detail &&
			Array.isArray(detail.events),
	);
	const { events } = detail;
	assert.equal(events.length, 2);
	assert.notEqual(events[0].id, events[1].id);
	assert.partialDeepStrictEqual(events, [
		{
			verb: "update-deal",
			field: "operating_state",
			old_value: "Active",
			new_value: "Parked · Other · Example waiting for plans",
		},
		{
			verb: "update-deal",
			field: "won_value",
			old_value: null,
			new_value: 1250,
		},
	]);
});

test("signed-in detail names both owners in a deal handoff", async () => {
	const response = await get(`/deals/${id(32)}`, "next");
	assert.equal(response.status, 200);
	assert.partialDeepStrictEqual(await response.json(), {
		events: [
			{ field: "owner", old_value: "partner_one", new_value: "partner_two" },
		],
	});
});

test("signed-in detail names both markets when a deal moves", async () => {
	const response = await get(`/deals/${id(32)}`, "next");
	assert.equal(response.status, 200);
	assert.partialDeepStrictEqual(await response.json(), {
		events: [
			{ field: "market", old_value: "Example West", new_value: "Example East" },
		],
	});
});

test("signed-in detail shows a revived deal as active", async () => {
	const response = await get(`/deals/${id(32)}`, "next");
	assert.equal(response.status, 200);
	assert.partialDeepStrictEqual(await response.json(), {
		events: [
			{
				field: "operating_state",
				old_value: "Parked · Client paused",
				new_value: "Active",
			},
		],
	});
});
