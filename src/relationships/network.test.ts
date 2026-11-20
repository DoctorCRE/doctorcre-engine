import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { URL } from "node:url";
import { sql } from "kysely";
import { withSnapshot } from "../../scripts/test-database.ts";
import { BusinessRefusal } from "../clients/read.ts";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";
import { withRollback } from "../test-rollback.ts";
import worker from "../worker.ts";
import { projectNetwork, readNetwork } from "./network.ts";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = id(901);
const NOW = new Date("2026-03-01T12:00:00.000Z");

// A to H are 101 to 108: A is a vendor, with a merged vendor row, that is
// also a client, B a client that is also a lead, C an avoided vendor, D a
// suppressed lead, E and F paused contacts (E until today, F until
// yesterday), G a contact and H a contact on no link.
const SEED = `
insert into actor (id, slug, kind, display_name) values ('${ME}', 'joe', 'human', 'Example');
insert into contact_state values ('active', 'Example', true, 1), ('paused', 'Example', false, 2)
	on conflict do nothing;
insert into lead_stage (slug, label) values ('open', 'Example') on conflict do nothing;
insert into vendor_disposition values ('active', 'Example', true, 1), ('avoid', 'Example', false, 2)
	on conflict do nothing;
insert into party_link_kind values ('can_introduce', 'Example', 1),
	('intro_requested', 'Example', 2), ('knows', 'Example', 3) on conflict do nothing;
insert into deal_type_ref values ('example-lease', 'Example', 1) on conflict do nothing;
insert into deal_phase (slug, label) values ('example-open', 'Example') on conflict do nothing;
insert into party (id, kind, name, ref, city, contact_state, contact_state_until, created_by, updated_by)
select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'person', name, ref, city,
	state, until::date, '${ME}', '${ME}' from (values
	(101, 'Example A', null, 'Springfield', 'active', null), (102, 'Example B', null, null, 'active', null),
	(103, 'Example C', null, 'Springfield', 'active', null), (104, 'Example D', 'P-4', null, 'active', null),
	(105, 'Example E', null, null, 'paused', '2026-03-01'), (106, 'Example F', null, null, 'paused', '2026-02-28'),
	(107, 'Example G', null, null, 'active', null), (108, 'Example H', null, null, 'active', null)
) s(n, name, ref, city, state, until);
insert into vendor (id, party_id, category, vendor_ref, offers, territory, verticals, disposition,
	deal_evidence, created_by, updated_by) values
	('${id(201)}', '${id(101)}', 'lender', null, null, null, null, 'active', '[]', '${ME}', '${ME}'),
	('${id(203)}', '${id(103)}', 'lender', 'V-3', 'Offers', 'North', '{}', 'avoid', '[
		{"deal_id": "${id(501)}", "role": "worked", "occurred_at": "2026-02-01T00:00:00Z", "evidence_ref": "Note B"},
		{"deal_id": "${id(501)}", "role": "worked", "occurred_at": "2026-01-15T10:00:00Z", "evidence_ref": "Note A"},
		{"deal_id": "${id(501)}", "role": "worked", "occurred_at": "2026-01-20T00:00:00Z", "evidence_ref": "Note A"}
	]', '${ME}', '${ME}');
insert into vendor (id, party_id, category, vendor_ref, merged_into, created_by, updated_by)
	values ('${id(200)}', '${id(101)}', 'lender', 'V-0', '${id(201)}', '${ME}', '${ME}');
insert into client (id, party_id, roster_ref, notes, vertical, owner_id, created_by, updated_by) values
	('${id(301)}', '${id(101)}', 'C-1', 'Client note', 'Dental', '${ME}', '${ME}', '${ME}'),
	('${id(302)}', '${id(102)}', null, null, null, null, '${ME}', '${ME}');
insert into lead (id, party_id, stage, suppressed, registry_ref, segment, owner_id, notes,
	created_by, updated_by) values
	('${id(401)}', '${id(102)}', 'open', false, 'L-2', 'Imaging', '${ME}', 'Lead note', '${ME}', '${ME}'),
	('${id(404)}', '${id(104)}', 'open', true, null, null, null, null, '${ME}', '${ME}');
insert into deal (id, client_id, name, outcome, owner, city, deal_type, phase, created_by, updated_by)
select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
	('00000000-0000-4000-8000-' || lpad(c::text, 12, '0'))::uuid, 'Example Deal ' || (n - 500),
	outcome, owner, city, 'example-lease', 'example-open', '${ME}', '${ME}' from (values
	(501, 302, 'won', 'joe', 'Springfield'), (502, 302, 'lost', null, null),
	(503, 302, 'won', null, null), (504, 301, null, null, null)) s(n, c, outcome, owner, city);
insert into party_link (id, from_party, to_party, via_party, kind, note, occurred_on, created_at,
	source, created_by)
select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
	('00000000-0000-4000-8000-' || lpad(f::text, 12, '0'))::uuid,
	('00000000-0000-4000-8000-' || lpad(t::text, 12, '0'))::uuid,
	('00000000-0000-4000-8000-' || lpad(v::text, 12, '0'))::uuid,
	kind, note, d::date, coalesce(at, '2025-12-31T00:00:00Z')::timestamptz, 'Example', '${ME}' from (values
	(601, 107, 106, null, 'can_introduce', 'Knows F well', '2026-01-02', null),
	(602, 107, 102, null, 'can_introduce', 'Met at an event', null, '2026-01-02T00:00:00.5Z'),
	(603, 107, 105, null, 'can_introduce', 'E is held', '2026-01-03', null),
	(604, 107, 104, null, 'can_introduce', 'D is restricted', '2026-01-03', null),
	(605, 102, 106, null, 'can_introduce', 'Asked already', '2026-01-03', null),
	(606, 106, 102, null, 'intro_requested', null, '2026-01-03', null),
	(607, 101, 107, null, 'can_introduce', '   ', '2026-01-03', null),
	(608, 106, 107, null, 'knows', null, '2026-01-04', null),
	(609, 101, 102, 103, 'can_introduce', 'Through C', '2026-01-03', null),
	(610, 101, 106, 107, 'can_introduce', 'Through G', '2026-01-01', null)
) s(n, f, t, v, kind, note, d, at);
insert into party_link_deal (link_id, deal_id, referred_by, note, occurred_on, created_at, created_by)
values ('${id(608)}', '${id(501)}', '${id(101)}', 'Ref one', '2026-01-05', now(), '${ME}'),
	('${id(608)}', '${id(502)}', '${id(101)}', 'Ref two', null, '2026-01-06T01:02:03.456789Z', '${ME}'),
	('${id(608)}', '${id(503)}', '${id(101)}', 'Ref one', '2026-01-07', now(), '${ME}'),
	('${id(605)}', '${id(504)}', '${id(102)}', 'Ref four', '2026-01-08', now(), '${ME}'),
	('${id(601)}', '${id(504)}', '${id(107)}', 'Ref five', '2026-01-09', now(), '${ME}');
`;

