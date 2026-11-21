import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql } from "kysely";
import { nextTransaction } from "../next-connection.ts";
import { doorTest } from "../test-door.ts";
import { searchRecordsQuery } from "./records.ts";

const { db, setup, cleanup, request, readerUrl } = doorTest();
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [joe, dell, clinic, lead, vendor, person, deal, copied, oldDeal] = [
	id(1),
	id(2),
	id(3),
	id(4),
	id(5),
	id(6),
	id(7),
	id(8),
	id(9),
] as const;
const [copiedClient, copiedLead, dental, dentalGroup] = [
	id(14),
	id(15),
	id(16),
	id(17),
] as const;
const search = (query: string) =>
	get("find", query, { SEARCH_READ_SCHEMA: "next" });
const recent = (query: string, ref?: string) =>
	get("recent-activity", query, { ACTIVITY_READ_SCHEMA: "next" }, ref);

before(async () => {
	await setup();
	await db.query(`
		grant select on all tables in schema public to engine_reader;
		insert into public.actor (id, slug, kind, display_name) values ('${joe}', 'joe', 'human', 'Example Partner One');
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example Partner One'), ('${dell}', 'person', 'Example Partner Two'),
			('${clinic}', 'company', 'Orchard Clinic'), ('${lead}', 'person', 'Orchard Lead'),
			('${vendor}', 'company', 'Orchard Vendor'), ('${person}', 'person', 'Orchard Contact'),
			('${copiedClient}', 'company', 'Sample Practice'), ('${copiedLead}', 'person', 'Sample Prospect'),
			('${dental}', 'person', 'Example Pediatric Dental'), ('${dentalGroup}', 'company', 'Z Example Dental');
		insert into how_found (slug, label) values ('referral', 'Referral');
		update party set how_found = 'referral' where id in
			('${clinic}', '${lead}', '${copiedClient}', '${copiedLead}', '${dental}', '${dentalGroup}');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into role (slug, label) values
			('client', 'Client'), ('lead', 'Lead'), ('vendor', 'Vendor'), ('client_contact', 'Client contact');
		insert into stage (role, slug, label) values ('lead', 'new', 'New');
		insert into party_role (party_id, role, stage) values
			('${clinic}', 'client', null), ('${lead}', 'lead', 'new'), ('${vendor}', 'vendor', null),
			('${copiedClient}', 'client', null), ('${copiedClient}', 'lead', 'new'),
			('${copiedLead}', 'client', null), ('${copiedLead}', 'lead', 'new'),
			('${dental}', 'lead', 'new'), ('${dentalGroup}', 'lead', 'new');
		insert into client (party_id) values ('${clinic}'), ('${copiedClient}'), ('${copiedLead}');
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'Orchard Clinic Lease', '${joe}'), ('${copied}', 'Maple Lease', '${joe}');
		insert into deal_party (deal_id, party_id, role) values
			('${deal}', '${clinic}', 'client'), ('${deal}', '${lead}', 'client_contact'),
			('${copied}', '${clinic}', 'client');
		insert into outside_id (source, value, deal_id) values ('old_system', '${oldDeal}', '${copied}');
		insert into outside_id (source, value, party_id) values
			('old_system_ref', 'V-EXAMPLE', '${vendor}'),
			('old_system_ref', 'C-EXAMPLE', '${copiedClient}'),
			('old_system_ref', 'P-EXAMPLE', '${copiedClient}'),
			('old_system_ref', 'L-EXAMPLE', '${copiedLead}'),
			('old_system_lead', '${id(18)}', '${dental}');
		insert into party_link (party_id, other_party_id, kind, created_at) values
			('${copiedClient}', '${vendor}', 'knows', '2026-11-02T12:00:00Z'),
			('${copiedClient}', '${clinic}', 'knows', '2026-11-01T12:00:00Z');
		insert into specialty (slug, label) values ('oral_surgery', 'Oral Surgery');
		insert into party_specialty (person_id, specialty) values ('${dental}', 'oral_surgery');
		insert into party_email (party_id, address, label) values
			('${copiedClient}', 'office@practice.example', 'work'),
			('${person}', 'name@practice.example', 'work'),
			('${clinic}', 'office@other.practice.example', 'work');
		insert into party (kind, name)
			select 'person', 'Synthetic Query Plan ' || n from generate_series(1, 25) n;
		update deal set owner_user_id = '${dell}' where id = '${copied}';
		insert into activity (id, kind, happened_at, summary) values
			('${id(10)}', 'call', '2026-11-01T12:00:00Z', 'Discussed the site'),
			('${id(11)}', 'email', '2026-11-02T12:00:00Z', null),
			('${id(12)}', 'meeting', '2026-11-03T12:00:00Z', 'Visited the building'),
			('${id(13)}', 'note', '2026-11-04T12:00:00Z', 'Reviewed the floor plan');
		insert into email (activity_id, sender, subject, body, message_id)
			values ('${id(11)}', 'sender@example.test', 'Received the plan', 'Example body', 'example@test');
		insert into activity_about (activity_id, deal_id)
			select id, '${deal}' from activity;
		insert into activity_about (activity_id, party_id) values
			('${id(10)}', '${clinic}'), ('${id(10)}', '${copiedClient}'), ('${id(10)}', '${copiedLead}');
		insert into next_step (deal_id, what, created_at)
			values ('${deal}', 'Send the proposal', '2026-11-05T12:00:00Z');
	`);
});
after(cleanup);

