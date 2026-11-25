import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql } from "kysely";
import { nextTransaction } from "../next-connection.ts";
import { stampNextSave } from "../next-save.ts";
import { readSnapshot } from "../reader.ts";
import { copyTest, readSchema } from "../test-copy.ts";
import { readBoard, type Scope } from "./board.ts";
import { readNextBoard, readNextBoardDeals } from "./next-board.ts";
import { readNextDealDetail } from "./next-detail.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// A national clinic location, a doctor, a dental group and a location that left its brand, each with an open deal,
// one closed deal, two invoiced deals still in negotiation, one with no commission, a deal paid before its invoice,
// and an other-type deal with no phase events.
const OLD = `
insert into public.actor (id, slug, kind, display_name) values
 ('${id(1)}', 'partner_one', 'human', 'Example Partner One'),
 ('${id(2)}', 'dell', 'human', 'Example Partner Two'),
 ('${id(3)}', 'example_job', 'automation', 'Example job');
insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
insert into public.party (id, kind, name, created_by, updated_by) values
 ('${id(16)}', 'org', 'Example National Brand', '${id(1)}', '${id(1)}'),
 ('${id(11)}', 'person', 'Dr. Jo Example', '${id(1)}', '${id(1)}'),
 ('${id(12)}', 'org', 'Example Dental Group', '${id(1)}', '${id(1)}'),
 ('${id(13)}', 'org', 'Example Former Location', '${id(1)}', '${id(1)}');
insert into public.party (id, kind, name, org_id, created_by, updated_by) values
 ('${id(10)}', 'org', 'Example Clinic Location', '${id(16)}', '${id(1)}', '${id(1)}');
update public.party set org_id = '${id(16)}' where id = '${id(11)}';
insert into public.client_type (slug, label) values ('national_account', 'Example account');
insert into public.client_status (slug, label) values ('engaged', 'Example engaged');
insert into public.client (id, party_id, status, client_type, acquisition_source, created_by, updated_by) values
 ('${id(20)}', '${id(10)}', 'engaged', null, 'Example referral', '${id(1)}', '${id(1)}'),
 ('${id(21)}', '${id(11)}', 'engaged', null, 'Example referral', '${id(1)}', '${id(1)}'),
 ('${id(22)}', '${id(12)}', 'engaged', null, 'Example referral', '${id(1)}', '${id(1)}'),
 ('${id(23)}', '${id(16)}', 'engaged', 'national_account', 'Example referral', '${id(1)}', '${id(1)}'),
 ('${id(24)}', '${id(13)}', 'engaged', null, 'Example referral', '${id(1)}', '${id(1)}');
insert into public.national_account_owner (account_client_id, owner_actor_id, set_by) values ('${id(23)}', '${id(2)}', '${id(1)}');
insert into public.vendor_market (slug, name, kind, boundary, source, reviewed_by, reviewed_at) values
 ('example-bay', 'Example Bay', 'market', 'Example counties', 'Example review', '${id(1)}', '2025-01-01');
insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1), ('startup', 'Example startup', 2),
 ('relocation', 'Example relocation', 3), ('other', 'Example other', 4), ('renewal', 'Example renewal', 5);
insert into public.deal_phase (slug, label) values ('touring', 'Example touring'), ('negotiation', 'Example negotiation'),
 ('closed', 'Example closed'), ('invoiced', 'Example invoiced');
insert into public.deal_lane (slug, label, sort) values ('national', 'Example national', 1);
insert into public.deal (id, client_id, name, deal_type, phase, owner, city, attention, created_by, updated_by, created_at) values
 ('${id(34)}', '${id(24)}', 'Example former brand lease', 'lease', 'touring', 'partner_one', null, false, '${id(1)}', '${id(1)}', '2025-01-05'),
 ('${id(31)}', '${id(21)}', 'Example startup office', 'startup', 'touring', 'dell', 'Example Bay', true, '${id(1)}', '${id(1)}', '2025-01-02'),
 ('${id(33)}', '${id(22)}', 'Example closed lease', 'lease', 'closed', 'partner_one', 'Example Bay', false, '${id(1)}', '${id(1)}', '2024-06-01');
-- National with no city, so today's market is empty though the copy takes the assignment's.
insert into public.deal (id, client_id, name, deal_type, phase, owner, lane, created_by, updated_by, created_at) values
 ('${id(30)}', '${id(20)}', 'Example clinic lease', 'lease', 'negotiation', 'partner_one', 'national', '${id(1)}', '${id(1)}', '2025-01-01');
insert into public.deal_market_assignment (deal_id, agent_name, market, source, set_by) values
 ('${id(30)}', 'Example Agent', 'Example Bay', 'Example source', '${id(1)}');
insert into public.deal (id, client_id, name, deal_type, phase, owner, city, invoiced_on, created_by, updated_by, created_at) values
 ('${id(35)}', '${id(21)}', 'Example invoiced lease', 'lease', 'negotiation', 'partner_one', 'Example Bay', '2025-02-01',
 '${id(1)}', '${id(1)}', '2025-01-06');
insert into public.commission (id, deal_id, gross_amount, status, invoiced_on, created_by) values
 ('${id(50)}', '${id(35)}', 1000, 'invoiced', '2025-02-01', '${id(1)}');
insert into public.deal (id, client_id, name, deal_type, phase, owner, invoiced_on, created_by, updated_by, created_at) values
 ('${id(36)}', '${id(22)}', 'Example invoiced lease without commission', 'lease', 'negotiation', 'partner_one', '2025-02-02', '${id(1)}', '${id(1)}', '2025-01-07'),
 ('${id(37)}', '${id(21)}', 'Example other office', 'other', 'touring', 'partner_one', null, '${id(1)}', '${id(1)}', '2025-01-08'),
 ('${id(38)}', '${id(22)}', 'Example lease paid before invoice', 'lease', 'touring', 'partner_one', null, '${id(1)}', '${id(1)}', '2025-01-09');
insert into public.commission (id, deal_id, gross_amount, status, received_on, created_by) values
 ('${id(51)}', '${id(38)}', 1000, 'received', '2025-02-03', '${id(1)}');
insert into public.deal (id, client_id, name, deal_type, phase, owner, city, operating_state, parking_reason, parking_note, parked_at, parked_by,
 created_by, updated_by, created_at) values
 ('${id(32)}', '${id(22)}', 'Example dental move', 'relocation', 'negotiation', 'partner_one', 'Example Bay', 'parked', 'client_paused',
 'Example pause', '2025-03-04T05:06:07Z', '${id(2)}', '${id(1)}', '${id(1)}', '2025-01-03');
insert into public.event (id, subject_type, subject_id, field, old_value, new_value, occurred_at, actor_id, verb, cause) values
 ('${id(40)}', 'deal', '${id(30)}', 'phase', null, '{"phase":"negotiation"}', '2025-01-02', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(41)}', 'deal', '${id(31)}', 'phase', null, '{"phase":"touring"}', '2025-01-03', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(42)}', 'deal', '${id(32)}', 'phase', null, '{"phase":"negotiation"}', '2025-01-04', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(43)}', 'deal', '${id(33)}', 'phase', null, '{"phase":"negotiation"}', '2024-06-02', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(44)}', 'deal', '${id(33)}', 'phase', '{"phase":"negotiation"}', '{"phase":"closed"}', '2024-09-01', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(45)}', 'deal', '${id(34)}', 'phase', null, '{"phase":"touring"}', '2025-01-06', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(46)}', 'deal', '${id(35)}', 'phase', null, '{"phase":"negotiation"}', '2025-01-07', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(47)}', 'deal', '${id(36)}', 'phase', null, '{"phase":"negotiation"}', '2025-01-08', '${id(1)}', 'update-deal', 'human_stated');
update public.deal set closed_on = '2024-09-01' where id = '${id(33)}';
update public.deal set city = 'Unmapped Example City' where id = '${id(37)}';
insert into public.deal (id, client_id, name, deal_type, phase, outcome, owner, created_by, updated_by, created_at) values
 ('${id(39)}', '${id(22)}', 'Example undated won lease', 'renewal', 'closed', 'won', 'partner_one', '${id(1)}', '${id(1)}', '2024-06-03'),
 ('${id(40)}', '${id(22)}', 'Example undated lost lease', 'renewal', 'negotiation', 'lost', 'partner_one', '${id(1)}', '${id(1)}', '2024-06-04');
update public.deal set operating_state = 'parked', parking_reason = 'other', parking_note = 'Example old pause',
 parked_at = '2024-07-01T14:00:00Z', parked_by = '${id(3)}' where id = '${id(39)}';
insert into public.deal (id, client_id, name, deal_type, phase, owner, closed_on, created_by, updated_by) values
 ('${id(41)}', '${id(22)}', 'Example closed without a date', 'lease', 'closed', 'partner_one', null, '${id(1)}', '${id(1)}'),
 ('${id(42)}', '${id(22)}', 'Example invoiced without a date', 'lease', 'invoiced', 'partner_one', null, '${id(1)}', '${id(1)}'),
 ('${id(43)}', '${id(22)}', 'Example closing date only', 'lease', 'negotiation', 'partner_one', '2024-10-01', '${id(1)}', '${id(1)}');
`;

