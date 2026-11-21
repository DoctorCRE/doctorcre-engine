import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const joe = randomUUID();
const dell = randomUUID();
const brand = randomUUID();
const copied = randomUUID();
const oldClient = randomUUID();
const market = randomUUID();
const filedEmail = randomUUID();
type ClientRow = {
	id: string;
	name: string;
	ref: string;
	owner_label: string;
	owned_by_viewer: boolean;
	active_deals?: { id: string; name: string }[];
	recorded_client_type: string | null;
	recorded_client_type_label: string | null;
};
type TypeFacet = { slug: string; label: string };
type ClientRecord = ClientRow & {
	acquisition_source: string;
	phone: string | null;
	cell: string | null;
};
const caller = { user: "joe" };

before(setup);
after(cleanup);

test("Clients opens a location saved through Deals and shows the next owner of a copied client", async (t) => {
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into phase values ('pending', 'Pending');
		insert into how_found values ('national_account', 'National account or corporate lead');
		insert into role values ('client', 'Client'), ('national_account', 'National account');
		insert into client_type values ('franchise', 'Franchise');
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example First Partner'),
			('${dell}', 'person', 'Example Corrected Owner'),
			('${brand}', 'company', 'Example Brand'),
			('${copied}', 'company', 'Example Copied Client');
		update party set how_found = 'national_account' where id = '${copied}';
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into party_role (party_id, role) values
			('${brand}', 'national_account'), ('${copied}', 'client'), ('${copied}', 'national_account');
		insert into national_account (party_id) values ('${brand}'), ('${copied}');
		insert into client (party_id, owner_user_id) values ('${copied}', '${dell}');
		insert into outside_id (source, value, party_id) values
			('old_system', '${oldClient}', '${copied}'),
			('old_system_ref', 'C-001', '${copied}');
		insert into party_phone (party_id, number, extension, label) values
			('${copied}', '+12025550101', '45', 'work'),
			('${copied}', '+12025550102', null, 'mobile');
		insert into market (id, name) values ('${market}', 'Example Market');
		commit;`);

	const [status, receipt] = await save(caller, "deals", {
		idempotency_key: randomUUID(),
		name: "Example Deal",
		national_account_id: brand,
		market_id: market,
		owner: "joe",
		phase: "pending",
		new_location: { kind: "company", name: "Example New Location" },
	});
	assert.equal(status, 201, JSON.stringify(receipt));

	const get = (path: string, bindings = { DIRECTORY_READ_SCHEMA: "next" }) =>
		request(caller, path, { method: "GET" }, bindings);
	const deal = { id: receipt.deal_id, name: "Example Deal" };
	const list = await get(
		"clients?scope=mine&type=franchise&pipeline=active&sort=last_deal_desc&contract=vendor-directory.v2",
	);
	assert.equal(list.status, 200, await list.clone().text());
	const { rows }: { rows: ClientRow[] } = await list.json();
	assert.equal(rows.length, 1);
	const [location] = rows;
	assert.ok(location);
	assert.equal(location.name, "Example New Location");
	assert.equal(location.ref, location.id);
	assert.equal(location.owned_by_viewer, true);
	assert.deepEqual(location.active_deals, [deal]);
	const added = await get(
		`clients/${location.id}?contract=vendor-directory.v2`,
	);
	assert.equal(added.status, 200);
	const { record: created }: { record: ClientRecord } = await added.json();
	assert.equal(created.ref, location.ref);
	assert.deepEqual(created.active_deals, [deal]);
	assert.equal(created.acquisition_source, "national_account");

	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into activity (id, kind, happened_at, summary) values
			('${filedEmail}', 'email', '2026-01-02', 'Email to demo@example.test: Lease update');
		insert into email (activity_id, sender, subject, body, imported) values
			('${filedEmail}', 'demo@example.test', 'Lease update', 'The updated lease is ready.', true);
		insert into activity_about (activity_id, deal_id, party_id) values
			('${filedEmail}', '${deal.id}', null), ('${filedEmail}', null, '${location.id}');
		commit;`);
	const activity = await request(
		caller,
		`recent-activity?query=Example+New+Location&ref=${location.id}`,
		{ method: "GET" },
		{ ACTIVITY_READ_SCHEMA: "next" },
	);
	assert.equal(activity.status, 200, await activity.clone().text());
	const recent: { catch_up: { timeline: object[] } } = await activity.json();
	assert.partialDeepStrictEqual(recent.catch_up.timeline[0], {
		deal_id: deal.id,
		email_subject: "Lease update",
		detail: "The updated lease is ready.",
	});

	const copiedList = await get(
		"clients?owner=dell&q=C-001&contract=vendor-directory.v2",
	);
	assert.equal(copiedList.status, 200);
	const { rows: matches }: { rows: ClientRow[] } = await copiedList.json();
	assert.equal(matches.length, 1);
	const [copiedRow] = matches;
	assert.ok(copiedRow);
	assert.equal(copiedRow.owner_label, "Example Corrected Owner");
	assert.equal(copiedRow.ref, "C-001");
	assert.deepEqual(copiedRow.active_deals, []);
	await t.test("drawer echoes the requested old UUID", async () => {
		const requestedId = oldClient.toUpperCase();
		const response = await get(`clients/${requestedId}`);
		assert.equal(response.status, 200, await response.clone().text());
		const { record }: { record: ClientRecord } = await response.json();
		assert.equal(record.id, requestedId);
		assert.equal(record.name, "Example Copied Client");
		assert.equal(record.owner_label, "Example Corrected Owner");
		assert.equal(record.owned_by_viewer, false);
		assert.equal(record.ref, "C-001");
	});
	await t.test("next drawer opens copied roster refs", async () => {
		const response = await get("clients/C-001");
		assert.equal(response.status, 200, await response.clone().text());
		const { record }: { record: ClientRecord } = await response.json();
		assert.equal(record.id, copiedRow.id);
		assert.equal(record.ref, "C-001");
		assert.equal(
			(await get("clients/C-001", { DIRECTORY_READ_SCHEMA: "" })).status,
			404,
		);
	});
	await t.test("national account role sets type and facet", async () => {
		const response = await get("clients?type=national_account");
		assert.equal(response.status, 200, await response.clone().text());
		const {
			rows,
			facets,
		}: {
			rows: ClientRow[];
			facets: { types: TypeFacet[] };
		} = await response.json();
		assert.equal(rows.length, 1);
		assert.partialDeepStrictEqual(rows[0], {
			id: copiedRow.id,
			recorded_client_type: "national_account",
			recorded_client_type_label: "National account",
		});
		assert.deepEqual(
			facets.types.find(({ slug }) => slug === "national_account"),
			{
				slug: "national_account",
				label: "National account",
			},
		);
	});
	await t.test("drawer includes the stored phone extension", async () => {
		const response = await get(`clients/${copiedRow.id}`);
		assert.equal(response.status, 200, await response.clone().text());
		const { record }: { record: ClientRecord } = await response.json();
		assert.equal(record.phone, "+12025550101 x45");
		assert.equal(record.cell, "+12025550102");
	});
});
