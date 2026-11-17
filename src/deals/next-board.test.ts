import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { nextTransaction } from "../next-connection.ts";
import { readSnapshot } from "../reader.ts";
import { copyTest, readSchema } from "../test-copy.ts";
import { readBoard, type Scope } from "./board.ts";
import { readNextBoardDeals } from "./next-board.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// A national clinic location, a doctor and a dental group, each with an open deal, and one closed deal.
const OLD = `
insert into public.actor (id, slug, kind, display_name) values
 ('${id(1)}', 'partner_one', 'human', 'Example Partner One'),
 ('${id(2)}', 'partner_two', 'human', 'Example Partner Two');
insert into public.contact_state (slug, label, contactable, sort) values ('active', 'Example active', true, 1);
insert into public.party (id, kind, name, created_by, updated_by) values
 ('${id(16)}', 'org', 'Example National Brand', '${id(1)}', '${id(1)}'),
 ('${id(11)}', 'person', 'Dr. Jo Example', '${id(1)}', '${id(1)}'),
 ('${id(12)}', 'org', 'Example Dental Group', '${id(1)}', '${id(1)}');
insert into public.party (id, kind, name, org_id, created_by, updated_by) values
 ('${id(10)}', 'org', 'Example Clinic Location', '${id(16)}', '${id(1)}', '${id(1)}');
insert into public.client_type (slug, label) values ('national_account', 'Example account');
insert into public.client_status (slug, label) values ('engaged', 'Example engaged');
insert into public.client (id, party_id, status, client_type, acquisition_source, created_by, updated_by) values
 ('${id(20)}', '${id(10)}', 'engaged', null, 'Example referral', '${id(1)}', '${id(1)}'),
 ('${id(21)}', '${id(11)}', 'engaged', null, 'Example referral', '${id(1)}', '${id(1)}'),
 ('${id(22)}', '${id(12)}', 'engaged', null, 'Example referral', '${id(1)}', '${id(1)}'),
 ('${id(23)}', '${id(16)}', 'engaged', 'national_account', 'Example referral', '${id(1)}', '${id(1)}');
insert into public.national_account_owner (account_client_id, owner_actor_id, set_by) values ('${id(23)}', '${id(2)}', '${id(1)}');
insert into public.vendor_market (slug, name, kind, boundary, source, reviewed_by, reviewed_at) values
 ('example-bay', 'Example Bay', 'market', 'Example counties', 'Example review', '${id(1)}', '2025-01-01');
insert into public.deal_type_ref (slug, label, sort) values ('lease', 'Example lease', 1), ('startup', 'Example startup', 2),
 ('relocation', 'Example relocation', 3);
insert into public.deal_phase (slug, label) values ('touring', 'Example touring'), ('negotiation', 'Example negotiation'),
 ('closed', 'Example closed');
insert into public.deal (id, client_id, name, deal_type, phase, owner, city, attention, created_by, updated_by, created_at) values
 ('${id(30)}', '${id(20)}', 'Example clinic lease', 'lease', 'negotiation', 'partner_one', null, false, '${id(1)}', '${id(1)}', '2025-01-01'),
 ('${id(31)}', '${id(21)}', 'Example startup office', 'startup', 'touring', 'partner_two', 'Example Bay', true, '${id(1)}', '${id(1)}', '2025-01-02'),
 ('${id(33)}', '${id(22)}', 'Example closed lease', 'lease', 'closed', 'partner_one', 'Example Bay', false, '${id(1)}', '${id(1)}', '2024-06-01');
insert into public.deal (id, client_id, name, deal_type, phase, owner, city, operating_state, parking_reason, parking_note, parked_at, parked_by,
 created_by, updated_by, created_at) values
 ('${id(32)}', '${id(22)}', 'Example dental move', 'relocation', 'negotiation', 'partner_one', 'Example Bay', 'parked', 'client_paused',
 'Example pause', '2025-03-04T05:06:07Z', '${id(2)}', '${id(1)}', '${id(1)}', '2025-01-03');
insert into public.event (id, subject_type, subject_id, field, old_value, new_value, occurred_at, actor_id, verb, cause) values
 ('${id(40)}', 'deal', '${id(30)}', 'phase', null, '{"phase":"negotiation"}', '2025-01-02', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(41)}', 'deal', '${id(31)}', 'phase', null, '{"phase":"touring"}', '2025-01-03', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(42)}', 'deal', '${id(32)}', 'phase', null, '{"phase":"negotiation"}', '2025-01-04', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(43)}', 'deal', '${id(33)}', 'phase', null, '{"phase":"negotiation"}', '2024-06-02', '${id(1)}', 'update-deal', 'human_stated'),
 ('${id(44)}', 'deal', '${id(33)}', 'phase', '{"phase":"negotiation"}', '{"phase":"closed"}', '2024-09-01', '${id(1)}', 'update-deal', 'human_stated');
update public.deal set closed_on = '2024-09-01' where id = '${id(33)}';
`;

// The partners' reviewed first known dates, which the account and brand copies need.
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
 insert into copy_client_brand_date values ('${id(20)}', '2024-01-01');`,
	],
	["copy-deals.sql"],
];

// A client is its person or company in the new section, so its id is the party's.
const CLIENT_PARTY = new Map([
	[id(20), id(10)],
	[id(21), id(11)],
	[id(22), id(12)],
	[id(23), id(16)],
]);

// The board fields this read covers; the steps, files and history reads add the rest.
const COVERED = new Set([
	"id",
	"name",
	"type",
	"phase",
	"owner",
	"attention",
	"market",
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
	"short_name",
]);

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
	return [...CLIENT_PARTY].reduce(
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
				account: scope.account && (CLIENT_PARTY.get(scope.account) ?? null),
			}),
		);
		assert.equal(JSON.stringify(actual), expected);
	});
}

test("the comparison covers every open deal, owner, parking and national account", async () => {
	const deals = await nextTransaction(connectionString, "read", (tx) =>
		readNextBoardDeals(tx, { workspace: "all", account: null }),
	);
	assert.deepEqual(
		deals.map((d) => [d.name, d.owner, d.parked_by, d.account_owner]),
		[
			["Example startup office", "partner_two", null, null],
			["Example clinic lease", "partner_one", null, "partner_two"],
			["Example dental move", "partner_one", "partner_two", null],
		],
	);
});