// The partners' reviewed first known dates and ladders, which the account, brand and commission copies need.
// The clinic joined its brand after its deal opened; today's board groups by membership as it stands now.
const COPIES: [file: string, input?: string][] = [
	["copy-parties.sql"],
	[
		"copy-markets.sql",
		`create temp table copy_market_county (market_slug text not null, county_fips text not null) on commit drop;
 insert into copy_market_county values ('example-bay', '01001');`,
	],
	[
		"copy-leads-clients.sql",
		`create temp table copy_how_found (old_type text, source text, how_found text, primary key (old_type, source)) on commit drop;
 insert into copy_how_found values ('client', 'Example referral', 'referral');`,
	],
	[
		"copy-national-account-owners.sql",
		`create temp table copy_account_owner_date (account_client_id uuid primary key, started_on date not null) on commit drop;
 insert into copy_account_owner_date values ('${id(23)}', '2024-03-01');`,
	],
	[
		"copy-client-brands.sql",
		`create temp table copy_client_brand_date (location_client_id uuid primary key, started_on date not null) on commit drop;
 insert into copy_client_brand_date values ('${id(20)}', '2025-06-01'), ('${id(21)}', '2024-03-01');`,
	],
	["copy-deals.sql"],
	[
		"copy-commissions.sql",
		`insert into commission_tier values ('${id(1)}', 1, '${id(2)}', 0.6);`,
	],
];

