import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";
import worker from "./worker.ts";

const { db, setup, cleanup, request } = doorTest();
const user = { user: "example-partner" };
const partner = randomUUID();
const person = randomUUID();
const company = randomUUID();
const duplicate = randomUUID();
const hiddenByLimit = randomUUID();
const literal = randomUUID();
const tied = [randomUUID(), randomUUID()].sort();
const path = "parties/search";

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${partner}', 'person', 'Example Partner'),
			('${person}', 'person', 'Clover Reed'),
			('${company}', 'company', 'Clover Dental'),
			('${duplicate}', 'person', 'Clover Duplicate'),
			('${hiddenByLimit}', 'person', 'Marble Zephyr'),
			('${literal}', 'company', 'Clover_50% Dental'),
			('${tied[1]}', 'person', 'Saffron Bell'),
			('${tied[0]}', 'person', 'saffron bell');
		insert into app_user (id, slug) values ('${partner}', '${user.user}');
		update party set city = 'Example City' where id = '${person}';
		insert into role (slug, label) values ('listing_agent', 'Listing agent'),
			('support', 'Support'), ('national_account', 'National account');
		insert into party_role (party_id, role) values ('${company}', 'national_account');
		insert into national_account (party_id) values ('${company}');
		with deals as (
			insert into deal (name, owner_user_id) values ('Example First Deal', '${partner}'),
				('Example Second Deal', '${partner}') returning id, name
		)
		insert into deal_party (deal_id, party_id, role)
		select id, '${person}'::uuid, 'listing_agent' from deals union all
		select id, '${person}'::uuid, 'support' from deals where name = 'Example First Deal';
		insert into do_not_contact (party_id, reason) values ('${person}', 'Example restriction');
		select merge_party('${duplicate}', '${person}');
		insert into party (kind, name)
			select 'company', 'Marble Dental ' || n from generate_series(1, 25) n;
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function search(query: string, kind?: string) {
	const params = new URLSearchParams({ query, ...(kind && { kind }) });
	const response = await request(user, `${path}?${params}`, { method: "GET" });
	assert.equal(response.status, 200);
	const result: unknown = await response.json();
	assert.ok(isArguments(result) && Array.isArray(result.parties));
	const parties: unknown[] = result.parties;
	return { ...result, parties };
}

const noPickerFacts = { city: null, deal_count: 0, is_national_account: false };

test("finds live people and companies by literal name prefix", async () => {
	assert.deepEqual(await search(" cLoVeR "), {
		ok: true,
		schema_version: "party-search.v1",
		parties: [
			{
				id: company,
				display_name: "Clover Dental",
				kind: "company",
				...noPickerFacts,
				is_national_account: true,
			},
			{
				id: person,
				display_name: "Clover Reed",
				kind: "person",
				...noPickerFacts,
				city: "Example City",
				deal_count: 2,
			},
			{
				id: literal,
				display_name: "Clover_50% Dental",
				kind: "company",
				...noPickerFacts,
			},
		],
	});
	assert.deepEqual((await search("Clover_50%")).parties, [
		{
			id: literal,
			display_name: "Clover_50% Dental",
			kind: "company",
			...noPickerFacts,
		},
	]);
	assert.deepEqual((await search("Clover_5%")).parties, []);
	assert.deepEqual((await search("Clover%")).parties, []);
	assert.deepEqual((await search("Reed")).parties, []);
});

test("limits the first page after applying the requested kind", async () => {
	const mixed = (await search("Marble")).parties;
	assert.equal(mixed.length, 25);
	assert.deepEqual(mixed, (await search("Marble", "company")).parties);
	assert.deepEqual((await search("Marble", "person")).parties, [
		{
			id: hiddenByLimit,
			display_name: "Marble Zephyr",
			kind: "person",
			...noPickerFacts,
		},
	]);
	assert.deepEqual((await search("S")).parties, [
		{
			id: tied[0],
			display_name: "saffron bell",
			kind: "person",
			...noPickerFacts,
		},
		{
			id: tied[1],
			display_name: "Saffron Bell",
			kind: "person",
			...noPickerFacts,
		},
	]);
});

test("requires sign-in and refuses malformed search parameters", async () => {
	assert.equal(
		(await worker.request(`/api/engine/${path}?query=Clover`)).status,
		401,
	);
	for (const params of [
		"",
		"?query=",
		"?query=%20",
		"?query=a%00b",
		`?query=${"a".repeat(101)}`,
		"?query=Clover&query=Marble",
		"?query=Clover&kind=org",
		"?query=Clover&kind=person&kind=company",
	]) {
		assert.equal(
			(await request(user, path + params, { method: "GET" })).status,
			400,
			params,
		);
	}
});
