import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const joe = { user: "joe" };
const dell = { user: "dell" };
const key = () => ({ idempotency_key: randomUUID() });
const joeId = randomUUID();
const dellId = randomUUID();
const practice = randomUUID();
const unrecorded = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into role (slug, label) values ('client', 'Client');
		insert into how_found (slug, label) values ('referral', 'Referral'), ('not_recorded', 'Not recorded');
		insert into client_type (slug, label) values ('independent', 'Independent'), ('dso', 'DSO');
		insert into party (id, kind, name, how_found) values
			('${joeId}', 'person', 'Example Partner One', null), ('${dellId}', 'person', 'Example Partner Two', null),
			('${practice}', 'company', 'Example Smile Studio', 'referral'),
			('${unrecorded}', 'person', 'Example Doctor', 'not_recorded');
		insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell');
		insert into outside_id (source, value, party_id) values ('old_system', '${randomUUID()}', '${unrecorded}');
		commit;`);
});
after(cleanup);

test("a client is added over a record with its status, type, practice type and owner", async () => {
	const args = {
		...key(),
		party_id: practice,
		status: "engaged",
		client_type: "independent",
		vertical: " Dental ",
		subtype: "Pediatric",
	};
	const [status, client] = await save(joe, "clients", args);
	assert.equal(status, 201, JSON.stringify(client));
	assert.deepEqual(client, {
		party_id: practice,
		status: "engaged",
		client_type: "independent",
		how_found: "referral",
		vertical: "Dental",
		subtype: "Pediatric",
		owner: "joe",
	});
	assert.deepEqual(await save(joe, "clients", args), [
		201,
		{ ...client, replayed: true },
	]);
	const [read, record] = await save(joe, `parties/${practice}`, {}, "GET");
	assert.equal(read, 200);
	assert.partialDeepStrictEqual(record, {
		name: "Example Smile Studio",
		client,
	});
	const [again, refusal] = await save(dell, "clients", {
		...key(),
		party_id: practice,
	});
	assert.equal(again, 409);
	assert.equal(refusal.error, "already_client");
});

test("a client needs how they were found when the record has none, and known choices", async () => {
	const add = (fields: object) =>
		save(joe, "clients", { ...key(), party_id: unrecorded, ...fields });
	const [missing, refusal] = await add({});
	assert.equal(missing, 400);
	assert.deepEqual(refusal.fields, ["how_found"]);
	const [unknown, named] = await add({
		how_found: "referral",
		client_type: "spa",
	});
	assert.equal(unknown, 400);
	assert.deepEqual(named.fields, ["client_type"]);
	assert.equal(
		(await add({ how_found: "referral", subtype: "Ortho" }))[0],
		400,
	);
	assert.equal(
		(await add({ how_found: "referral", status: "active_deal" }))[0],
		400,
	);
	const [added, client] = await add({ how_found: "referral" });
	assert.equal(added, 201);
	assert.partialDeepStrictEqual(client, {
		status: "roster",
		how_found: "referral",
	});
	assert.equal(
		(await save(joe, "clients", { ...key(), party_id: randomUUID() }))[0],
		404,
	);
});

test("a client edit changes what the partner saw and refuses what changed since", async () => {
	const edit = (fields: object, caller = joe) =>
		save(caller, `clients/${practice}`, { ...key(), ...fields });
	const [status, edited] = await edit({
		status: { from: "engaged", to: "paused" },
		client_type: { from: "independent", to: "dso" },
		subtype: { from: "Pediatric", to: null },
	});
	assert.equal(status, 200, JSON.stringify(edited));
	assert.partialDeepStrictEqual(edited, {
		status: "paused",
		client_type: "dso",
		vertical: "Dental",
		subtype: null,
	});
	const [stale, conflict] = await edit(
		{ status: { from: "engaged", to: "cold" } },
		dell,
	);
	assert.equal(stale, 409);
	assert.partialDeepStrictEqual(conflict, {
		error: "version_conflict",
		fields: ["status"],
		current: { status: "paused" },
	});
	const [cleared, answer] = await edit({
		vertical: { from: "Dental", to: null },
	});
	assert.equal(cleared, 200);
	assert.equal(answer.vertical, null);
	assert.equal((await edit({ status: { from: "paused", to: null } }))[0], 400);
	assert.equal((await edit({}))[0], 400);
});