// History today's tables no longer hold: the former location's brand and the account's earlier owner.
const HISTORY = `
insert into client_brand (location_id, brand_id, started_on, ended_on) values ('${id(13)}', '${id(16)}', '2023-01-01', '2024-01-01');
insert into party (id, kind, name) values ('${id(450)}', 'person', 'Example Former Owner');
insert into app_user (id, slug) values ('${id(450)}', 'joe');
insert into national_account_owner (account_id, owner_id, started_on, ended_on) values ('${id(16)}', '${id(450)}', '2023-01-01', '2024-03-01');
`;

const COVERED = new Set([
	"id",
	"name",
	"type",
	"phase",
	"owner",
	"attention",
	"client_id",
	"client_name",
	"account_client_id",
	"account_name",
	"account_owner",
	"workspace_kind",
	"operating_state",
	"parking_reason",
	"parking_note",
	"invoiced_on",
	"closed_on",
	"outcome",
	"parked_at",
	"parked_by",
]);

const { db, setup, cleanup, connectionString } = copyTest();
// A client is its person or company in the new section, so its id is the party's.
let clientParty = new Map<string, string>();

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
	await db.query(
		`begin; select set_config('engine.job', 'old_system', true); ${HISTORY} commit;`,
	);
	const { rows } = await db.query<{ id: string; party_id: string }>(
		`select c.id, o.party_id from public.client c
		join outside_id o on o.source = 'old_system' and o.value = c.id::text`,
	);
	clientParty = new Map(rows.map((row) => [row.id, row.party_id]));
});
after(cleanup);

const oldAnswer = async ({ workspace, account }: Scope) => {
	const board = await readSnapshot(connectionString, (tx) =>
		readBoard(tx, {
			partner: "partner_one",
			workspace,
			account_client_id: account,
		}),
	);
	const deals = board.deals.map((deal) =>
		Object.fromEntries(Object.entries(deal).filter(([k]) => COVERED.has(k))),
	);
	return [...clientParty].reduce(
		(text, [client, party]) => text.replaceAll(client, party),
		JSON.stringify(deals),
	);
};