async function get(
	path: string,
	query: string,
	bindings: object,
	ref?: string,
	headers?: HeadersInit,
) {
	const params = new URLSearchParams({ query });
	if (ref !== undefined) params.set("ref", ref);
	const response = await request(
		{ user: "joe" },
		`${path}?${params}`,
		{ method: "GET", ...(headers && { headers }) },
		bindings,
	);
	const body = await response.json();
	assert.equal(response.status, 200, JSON.stringify(body));
	return body;
}

const searchRecords = (query: string) =>
	get("find", query, { SEARCH_READ_SCHEMA: "next" }, undefined, {
		"x-doctorcre-search": "search.v1",
	});

test("Global Search returns a party once with its roles and openable deal matches", async () => {
	assert.partialDeepStrictEqual(await searchRecords("Sample Practice"), {
		schema_version: "search.v1",
		parties: [
			{ id: copiedClient, name: "Sample Practice", roles: ["client", "lead"] },
		],
		deals: [],
	});
	assert.partialDeepStrictEqual(await searchRecords("Orchard"), {
		parties: [
			{
				id: lead,
				roles: ["lead"],
				lead_id: null,
				deals: [{ id: deal, name: "Orchard Clinic Lease" }],
			},
			{
				id: clinic,
				deals: [
					{ id: copied, name: "Maple Lease" },
					{ id: deal, name: "Orchard Clinic Lease" },
				],
			},
			{ id: vendor, roles: ["vendor"] },
			{ id: person, kind: "person", roles: [] },
		],
		deals: [{ id: deal, name: "Orchard Clinic Lease", owner: "joe" }],
	});
	assert.partialDeepStrictEqual(
		await searchRecords("Example Pediatric Dental"),
		{
			parties: [{ id: dental, lead_id: id(18) }],
		},
	);
});

test("Global Search matches a full email or exact domain from stored addresses", async () => {
	assert.partialDeepStrictEqual(
		await searchRecords(" OFFICE@PRACTICE.EXAMPLE "),
		{
			parties: [{ id: copiedClient }],
			deals: [],
		},
	);
	for (const domain of ["practice.example", "@PRACTICE.EXAMPLE"]) {
		assert.partialDeepStrictEqual(await searchRecords(domain), {
			parties: [{ id: person }, { id: copiedClient }],
			deals: [],
		});
	}
	assert.partialDeepStrictEqual(
		await searchRecords("nobody@practice.example"),
		{
			parties: [],
			deals: [],
		},
	);
});

test("Global Search limits matches before expanding party roles and deals", async () => {
	const { rows } = await nextTransaction(readerUrl, "read", (tx) =>
		sql<{ "QUERY PLAN": string }>`explain (analyze, costs off, timing off)
			${searchRecordsQuery(tx, "Synthetic Query Plan")}`.execute(tx),
	);
	const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
	assert.match(
		plan,
		/CTE matched_parties\s+-> {2}Limit \(actual rows=15(?:\.00)? loops=1\)/,
	);
	assert.match(
		plan,
		/CTE Scan on matched_parties p\w* \(actual rows=15(?:\.00)? loops=1\)/,
	);
	assert.match(plan, /Limit \(actual rows=0(?:\.00)? loops=15\)/);
});

