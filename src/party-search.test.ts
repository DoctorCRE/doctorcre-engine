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

test("finds live people and companies by literal name prefix", async () => {
	assert.deepEqual(await search(" cLoVeR "), {
		ok: true,
		schema_version: "party-search.v1",
		parties: [
			{ id: company, display_name: "Clover Dental", kind: "company" },
			{ id: person, display_name: "Clover Reed", kind: "person" },
			{ id: literal, display_name: "Clover_50% Dental", kind: "company" },
		],
	});
	assert.deepEqual((await search("Clover_50%")).parties, [
		{ id: literal, display_name: "Clover_50% Dental", kind: "company" },
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
		{ id: hiddenByLimit, display_name: "Marble Zephyr", kind: "person" },
	]);
	assert.deepEqual((await search("S")).parties, [
		{ id: tied[0], display_name: "saffron bell", kind: "person" },
		{ id: tied[1], display_name: "Saffron Bell", kind: "person" },
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