for (const scope of [
	{ workspace: "all", account: null },
	{ workspace: "team", account: null },
	{ workspace: "national_account", account: null },
	{ workspace: "all", account: id(23) },
] satisfies Scope[]) {
	test(`the new section answers the ${scope.workspace} board ${scope.account ? "for one account " : ""}as today's tables do`, async () => {
		const expected = await oldAnswer(scope);
		const actual = await nextTransaction(connectionString, "read", (tx) =>
			readNextBoardDeals(tx, {
				...scope,
				account: scope.account && (clientParty.get(scope.account) ?? null),
			}),
		);
		assert.deepEqual(
			actual.map((deal) =>
				Object.fromEntries(
					Object.entries(deal).filter(([k]) => COVERED.has(k)),
				),
			),
			JSON.parse(expected),
		);
	});
}

test("the comparison covers every open deal, owner, parking, national account, former brand and phase without events", async () => {
	const deals = await nextTransaction(connectionString, "read", (tx) =>
		readNextBoardDeals(tx, { workspace: "all", account: null }),
	);
	assert.deepEqual(
		deals.map((d) => [d.name, d.owner, d.parked_by, d.account_owner]),
		[
			["Example startup office", "dell", null, "dell"],
			["Example clinic lease", "partner_one", null, "dell"],
			["Example dental move", "partner_one", "dell", null],
			["Example former brand lease", "partner_one", null, null],
			["Example lease paid before invoice", "partner_one", null, null],
			["Example other office", "partner_one", null, "dell"],
		],
	);
});

test("each deal answers its latest change as the one a save says it saw", async () => {
	const deals = await nextTransaction(connectionString, "read", (tx) =>
		readNextBoardDeals(tx, { workspace: "all", account: null }),
	);
	const { rows } = await db.query<{ id: string; seen: string }>(
		`select record ->> 'id' as id, max(id) as seen from change where table_name = 'deal' group by 1`,
	);
	const latest = new Map(rows.map((row) => [row.id, Number(row.seen)]));
	assert.deepEqual(
		deals.map((deal) => deal.seen),
		deals.map((deal) => latest.get(String(deal.id))),
	);
	assert.ok(deals.every((deal) => deal.seen > 0));
});

const allBoards: Scope = { workspace: "all", account: null };

test("open cards keep the recorded city, including cities without a named market", async () => {
	const deals = await nextTransaction(connectionString, "read", (tx) =>
		readNextBoardDeals(tx, allBoards),
	);
	assert.deepEqual(
		deals
			.filter((deal) => [id(30), id(31), id(37)].includes(deal.id))
			.map((deal) => [deal.id, deal.market]),
		[
			[id(31), "Example Bay"],
			[id(30), null],
			[id(37), "Unmapped Example City"],
		],
	);
});

test("imported deals keep their recorded city and carry their named market", async () => {
	const { rows } = await db.query<{ id: string }>(
		"select id from market where name = 'Example Bay'",
	);
	await nextTransaction(connectionString, "read", async (tx) => {
		const board = await readNextBoardDeals(tx, allBoards);
		const detail = await readNextDealDetail(tx, id(31));
		assert.ok(!("error" in detail));
		assert.deepEqual(
			[board.find((deal) => deal.id === id(31)), detail].map((deal) => [
				deal?.market,
				deal?.market_id,
			]),
			[
				["Example Bay", rows[0]?.id],
				["Example Bay", rows[0]?.id],
			],
		);
		const national = board.find((deal) => deal.id === id(30));
		assert.deepEqual(
			[national?.market, national?.market_id],
			[null, rows[0]?.id],
		);
	});
});

test("an imported loss without phase events stays off the open board", async () => {
	const deals = await nextTransaction(connectionString, "read", (tx) =>
		readNextBoardDeals(tx, allBoards),
	);
	assert.ok(deals.every((deal) => deal.id !== id(40)));
});