test("Search finds new records and shows a copied deal's current owner", async () => {
	assert.partialDeepStrictEqual(await search("orchard"), {
		deals: [
			{
				name: "Orchard Clinic Lease",
				phase: null,
				owner: "joe",
				client_ref: clinic,
				invoiced_on: null,
				closed_on: null,
				outcome: null,
				lane: "territory",
			},
		],
		parties: [
			{ kind: "lead", ref: lead },
			{ kind: "client", ref: clinic },
			{ kind: "vendor", ref: "V-EXAMPLE" },
		],
		organizations: [{ refs: [person] }],
	});
	assert.partialDeepStrictEqual(await search(oldDeal), {
		deals: [{ owner: "dell" }],
	});
});

test("Search finds a contact with a missing middle word and sorts by relevance", async () => {
	assert.partialDeepStrictEqual(await search("Example Dental"), {
		parties: [{ ref: dentalGroup }, { ref: dental }],
	});
});

test("Search finds deals filed under another client through the prospect's contact link", async () => {
	const result = await search("Orchard Lead");
	assert.ok(
		result &&
			typeof result === "object" &&
			"deals" in result &&
			"deals_via_link" in result &&
			Array.isArray(result.deals_via_link),
	);
	assert.deepStrictEqual(result.deals, []);
	assert.equal(result.deals_via_link.length, 1);
	assert.partialDeepStrictEqual(result, {
		deals_via_link: [{ name: "Orchard Clinic Lease", client_ref: clinic }],
	});
});

test("Search uses copied connection refs and next IDs for new endpoints", async () => {
	assert.partialDeepStrictEqual(await search("Sample Practice"), {
		connections: [
			{ from_ref: "C-EXAMPLE", to_ref: "V-EXAMPLE" },
			{ from_ref: "C-EXAMPLE", to_ref: clinic },
		],
	});
});

test("Search displays specialty labels", async () => {
	assert.partialDeepStrictEqual(await search("Example Pediatric Dental"), {
		parties: [{ ref: dental, specialty: "Oral Surgery" }],
	});
});

test("Recent Activity finds next-only records and uses copied refs", async () => {
	assert.partialDeepStrictEqual(await recent("Orchard Clinic Lease"), {
		state: "completed",
		catch_up: {
			subject: { type: "deal", id: deal },
			timeline: [
				{ verb: "next_step", summary: "Send the proposal" },
				{ verb: "note", summary: "Reviewed the floor plan" },
				{ verb: "meeting", summary: "Visited the building" },
				{ verb: "email", summary: "Received the plan" },
				{ verb: "call", summary: "Discussed the site" },
			],
		},
	});
	assert.partialDeepStrictEqual(await recent("Orchard Clinic"), {
		match: { target: clinic },
		catch_up: { timeline: [{ summary: "Discussed the site" }] },
	});
	assert.partialDeepStrictEqual(await recent("Orchard Vendor"), {
		match: { target: "V-EXAMPLE" },
	});
	assert.partialDeepStrictEqual(await recent(oldDeal), {
		catch_up: { subject: { type: "deal", id: copied } },
	});
});

test("Recent Activity accepts a copied client's drawer ref even when the client is also a lead", async () => {
	assert.partialDeepStrictEqual(await recent("Sample Practice", "C-EXAMPLE"), {
		state: "completed",
		match: { kind: "client", target: "C-EXAMPLE" },
		catch_up: { timeline: [{ summary: "Discussed the site" }] },
	});
});

test("Recent Activity prefers a canonical client ID to the copied lead sharing it", async () => {
	const expected = {
		state: "completed",
		match: { kind: "client", target: copiedLead },
		catch_up: { timeline: [{ summary: "Discussed the site" }] },
	};
	assert.partialDeepStrictEqual(await recent(copiedLead), expected);
	assert.partialDeepStrictEqual(
		await recent("Sample Prospect", copiedLead),
		expected,
	);
});

test("Recent Activity falls back to the query for an unknown ref", async () => {
	assert.partialDeepStrictEqual(await recent("Orchard Clinic", "C-UNKNOWN"), {
		state: "completed",
		match: { target: clinic },
	});
});

test("Recent Activity accepts a drawer ref with the switch off", async () => {
	const query = "Made-up name with no legacy match";
	assert.deepStrictEqual(
		await get("recent-activity", query, {}, "C-EXAMPLE"),
		await get("recent-activity", query, {}),
	);
});

test("Recent Activity includes the stored email body as detail", async () => {
	assert.partialDeepStrictEqual(await recent("Orchard Clinic Lease"), {
		catch_up: {
			timeline: [{ verb: "email", detail: "Example body", owed: null }],
		},
	});
});
