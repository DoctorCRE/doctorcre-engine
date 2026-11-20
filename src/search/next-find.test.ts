import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request } = doorTest();
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

before(async () => {
	await setup();
	await db.query(`
		grant select on all tables in schema public to engine_reader;
		insert into public.actor (id, slug, kind, display_name) values ('${joe}', 'joe', 'human', 'Example Partner One');
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example Partner One'), ('${dell}', 'person', 'Example Partner Two'),
			('${clinic}', 'company', 'Orchard Clinic'), ('${lead}', 'person', 'Orchard Lead'),
			('${vendor}', 'company', 'Orchard Vendor'), ('${person}', 'person', 'Orchard Contact');
		insert into how_found (slug, label) values ('referral', 'Referral');
		update party set how_found = 'referral' where id in ('${clinic}', '${lead}');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into role (slug, label) values ('client', 'Client'), ('lead', 'Lead'), ('vendor', 'Vendor');
		insert into stage (role, slug, label) values ('lead', 'new', 'New');
		insert into party_role (party_id, role, stage) values
			('${clinic}', 'client', null), ('${lead}', 'lead', 'new'), ('${vendor}', 'vendor', null);
		insert into client (party_id) values ('${clinic}');
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'Orchard Clinic Lease', '${joe}'), ('${copied}', 'Maple Lease', '${joe}');
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${clinic}', 'client');
		insert into outside_id (source, value, deal_id) values ('old_system', '${oldDeal}', '${copied}');
		insert into outside_id (source, value, party_id) values ('old_system_ref', 'V-EXAMPLE', '${vendor}');
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
		insert into activity_about (activity_id, party_id) values ('${id(10)}', '${clinic}');
		insert into next_step (deal_id, what, created_at)
			values ('${deal}', 'Send the proposal', '2026-11-05T12:00:00Z');
	`);
});
after(cleanup);

async function get(path: string, query: string, bindings: object) {
	const response = await request(
		{ user: "joe" },
		`${path}?query=${encodeURIComponent(query)}`,
		{ method: "GET" },
		bindings,
	);
	const body = await response.json();
	assert.equal(response.status, 200, JSON.stringify(body));
	return body;
}

test("Search finds new records and shows a copied deal's current owner", async () => {
	const bindings = { SEARCH_READ_SCHEMA: "next" };
	assert.partialDeepStrictEqual(await get("find", "orchard", bindings), {
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
			{ kind: "client", ref: clinic },
			{ kind: "lead", ref: lead },
			{ kind: "vendor", ref: "V-EXAMPLE" },
		],
		organizations: [{ refs: [person] }],
	});
	assert.partialDeepStrictEqual(await get("find", oldDeal, bindings), {
		deals: [{ owner: "dell" }],
	});
});

test("Recent Activity finds next-only records and uses copied refs", async () => {
	const recent = (query: string) =>
		get("recent-activity", query, { ACTIVITY_READ_SCHEMA: "next" });
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