test("an imported close date keeps a deal in a live phase off the open board", async () => {
	const deals = await nextTransaction(connectionString, "read", (tx) =>
		readNextBoardDeals(tx, allBoards),
	);
	assert.ok(deals.every((deal) => deal.id !== id(43)));
});

test("closed and lost lists keep the recorded outcome even without a close date or phase events", async () => {
	await nextTransaction(connectionString, "read", async (tx) => {
		const closed = await readNextBoardDeals(tx, allBoards, "closed");
		assert.deepEqual(
			closed.map((d) => [d.id, d.phase, d.outcome, d.closed_on, d.invoiced_on]),
			[
				[id(43), "negotiation", null, "2024-10-01", null],
				[id(33), "closed", null, "2024-09-01", null],
				[id(41), "closed", null, null, null],
				[id(35), "negotiation", null, null, "2025-02-01"],
				[id(36), "negotiation", null, null, "2025-02-02"],
				[id(42), "invoiced", null, null, null],
				[id(39), "closed", "won", null, null],
			],
		);
		const lost = await readNextBoardDeals(tx, allBoards, "lost");
		assert.deepEqual(
			lost.map((d) => [d.id, d.phase, d.outcome, d.closed_on]),
			[[id(40), "negotiation", "lost", null]],
		);
		const national = await readNextBoardDeals(
			tx,
			{ workspace: "national_account", account: id(16) },
			"closed",
		);
		assert.deepEqual(
			national.map((d) => d.id),
			[id(35)],
		);
	});
});

test("the deal page shares the card's copied phase, outcome and close date", async () => {
	await nextTransaction(connectionString, "read", async (tx) => {
		const closed = await readNextBoardDeals(tx, allBoards, "closed");
		const lost = await readNextBoardDeals(tx, allBoards, "lost");
		for (const dealId of [id(39), id(40), id(43)]) {
			const card = [...closed, ...lost].find((deal) => deal.id === dealId);
			assert.ok(card);
			const page = await readNextDealDetail(tx, dealId);
			assert.ok("id" in page);
			assert.deepEqual(
				[page.phase, page.outcome, page.closed_on],
				[card.phase, card.outcome, card.closed_on],
			);
		}
	});
});

test("copied ended renewals show the unrecorded lease and copied parking names automation", async () => {
	await nextTransaction(connectionString, "read", async (tx) => {
		const board = await readNextBoard(tx, id(1), { partner: "partner_one" });
		const closed = board.closed_deals.find((deal) => deal.id === id(39));
		const renewal = {
			kind: null,
			type: "renewal",
			reason: "renewal",
			renewal_lease_unrecorded: true,
		};
		const parking = {
			operating_state: "parked",
			parking_reason: "other",
			parking_note: "Example old pause",
			parked_at: "2024-07-01T14:00:00+00:00",
			parked_by: null,
			parked_automatically: true,
		};
		assert.partialDeepStrictEqual(closed, { ...renewal, ...parking });
		assert.partialDeepStrictEqual(await readNextDealDetail(tx, id(39)), {
			...renewal,
			...parking,
			checklist: { template_state: "deal_type_unknown", deal_type: null },
		});
		assert.partialDeepStrictEqual(
			board.lost_deals.find((deal) => deal.id === id(40)),
			renewal,
		);
		assert.partialDeepStrictEqual(
			await readNextDealDetail(tx, id(40)),
			renewal,
		);
		assert.partialDeepStrictEqual(
			board.deals.find((deal) => deal.id === id(32)),
			{
				parked_by: "dell",
				parked_automatically: false,
			},
		);
	});
});

test("changing a copied parking note replaces the automatic parker with the partner", async () => {
	const rollback = new Error("roll back example parking");
	await assert.rejects(
		nextTransaction(connectionString, "save", async (tx) => {
			await stampNextSave(tx, { user: "partner_one" });
			await tx
				.updateTable("deal")
				.set({ parking_note: "Example new pause" })
				.where("id", "=", id(39))
				.execute();
			assert.partialDeepStrictEqual(await readNextDealDetail(tx, id(39)), {
				parked_by: "partner_one",
				parked_automatically: false,
			});
			throw rollback;
		}),
		rollback,
	);
});

