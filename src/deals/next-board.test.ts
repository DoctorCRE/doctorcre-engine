import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql } from "kysely";
import { nextTransaction } from "../next-connection.ts";
import { stampNextSave } from "../next-save.ts";
import { readSnapshot } from "../reader.ts";
import { copyTest, readSchema } from "../test-copy.ts";
import { readBoard, type Scope } from "./board.ts";
import { readNextBoardDeals } from "./next-board.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// A national clinic location, a doctor, a dental group and a location that left its brand, each with an open deal,
// one closed deal, two invoiced deals still in negotiation, one with no commission, a deal paid before its invoice,
// and an other-type deal with no phase events.
const OLD = `
insert into public.actor (id, slug, kind, display_name) values
 ('${id(1)}', 'partner_one', 'human', 'Example Partner One'),
 ('${id(2)}', 'partner_two', 'human', 'Example Partner Two');
insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
insert into public.party (id, kind, name, created_by, updated_by) values
 ('${id(16)}', 'org', 'Example National Brand', '${id(1)}', '${id(1)}'),
 ('${id(11)}', 'person', 'Dr. Jo Example', '${id(1)}', '${id(1)}'),
 ('${id(12)}', 'org', 'Example Dental Group', '${id(1)}', '${id(1)}'),
 ('${id(13)}', 'org', 'Example Former Location', '${id(1)}', '${id(1)}');
insert into public.party (id, kind, name, org_id, created_by, updated_by) values
 ('${id(10)}', 'org', 'Example Clinic Location', '${id(16)}', '${id(1)}', '${id(1)}');
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
 ('relocation', 'Example relocation', 3), ('other', 'Example other', 4);
insert into public.deal_phase (slug, label) values ('touring', 'Example touring'), ('negotiation', 'Example negotiation'),
 ('closed', 'Example closed');
insert into public.deal_lane (slug, label, sort) values ('national', 'Example national', 1);
insert into public.deal (id, client_id, name, deal_type, phase, owner, city, attention, created_by, updated_by, created_at) values
 ('${id(34)}', '${id(24)}', 'Example former brand lease', 'lease', 'touring', 'partner_one', null, false, '${id(1)}', '${id(1)}', '2025-01-05'),
 ('${id(31)}', '${id(21)}', 'Example startup office', 'startup', 'touring', 'partner_two', 'Example Bay', true, '${id(1)}', '${id(1)}', '2025-01-02'),
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
 ('${id(39)}', '${id(22)}', 'Example undated won lease', 'lease', 'closed', 'won', 'partner_one', '${id(1)}', '${id(1)}', '2024-06-03'),
 ('${id(40)}', '${id(22)}', 'Example undated lost lease', 'lease', 'closed', 'lost', 'partner_one', '${id(1)}', '${id(1)}', '2024-06-04');
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
 insert into copy_client_brand_date values ('${id(20)}', '2025-06-01');`,
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
insert into national_account_owner (account_id, owner_id, started_on, ended_on) values ('${id(16)}', '${id(1)}', '2023-01-01', '2024-03-01');
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
			["Example startup office", "partner_two", null, null],
			["Example clinic lease", "partner_one", null, "partner_two"],
			["Example dental move", "partner_one", "partner_two", null],
			["Example former brand lease", "partner_one", null, null],
			["Example lease paid before invoice", "partner_one", null, null],
			["Example other office", "partner_one", null, null],
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

test("an imported loss without phase events stays off the open board", async () => {
	const deals = await nextTransaction(connectionString, "read", (tx) =>
		readNextBoardDeals(tx, allBoards),
	);
	assert.ok(deals.every((deal) => deal.id !== id(40)));
});

test("closed and lost lists keep the recorded outcome even without a close date or phase events", async () => {
	await nextTransaction(connectionString, "read", async (tx) => {
		const closed = await readNextBoardDeals(tx, allBoards, "closed");
		assert.deepEqual(
			closed.map((d) => [d.id, d.phase, d.outcome, d.closed_on, d.invoiced_on]),
			[
				[id(33), "closed", null, "2024-09-01", null],
				[id(35), "negotiation", null, null, "2025-02-01"],
				[id(36), "negotiation", null, null, "2025-02-02"],
				[id(39), "closed", "won", null, null],
			],
		);
		const lost = await readNextBoardDeals(tx, allBoards, "lost");
		assert.deepEqual(
			lost.map((d) => [d.id, d.phase, d.outcome, d.closed_on]),
			[[id(40), "closed", "lost", null]],
		);
		const national = await readNextBoardDeals(
			tx,
			{ workspace: "national_account", account: id(16) },
			"closed",
		);
		assert.deepEqual(national, []);
	});
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
				values (${id(40)}, '2025-04-01T12:00:00Z', 'touring')`.execute(tx);

			const deals = await readNextBoardDeals(tx, allBoards);
			assert.equal(deals.find((d) => d.id === id(31))?.market, null);
			assert.equal(deals.find((d) => d.id === id(40))?.phase, "touring");
			assert.deepEqual(await readNextBoardDeals(tx, allBoards, "lost"), []);
			throw rollback;
		}),
		rollback,
	);
});
