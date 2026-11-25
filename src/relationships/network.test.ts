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
	const blankVendor = id(815);
	const blankDeal = id(816);
	const personStep = id(818);
	const copiedStep = id(819);
	const clientId = id(302);
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		set local search_path = public;
		${SEED}
		set local search_path = next;
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into role (slug, label, category_of) values ('vendor', 'Vendor', null),
			('client', 'Client', null), ('lead', 'Lead', null), ('lender', 'Lender', 'vendor'),
			('contractor', 'Contractor', 'vendor');
		insert into stage (role, slug, label) values ('lead', 'new', 'New');
		insert into party (id, kind, name, how_found) values
			('${ME}', 'person', 'Example Partner', null),
			('${id(902)}', 'person', 'Other Partner', null),
			('${copied}', 'company', 'Copied Practice', 'referral'),
			('${person}', 'person', 'New Contact', null),
			('${vendor}', 'company', 'Example Lender', null),
			('${lead}', 'person', 'Unclaimed Lead', 'referral'),
			('${newClient}', 'company', 'New Practice', 'referral'),
			('${blankVendor}', 'company', ' ' || chr(9) || chr(65279), null);
		update party set city = 'Example City' where id = '${person}';
		insert into app_user (id, slug) values ('${ME}', 'joe'), ('${id(902)}', 'dell');
		insert into outside_id (source, value, party_id) values
			('old_system', '${copied}', '${copied}'),
			('old_system', '${clientId}', '${copied}'),
			('old_system_ref', 'C-EX-2', '${copied}'),
			('old_system', '${id(401)}', '${lead}');
		insert into party_role (party_id, role) values ('${copied}', 'client'),
			('${vendor}', 'vendor'), ('${newClient}', 'client'), ('${blankVendor}', 'vendor');
		insert into party_role (party_id, role, stage) values ('${lead}', 'lead', 'new');
		insert into client (party_id, owner_user_id) values ('${copied}', '${id(902)}');
		insert into territory (id, name) values ('${id(817)}', 'Example Territory');
		insert into party_territory (party_id, territory_id) values ('${vendor}', '${id(817)}');
		insert into activity (id, kind, happened_at, summary) values
			(md5('old_system:client:${clientId}:notes')::uuid, 'note', '2026-01-02', 'Copied client note'),
			(md5('old_system:lead:${id(401)}:notes')::uuid, 'note', '2026-01-02', 'Copied lead note'),
			(md5('old_system:lead:${id(401)}:source_detail')::uuid, 'note', '2026-01-03', 'Lead source detail');
		insert into activity_about (activity_id, party_id)
			select id, case when summary = 'Copied client note' then '${copied}' else '${lead}' end::uuid from activity;
		insert into do_not_contact (party_id, reason, until_date) values
			('${person}', 'Example expired hold', current_date - 1),
			('${newClient}', 'Example active hold', current_date + 7);
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'New Deal', '${ME}'), ('${blankDeal}', ' ' || chr(9), '${ME}');
		insert into phase (slug, label) values ('closed', 'Closed');
		insert into deal_phase_change (deal_id, happened_at, phase) values ('${deal}', '2026-01-02', 'closed');
		insert into deal_party (deal_id, party_id, role, created_at) values
			('${deal}', '${newClient}', 'client', '2026-01-01'), ('${deal}', '${vendor}', 'lender', '2026-01-03'),
			('${deal}', '${vendor}', 'contractor', '2026-01-04'), ('${blankDeal}', '${vendor}', 'lender', '2026-01-03');
		insert into party_link (party_id, other_party_id, kind, note, ended_on) values
			('${vendor}', '${lead}', 'can_introduce', 'Can make the introduction', null),
			('${copied}', '${lead}', 'can_introduce', 'Offer expired', '2020-01-01'),
			('${vendor}', '${copied}', 'can_introduce', 'Already introduced', null),
			('${blankVendor}', '${lead}', 'can_introduce', 'Invalid source', null);
		insert into introduction (vendor_id, made_by, introduced_party_id, deal_id, introduced_on, note) values
			('${vendor}', 'vendor', '${copied}', '${deal}', '2026-01-02', 'First referral'),
			('${vendor}', 'vendor', '${newClient}', '${deal}', '2026-01-03', 'Second referral'),
			('${blankVendor}', 'vendor', '${copied}', '${deal}', '2026-01-02', 'Invalid referrer'),
			('${vendor}', 'vendor', '${copied}', '${blankDeal}', '2026-01-02', 'Invalid deal');
		insert into introduction (vendor_id, made_by, introduced_party_id, introduced_by_user_id, note) values
			('${vendor}', 'team', '${person}', '${ME}', 'Partner made the introduction'),
			('${vendor}', 'team', '${ME}', '${ME}', 'Partner already an endpoint');
		insert into next_step (id, party_id, owner_party_id, what)
			select '${copiedStep}', party_id, '${ME}', 'Relationship touch — Example Copied Client (C-013). 90-day client cadence.' from outside_id
			where source = 'old_system' and value = '${clientId}';
		insert into activity (id, kind, happened_at, summary) values
			('${id(820)}', 'meeting', '2026-01-04', 'Talked about the new contact');
		insert into activity_about (activity_id, party_id) values ('${id(820)}', '${person}');
		insert into proposal (id, kind, party_id, activity_id, activity_kind, owner_party_id, what, evidence, proposed_by_job)
			values ('${personStep}', 'next_step', '${person}', '${id(820)}', 'meeting', '${ME}', 'Call the new contact', 'Follow up after the meeting', 'old_system');
		set local engine.job = '';
		set local engine.user_id = '${ME}';
		update proposal set status = 'accepted' where id = '${personStep}';
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
	assert.ok(Array.isArray(referrals));
	const linksByKind = (kind: string) =>
		edges.filter(isArguments).filter((row) => row.kind === kind);
	await t.test(
		"blank names never invalidate the app's graph or leave dangling references",
		() => {
			for (const row of nodes) {
				assert.ok(
					isArguments(row) && typeof row.name === "string" && row.name.trim(),
				);
			}
			assert.equal(node(`party:${blankVendor}`), undefined);
			assert.equal(node(`deal:${blankDeal}`), undefined);
			for (const edge of edges) {
				assert.ok(isArguments(edge));
				assert.ok(typeof edge.from === "string" && node(edge.from));
				assert.ok(typeof edge.to === "string" && node(edge.to));
				assert.ok(
					edge.via === null || (typeof edge.via === "string" && node(edge.via)),
				);
			}
			assert.deepEqual(referrals, [
				{ node_id: `party:${vendor}`, deals: 1, won: 1, lost: 0, win_rate: 1 },
			]);
		},
	);
	await t.test(
		"introduction suggestions are informational on switched reads",
		() => {
			assert.equal(snapshot.can_request_introductions, false);
			assert.deepEqual(
				linksByKind("can_introduce")
					.map((row) => row.detail)
					.sort(),
				["Already introduced", "Can make the introduction"],
			);
			assert.deepEqual(
				suggestions.filter(isArguments).map((row) => row.to),
				[`party:${lead}`],
			);
		},
	);
	await t.test(
		"parties show saved territory and copied relationship notes",
		() => {
			assert.equal(node(`party:${vendor}`)?.territory, "Example Territory");
			assert.equal(node(`party:${person}`)?.territory, "Example City");
			assert.equal(node(`party:${copied}`)?.summary, "Copied client note");
			assert.equal(node(`party:${lead}`)?.summary, "Copied lead note");
		},
	);
	await t.test("only a current hold shows as paused", () => {
		assert.equal(node(`party:${person}`)?.contact_state, "active");
		assert.equal(node(`party:${person}`)?.contact_state_until, null);
		assert.equal(node(`party:${newClient}`)?.contact_state, "paused");
	});
	await t.test("team introductions show a distinct recorded introducer", () => {
		const introduced = linksByKind("introduced");
		assert.equal(
			introduced.find((row) => row.from === `party:${person}`)?.via,
			`party:${ME}`,
		);
		assert.equal(
			introduced.find((row) => row.from === `party:${ME}`)?.via,
			null,
		);
	});
	await t.test(
		"deal credits appear once per kind with all their details",
		() => {
			const forDeal = (kind: string) =>
				linksByKind(kind).filter(
					(row) => row.from === `party:${vendor}` && row.to === `deal:${deal}`,
				);
			const refs = forDeal("referred");
			assert.equal(refs.length, 1);
			assert.equal(
				refs[0]?.detail,
				"2026-01-02 · First referral\n2026-01-03 · Second referral",
			);
			const worked = forDeal("worked");
			assert.equal(worked.length, 1);
			assert.equal(
				worked[0]?.detail,
				"Contractor (recorded 2026-01-04)\nLender (recorded 2026-01-03)",
			);
		},
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
		`/relationships?node=party:${copied}&step=${copiedStep}`,
		`/relationships?node=party:${person}&step=${personStep}`,
	]);
	assert.equal(snapshot.focused_step, undefined);
	const focused = async (user: string, step: string) => {
		const response = await request(
			{ user },
			`relationships?contract=relationship-network.v1&step=${step}`,
			{ method: "GET" },
			{ RELATIONSHIPS_READ_SCHEMA: "next" },
		);
		assert.equal(response.status, 200);
		const page: unknown = await response.json();
		assert.ok(isArguments(page));
		return page.focused_step;
	};
	const step = await focused("joe", personStep);
	assert.ok(isArguments(step) && typeof step.set_at === "string");
	assert.partialDeepStrictEqual(step, {
		id: personStep,
		party_id: person,
		what: "Call the new contact",
		set_by: "Example Partner",
		set_from: "meeting",
	});
	assert.ok(Number.isFinite(Date.parse(step.set_at)));
	assert.partialDeepStrictEqual(await focused("joe", copiedStep), {
		id: copiedStep,
		what: "Check in with Example Copied Client (client)",
		set_by: null,
		set_from: null,
	});
	assert.equal(await focused("dell", personStep), null);
});