test("Deals reads show separate kind and reason and the earliest confirmed open date", async () => {
	const rollback = new Error("roll back example deal facts");
	await assert.rejects(
		nextTransaction(connectionString, "save", async (tx) => {
			await stampNextSave(tx, { user: "partner_one" });
			await sql`insert into property (id, address) values (${id(500)}, '100 Example Road')`.execute(
				tx,
			);
			await sql`insert into lease (id, party_id, property_id)
				values (${id(501)}, ${id(12)}, ${id(500)})`.execute(tx);
			await sql`update deal set kind = 'purchase', reason = 'renewal', renews_lease_id = ${id(501)}
				where id = ${id(39)}`.execute(tx);
			await sql`insert into critical_date (id, deal_id, kind, due_on, source) values
				(${id(502)}, ${id(39)}, 'loi_expiry', '2000-01-01', 'Example proposal'),
				(${id(503)}, ${id(39)}, 'due_diligence', '2000-01-02', 'Example completed date'),
				(${id(504)}, ${id(39)}, 'option_notice', '2000-01-03', 'Example open date'),
				(${id(505)}, ${id(39)}, 'lease_end', '2000-01-04', 'Example later date')`.execute(
				tx,
			);
			await sql`update critical_date set status = 'open' where id in (${id(503)}, ${id(504)}, ${id(505)})`.execute(
				tx,
			);
			await sql`update critical_date set status = 'done', resolution_reason = 'Example completed'
				where id = ${id(503)}`.execute(tx);

			const board = await readNextBoard(tx, id(1), { partner: "partner_one" });
			const facts = {
				kind: "purchase",
				reason: "renewal",
				type: "purchase",
				renewal_lease_unrecorded: false,
				next_critical_date: {
					id: id(504),
					kind: "option_notice",
					due_on: "2000-01-03",
				},
			};
			assert.partialDeepStrictEqual(
				board.closed_deals.find((deal) => deal.id === id(39)),
				facts,
			);
			assert.partialDeepStrictEqual(
				await readNextDealDetail(tx, id(39)),
				facts,
			);
			assert.partialDeepStrictEqual(
				board.deals.find((deal) => deal.id === id(31)),
				{
					kind: null,
					reason: "start_up",
					type: "startup",
					next_critical_date: null,
				},
			);
			throw rollback;
		}),
		rollback,
	);
});

test("National counts a late open step once and skips retained completion and checklist dates", async () => {
	const rollback = new Error("roll back example next steps");
	await assert.rejects(
		nextTransaction(connectionString, "save", async (tx) => {
			await stampNextSave(tx, { user: "partner_one" });
			await sql`insert into next_step (id, deal_id, owner_party_id, what, due_on) values
				(${id(509)}, ${id(30)}, ${id(1)}, 'Example send survey', '2000-01-01'),
				(${id(510)}, ${id(30)}, ${id(2)}, 'Example send plans', '2000-01-02'),
				(${id(506)}, ${id(31)}, ${id(1)}, 'Example confirm terms', '2000-01-03')`.execute(
				tx,
			);
			await sql`insert into next_step (deal_id, what, item_title, source_ref, due_on)
				values (${id(37)}, 'Example add file', 'Add file', 'Example checklist', '2000-01-04')`.execute(
				tx,
			);
			await sql`insert into activity (id, kind, happened_at)
				values (${id(507)}, 'call', '2000-01-10T18:00:00Z')`.execute(tx);
			await sql`insert into activity_about (activity_id, deal_id) values (${id(507)}, ${id(31)})`.execute(
				tx,
			);
			await stampNextSave(tx, { job: "old_system", for_user: "partner_one" });
			await sql`insert into proposal (id, kind, activity_id, activity_kind, deal_id, next_step_id, proposed_by_job, evidence)
				values (${id(508)}, 'next_step_done', ${id(507)}, 'call', ${id(31)}, ${id(506)}, 'old_system', 'Example terms confirmed')`.execute(
				tx,
			);
			await sql`select set_config('engine.job', '', true)`.execute(tx);
			await sql`update proposal set status = 'accepted' where id = ${id(508)}`.execute(
				tx,
			);

			const board = await readNextBoard(tx, id(1), { partner: "partner_one" });
			assert.partialDeepStrictEqual(
				board.deals.find((deal) => deal.id === id(31)),
				{
					next_date: "2000-01-03",
					next_step: null,
				},
			);
			assert.partialDeepStrictEqual(board.accounts, [
				{ account_client_id: id(16), overdue_deals: 1 },
			]);
			throw rollback;
		}),
		rollback,
	);
});