// The old system's answer to SEED at NOW, recorded from carr-system 7a8ca32.
const OLD_ANSWER = new URL("./old-answer.json", import.meta.url);

test("the network answers the old JSON text for one made-up graph", () =>
	withRollback(async (tx) => {
		await sql.raw(SEED).execute(tx);
		const answer = projectNetwork(await readNetwork(tx), NOW);
		const old = JSON.parse(await readFile(OLD_ANSWER, "utf8"));
		assert.equal(JSON.stringify(answer), JSON.stringify(old));
	}));

test("the network refuses more than 5000 people and deals or 20000 links", () => {
	const nodes = (count: number) =>
		Array.from({ length: count }, (_, n) => ({
			id: `party:${n}`,
			contact_state: "active",
		}));
	const edges = (count: number) =>
		Array.from({ length: count }, (_, n) => ({
			id: `link:${n}`,
			to: "party:1",
			via: null,
			from: "party:0",
			kind: "knows",
			when: null,
			detail: null,
			summary: null,
		}));
	const project = (n: number, e: number) =>
		projectNetwork({ nodes: nodes(n), edges: edges(e), referrals: [] }, NOW);
	assert.equal(project(5000, 20_000).nodes.length, 5000);
	for (const [n, e] of [
		[5001, 0],
		[0, 20_001],
	] as const)
		assert.throws(
			() => project(n, e),
			(error) =>
				error instanceof BusinessRefusal &&
				error.body.error === "DEPENDENCY_UNAVAILABLE",
		);
});

