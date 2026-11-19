import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const user = { user: "example-partner" };
const partner = randomUUID();
const person = randomUUID();
const company = randomUUID();
const noLeases = randomUUID();
const nonClient = randomUUID();
const property = randomUUID();
const signedLease = randomUUID();
const leaseWithoutTerms = randomUUID();
const unrelatedLease = randomUUID();
const document = randomUUID();
const search = "parties/search?query=EXAMPLE&role=client";
const leases = (client: string) => `clients/${client}/leases`;

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into role values ('client', 'Client');
		insert into how_found values ('referral', 'Referral');
		insert into phase values ('research', 'Research');
		insert into deal_reason values ('renewal', 'Renewal');
		insert into party (id, kind, name, how_found) values
			('${partner}', 'person', 'Example Partner', null),
			('${person}', 'person', 'Example Reed', 'referral'),
			('${company}', 'company', 'Example Birch Clinic', 'referral'),
			('${noLeases}', 'person', 'Other Client', 'referral'),
			('${nonClient}', 'company', 'Example Outside Tenant', null);
		insert into party (kind, name)
			select 'company', 'Example A Nonclient ' || n from generate_series(1, 25) n;
		insert into app_user (id, slug) values ('${partner}', '${user.user}');
		insert into party_role (party_id, role)
		values ('${person}', 'client'), ('${company}', 'client'), ('${noLeases}', 'client');
		insert into property (id, address) values ('${property}', '10 Example Road');
		insert into lease (id, party_id, property_id) values
			('${signedLease}', '${person}', '${property}'),
			('${leaseWithoutTerms}', '${person}', '${property}'),
			('${unrelatedLease}', '${company}', '${property}'),
			(gen_random_uuid(), '${nonClient}', '${property}');
		insert into document (id, name, r2_key, r2_bucket, content_type)
		values ('${document}', 'Example lease', 'example-lease', 'deal_documents', 'application/pdf');
		insert into lease_version (lease_id, version, document_id, expiration_on)
		values ('${signedLease}', 1, '${document}', '2030-06-01'),
			('${signedLease}', 2, '${document}', '2031-06-01');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

test("finds person and company clients by name before applying the result limit", async () => {
	assert.deepEqual(await save(user, search, {}, "GET"), [
		200,
		{
			ok: true,
			schema_version: "party-search.v1",
			parties: [
				{ id: company, display_name: "Example Birch Clinic", kind: "company" },
				{ id: person, display_name: "Example Reed", kind: "person" },
			],
		},
	]);
});

test("lists the selected client's leases with the latest expiration and accepts their IDs on save", async () => {
	const result = await request(user, leases(person), { method: "GET" });
	assert.equal(result.status, 200);
	const choices: unknown = await result.json();
	assert.deepEqual(choices, [
		{
			lease_id: signedLease,
			address: "10 Example Road",
			expiration_on: "2031-06-01",
		},
		{
			lease_id: leaseWithoutTerms,
			address: "10 Example Road",
			expiration_on: null,
		},
	]);
	assert.deepEqual(await save(user, leases(noLeases), {}, "GET"), [200, []]);
	assert.deepEqual(await save(user, leases(nonClient), {}, "GET"), [200, []]);

	// The successor case remains valid at the save door.
	for (const lease_id of [signedLease, leaseWithoutTerms, unrelatedLease]) {
		const [status, body] = await save(user, "deals", {
			idempotency_key: randomUUID(),
			client_id: person,
			renews_lease_id: lease_id,
			name: "Example Renewal",
			owner: user.user,
			phase: "research",
			reason: "renewal",
		});
		assert.equal(status, 201, JSON.stringify(body));
	}
});

test("requires sign-in and checks lookup arguments", async () => {
	for (const path of [search, leases(person)]) {
		const response = await request(user, path, {
			method: "GET",
			headers: { Cookie: "" },
		});
		assert.equal(response.status, 401);
	}
	for (const path of [
		"parties/search?query=Example&role=vendor",
		`${search}&role=client`,
		`${leases(person)}?lease_id=${unrelatedLease}`,
	]) {
		assert.equal((await request(user, path, { method: "GET" })).status, 400);
	}
	assert.equal(
		(await request(user, leases("wrong"), { method: "GET" })).status,
		404,
	);
});