test("a call follow-up on the board has the item id Home gives it", async () => {
	const rollback = new Error("roll back example call follow-up");
	await assert.rejects(
		nextTransaction(connectionString, "save", async (tx) => {
			await stampNextSave(tx, { user: "partner_one" });
			await sql`insert into activity (id, kind, happened_at)
				values (${id(530)}, 'call', '2000-03-01T18:00:00Z')`.execute(tx);
			await sql`insert into activity_about (activity_id, deal_id) values (${id(530)}, ${id(37)})`.execute(
				tx,
			);
			await sql`insert into next_step (id, deal_id, owner_party_id, what, due_on, call_activity_id, call_evidence_quote)
				values (${id(531)}, ${id(37)}, ${id(1)}, 'Example send the call notes', '2000-03-02', ${id(530)}, 'Example quote')`.execute(
				tx,
			);
			const board = await readNextBoard(tx, id(1), { partner: "partner_one" });
			assert.deepEqual(
				board.deals.find((deal) => deal.id === id(37))?.open_actions,
				[
					{
						id: id(531),
						owner: "partner_one",
						due_on: "2000-03-02",
						item_id: `capture_post_call_action:${id(531)}`,
						description: "Example send the call notes",
					},
				],
			);
			throw rollback;
		}),
		rollback,
	);
});

test("the board never lists a cancelled step", async () => {
	const rollback = new Error("roll back example cancelled steps");
	await assert.rejects(
		nextTransaction(connectionString, "save", async (tx) => {
			await stampNextSave(tx, { user: "partner_one" });
			const before = await readNextBoard(tx, id(1), { partner: "partner_one" });
			const client = before.deals.find((row) => row.id === id(34))?.client_id;
			await sql`insert into next_step (id, deal_id, party_id, owner_party_id, what, resolution, resolution_reason) values
				(${id(524)}, ${id(37)}, null, ${id(1)}, 'Example check the old record', 'cancelled', 'Example replaced'),
				(${id(525)}, null, ${client}, ${id(1)}, 'Example check the old client', 'cancelled', 'Example replaced')`.execute(
				tx,
			);
			const board = await readNextBoard(tx, id(1), { partner: "partner_one" });
			const ids = board.deals.flatMap((deal) =>
				deal.open_actions.map((action) => action.id),
			);
			assert.ok(!ids.includes(id(524)) && !ids.includes(id(525)), ids.join());
			throw rollback;
		}),
		rollback,
	);
});

test("a deal with no step of its own shows its client's step, check-ins named, when it is the client's only open deal", async () => {
	const rollback = new Error("roll back example client steps");
	await assert.rejects(
		nextTransaction(connectionString, "save", async (tx) => {
			await stampNextSave(tx, { user: "partner_one" });
			const before = await readNextBoard(tx, id(1), { partner: "partner_one" });
			const clientOf = (deal: number) =>
				before.deals.find((row) => row.id === id(deal))?.client_id;
			await sql`insert into next_step (id, deal_id, party_id, owner_party_id, what, due_on) values
				(${id(520)}, null, ${clientOf(34)}, ${id(1)}, 'Nurture touch — Example Former Clinic. 45-day client cadence.', '2000-02-01'),
				(${id(521)}, null, ${clientOf(31)}, ${id(1)}, 'Example call the doctor', null),
				(${id(522)}, ${id(30)}, null, ${id(1)}, 'Example send the clinic plans', null),
				(${id(523)}, null, ${clientOf(30)}, ${id(2)}, 'Example call the clinic', null)`.execute(
				tx,
			);
			const board = await readNextBoard(tx, id(1), { partner: "partner_one" });
			const actions = (deal: number) =>
				board.deals.find((row) => row.id === id(deal))?.open_actions;
			assert.deepEqual(actions(34), [
				{
					id: id(520),
					owner: "partner_one",
					due_on: "2000-02-01",
					item_id: `next_action:${id(520)}`,
					description: "Check in with Example Former Clinic (client)",
					client_step: true,
				},
			]);
			assert.deepEqual(actions(31), []);
			assert.deepEqual(actions(37), []);
			assert.deepEqual(
				actions(30)?.map(({ description }) => description),
				["Example send the clinic plans"],
			);
			assert.ok(board.deals.every((deal) => !("client_actions" in deal)));
			throw rollback;
		}),
		rollback,
	);
});