const unread = "postgres://made-up@127.0.0.1:1/none";
const get = async (
	search: string,
	{ slug = "joe", database = unread as string | null, method = "GET" } = {},
) => {
	const response = await worker.request(
		`https://app.example.test/api/engine/relationships${search}`,
		{ method, headers: { Cookie: "__Host-dealroom_session=made-up-session" } },
		{
			CARR: {
				fetch: async () =>
					Response.json({
						actor: { slug, display: "Example Partner" },
						csrf_token: "made-up-csrf",
					}),
			},
			...(database ? { DATABASE: { connectionString: database } } : {}),
		},
	);
	return [response.status, await response.text()] as const;
};

test("the network refuses with the old bodies, partner before query", async () => {
	const query = "?contract=relationship-network.v1";
	const invalid = [400, '{"error":"QUERY_INVALID"}'];
	const unavailable = [503, '{"error":"DEPENDENCY_UNAVAILABLE"}'];
	assert.deepEqual(await get("?x=1", { slug: "example" }), [
		403,
		'{"error":"AUTHORIZATION_REFUSED"}',
	]);
	for (const search of [
		"",
		"?contract=relationship-network.v2",
		`${query}&viewer=joe`,
		`${query}&contract=relationship-network.v1`,
	])
		assert.deepEqual(await get(search), invalid, search);
	assert.deepEqual(await get(query, { database: null }), unavailable);
	assert.deepEqual(await get(query), unavailable);
});

test("the network answers GET and an empty HEAD from the database", () =>
	withSnapshot(async (database) => {
		const [status, text] = await get("?contract=relationship-network.v1", {
			database,
		});
		const { observed_at, valid_until, ...rest } = JSON.parse(text);
		assert.equal(status, 200);
		assert.equal(Date.parse(valid_until) - Date.parse(observed_at), 120_000);
		assert.equal(
			JSON.stringify(rest),
			'{"schema":"carr-relationship-network.v1","edges":[],"nodes":[],"referrals":[],"suggestions":[]}',
		);
		assert.deepEqual(
			await get("?contract=relationship-network.v1", {
				database,
				method: "HEAD",
			}),
			[200, ""],
		);
	}));