test("the board and deal page name an old record code in a deal's check-in", async () => {
	const rollback = new Error("roll back example code check-in");
	await assert.rejects(
		nextTransaction(connectionString, "save", async (tx) => {
			await stampNextSave(tx, { user: "partner_one" });
			const before = await readNextBoard(tx, id(1), { partner: "partner_one" });
			const client = before.deals.find((row) => row.id === id(34));
			assert.ok(client?.client_id);
			await sql`insert into outside_id (source, value, party_id)
				values ('old_system_ref', 'C-0931', ${client.client_id})`.execute(tx);
			await sql`insert into next_step (id, deal_id, owner_party_id, what) values
				(${id(526)}, ${id(34)}, ${id(1)}, 'Relationship touch — C-0931. 60-day client cadence.')`.execute(
				tx,
			);
			const checkIn = `Check in with ${client.client_name} (client)`;
			const board = await readNextBoard(tx, id(1), { partner: "partner_one" });
			const deal = board.deals.find((row) => row.id === id(34));
			assert.equal(deal?.next_step, checkIn);
			assert.deepEqual(
				deal?.open_actions.map(({ description }) => description),
				[checkIn],
			);
			const page = await readNextDealDetail(tx, id(34));
			assert.ok(!("error" in page));
			assert.equal(page.next_step, checkIn);
			throw rollback;
		}),
		rollback,
	);
});

test("a deal stays won with its latest close date when it moves to Invoiced", async () => {
	const rollback = new Error("roll back test phase moves");
	await assert.rejects(
		nextTransaction(connectionString, "save", async (tx) => {
			await stampNextSave(tx, { user: "partner_one" });
			await sql`insert into deal_phase_change (deal_id, happened_at, phase)
				values (${id(33)}, '2025-04-01T12:00:00Z', 'negotiation'),
					(${id(33)}, '2025-04-03T01:00:00Z', 'closed')`.execute(tx);
			const closed = (await readNextBoardDeals(tx, allBoards, "closed")).find(
				(deal) => deal.id === id(33),
			);
			assert.ok(closed);
			assert.deepEqual(
				[closed.phase, closed.outcome, closed.closed_on],
				["closed", "won", "2025-04-02"],
			);

			await sql`insert into deal_phase_change (deal_id, happened_at, phase)
				values (${id(33)}, '2025-04-08T12:00:00Z', 'invoiced')`.execute(tx);
			const invoiced = (await readNextBoardDeals(tx, allBoards, "closed")).find(
				(deal) => deal.id === id(33),
			);
			assert.ok(invoiced);
			assert.deepEqual(
				[
					invoiced.phase,
					invoiced.outcome,
					invoiced.closed_on,
					invoiced.invoiced_on,
				],
				["invoiced", "won", "2025-04-02", null],
			);
			throw rollback;
		}),
		rollback,
	);
});

test("market and phase edits supersede the imported display values", async () => {
	const rollback = new Error("roll back test edits");
	await assert.rejects(
		nextTransaction(connectionString, "save", async (tx) => {
			await stampNextSave(tx, { user: "partner_one" });
			await tx
				.updateTable("deal")
				.set({ market_id: null })
				.where("id", "=", id(31))
				.execute();
			await sql`insert into deal_phase_change (deal_id, happened_at, phase)
				select ${id(40)}::uuid, max(happened_at) + interval '1 day', 'touring'
				from deal_phase_change where deal_id = ${id(40)}`.execute(tx);

			const deals = await readNextBoardDeals(tx, allBoards);
			assert.equal(deals.find((d) => d.id === id(31))?.market, null);
			assert.equal(deals.find((d) => d.id === id(40))?.phase, "touring");
			assert.deepEqual(await readNextBoardDeals(tx, allBoards, "lost"), []);
			throw rollback;
		}),
		rollback,
	);
});