test("the switched graph shows current owners and opens Home steps on new and copied parties", async (t) => {
	const { db, setup, cleanup, request } = doorTest();
	await setup();
	t.after(async () => {
		await db.query("rollback");
		await cleanup();
	});
	const copied = id(102);
	const person = id(810);
	const vendor = id(811);
	const lead = id(812);
	const deal = id(813);
	const newClient = id(814);
	const clientId = id(302);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		set local search_path = public;
		${SEED}
		set local search_path = next;
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into role (slug, label, category_of) values ('vendor', 'Vendor', null),
			('client', 'Client', null), ('lead', 'Lead', null), ('lender', 'Lender', 'vendor');
		insert into stage (role, slug, label) values ('lead', 'new', 'New');
		insert into party (id, kind, name, how_found) values
			('${ME}', 'person', 'Example Partner', null),
			('${id(902)}', 'person', 'Other Partner', null),
			('${copied}', 'company', 'Copied Practice', 'referral'),
			('${person}', 'person', 'New Contact', null),
			('${vendor}', 'company', 'Example Lender', null),
			('${lead}', 'person', 'Unclaimed Lead', 'referral'),
			('${newClient}', 'company', 'New Practice', 'referral');
		insert into app_user (id, slug) values ('${ME}', 'joe'), ('${id(902)}', 'dell');
		insert into outside_id (source, value, party_id) values
			('old_system', '${copied}', '${copied}'),
			('old_system', '${clientId}', '${copied}'),
			('old_system_ref', 'C-EX-2', '${copied}');
		insert into party_role (party_id, role) values ('${copied}', 'client'),
			('${vendor}', 'vendor'), ('${newClient}', 'client');
		insert into party_role (party_id, role, stage) values ('${lead}', 'lead', 'new');
		insert into client (party_id, owner_user_id) values ('${copied}', '${id(902)}');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'New Deal', '${ME}');
		insert into phase (slug, label) values ('closed', 'Closed');
		insert into deal_phase_change (deal_id, happened_at, phase) values ('${deal}', '2026-01-02', 'closed');
		insert into deal_party (deal_id, party_id, role) values
			('${deal}', '${newClient}', 'client'), ('${deal}', '${vendor}', 'lender');
		insert into party_link (party_id, other_party_id, kind, note, ended_on) values
			('${vendor}', '${lead}', 'can_introduce', 'Can make the introduction', null),
			('${copied}', '${lead}', 'can_introduce', 'Offer expired', '2020-01-01'),
			('${vendor}', '${copied}', 'can_introduce', 'Already introduced', null);
		insert into introduction (vendor_id, made_by, introduced_party_id, deal_id)
			values ('${vendor}', 'vendor', '${copied}', '${deal}');
		insert into next_step (party_id, owner_party_id, what) values
			('${person}', '${ME}', 'Call the new contact');
		insert into next_step (party_id, owner_party_id, what)
			select party_id, '${ME}', 'Call the copied client' from outside_id
			where source = 'old_system' and value = '${clientId}';
		commit;`);

	const caller = { user: "joe" };
	const graph = await request(
		caller,
		"relationships?contract=relationship-network.v1",
		{ method: "GET" },
		{ RELATIONSHIPS_READ_SCHEMA: "next" },
	);
	assert.equal(graph.status, 200);
	const snapshot = await graph.json();
	assert.ok(isArguments(snapshot));
	const { nodes, edges, referrals, suggestions } = snapshot;
	assert.ok(Array.isArray(nodes));
	assert.ok(Array.isArray(edges));
	assert.ok(Array.isArray(suggestions));
	const node = (key: string) =>
		nodes.filter(isArguments).find((row) => row.id === key);
	assert.equal(node(`party:${person}`)?.kind, "contact");
	assert.equal(node(`party:${newClient}`)?.kind, "client");
	assert.equal(node(`party:${copied}`)?.owner, "dell");
	assert.equal(node(`party:${copied}`)?.ref, "C-EX-2");
	assert.equal(node(`party:${lead}`)?.owner, null);
	assert.equal(node(`deal:${deal}`)?.owner, "joe");
	assert.equal(node(`deal:${deal}`)?.outcome, "won");
	assert.equal(node(`deal:${id(501)}`), undefined);
	const edgeKinds = edges.map((edge) => {
		assert.ok(isArguments(edge));
		assert.ok(typeof edge.from === "string" && node(edge.from));
		assert.ok(typeof edge.to === "string" && node(edge.to));
		assert.equal(edge.via, null);
		return edge.kind;
	});
	assert.deepEqual(edgeKinds.sort(), [
		"can_introduce",
		"can_introduce",
		"client_deal",
		"introduced",
		"referred",
		"worked",
	]);
	assert.deepEqual(referrals, [
		{ node_id: `party:${vendor}`, deals: 1, won: 1, lost: 0, win_rate: 1 },
	]);
	assert.deepEqual(
		suggestions.filter(isArguments).map((suggestion) => suggestion.to),
		[`party:${lead}`],
	);

	const home = await request(
		caller,
		"home/inbox",
		{ method: "GET" },
		{ HOME_INBOX_READ_SCHEMA: "next" },
	);
	assert.equal(home.status, 200);
	const inbox = await home.json();
	assert.ok(isArguments(inbox));
	const { items } = inbox;
	assert.ok(Array.isArray(items));
	const links = items.map((item) => {
		assert.ok(isArguments(item) && typeof item.open_url === "string");
		const url = new URL(item.open_url, "https://app.example.test");
		assert.equal(url.pathname, "/relationships");
		assert.ok(node(url.searchParams.get("node") ?? ""));
		return item.open_url;
	});
	assert.deepEqual(links.sort(), [
		`/relationships?node=party:${copied}`,
		`/relationships?node=party:${person}`,
	]);
});
