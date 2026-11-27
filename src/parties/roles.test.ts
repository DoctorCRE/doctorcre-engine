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
const lender = randomUUID();
const dealClient = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into role (slug, label, category_of) values ('client', 'Client', null), ('vendor', 'Vendor', null),
			('lender', 'Lender', 'vendor'), ('contractor', 'Contractor', 'vendor');
		insert into stage (role, slug, label) values ('vendor', 'prospect', 'Prospect'), ('vendor', 'working', 'Working');
		insert into how_found (slug, label) values ('referral', 'Referral'), ('not_recorded', 'Not recorded');
		insert into client_type (slug, label) values ('independent', 'Independent'), ('dso', 'DSO');
		insert into party (id, kind, name, how_found) values
			('${joeId}', 'person', 'Example Partner One', null), ('${dellId}', 'person', 'Example Partner Two', null),
			('${practice}', 'company', 'Example Smile Studio', 'referral'),
			('${unrecorded}', 'person', 'Example Doctor', 'not_recorded'),
			('${lender}', 'company', 'Example Community Bank', null),
			('${dealClient}', 'company', 'Example Deal Client', 'referral');
		insert into party_role (party_id, role) values ('${dealClient}', 'client');
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
		vendor: null,
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
	const [notRecorded, notRecordedRefusal] = await add({
		how_found: "not_recorded",
	});
	assert.equal(notRecorded, 400);
	assert.deepEqual(notRecordedRefusal.fields, ["how_found"]);
	const [unknown, named] = await add({
		how_found: "referral",
		client_type: "spa",
	});
	assert.equal(unknown, 400);
	assert.deepEqual(named.fields, ["client_type"]);
	const [subtypeOnly, subtypeRefusal] = await add({
		how_found: "referral",
		client_type: "spa",
		subtype: "Ortho",
	});
	assert.equal(subtypeOnly, 400);
	assert.deepEqual(subtypeRefusal.fields, ["subtype"]);
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
	const [unsaid, unsaidRefusal] = await edit({
		how_found: { from: "referral", to: "not_recorded" },
	});
	assert.equal(unsaid, 400);
	assert.deepEqual(unsaidRefusal.fields, ["how_found"]);

	const practiceType = async (fields: object) => {
		const [code, client] = await edit(fields);
		assert.equal(code, 200, JSON.stringify(client));
		return [client.vertical, client.subtype];
	};
	assert.deepEqual(
		await practiceType({ subtype: { from: null, to: "Pediatric" } }),
		["Dental", "Pediatric"],
	);
	const written = () =>
		db.query("select xmin::text from client_vertical where party_id = $1", [
			practice,
		]);
	const before = (await written()).rows;
	assert.deepEqual(
		await practiceType({ vertical: { from: "Dental", to: " Dental " } }),
		["Dental", "Pediatric"],
	);
	assert.deepEqual((await written()).rows, before);
	assert.deepEqual(
		await practiceType({ vertical: { from: "Dental", to: "Orthodontics" } }),
		["Orthodontics", null],
	);
	assert.deepEqual(
		await practiceType({ subtype: { from: null, to: "Adult" } }),
		["Orthodontics", "Adult"],
	);
	assert.deepEqual(
		await practiceType({ vertical: { from: "Orthodontics", to: null } }),
		[null, null],
	);
	const [cleared, clearedRefusal] = await edit({
		status: { from: "paused", to: null },
		how_found: { from: "referral", to: "referral" },
	});
	assert.equal(cleared, 400);
	assert.deepEqual(clearedRefusal.fields, ["status"]);
	const [staleCleared, staleClearedRefusal] = await edit({
		how_found: { from: "not what was saved", to: null },
	});
	assert.equal(staleCleared, 400);
	assert.deepEqual(staleClearedRefusal.fields, ["how_found"]);
	assert.equal((await edit({}))[0], 400);
});

test("a vendor is added with its categories, stage, level and relationship partner", async () => {
	const args = {
		...key(),
		party_id: lender,
		categories: ["lender"],
		stage: "prospect",
		relationship_level: 0,
		offers: "SBA loans",
	};
	const [status, vendor] = await save(dell, "vendors", args);
	assert.equal(status, 201, JSON.stringify(vendor));
	assert.deepEqual(vendor, {
		party_id: lender,
		stage: "prospect",
		relationship_level: 0,
		owner: "dell",
		offers: "SBA loans",
		seeking: null,
		is_target: false,
		disposition: null,
		disposition_reason: null,
		categories: ["lender"],
	});
	const [again, already] = await save(dell, "vendors", {
		...key(),
		party_id: lender,
	});
	assert.equal(again, 409);
	assert.partialDeepStrictEqual(already, {
		error: "already_vendor",
		party_id: lender,
	});
	const [unknown, refusal] = await save(joe, "vendors", {
		...key(),
		party_id: practice,
		categories: ["florist"],
		stage: "unknown",
	});
	assert.equal(unknown, 400);
	assert.deepEqual([...(refusal.fields as string[])].sort(), [
		"categories",
		"stage",
	]);
});

test("a vendor edit moves its stage, categories and ruling, and the database keeps a ruling's reason", async () => {
	const edit = (fields: object, caller = joe) =>
		save(caller, `vendors/${lender}`, { ...key(), ...fields });
	const [status, edited] = await edit({
		stage: { from: "prospect", to: "working" },
		relationship_level: { from: 0, to: 1 },
		owner: { from: "dell", to: "joe" },
		categories: { from: ["lender"], to: ["contractor", "lender"] },
		is_target: { from: false, to: true },
	});
	assert.equal(status, 200, JSON.stringify(edited));
	assert.partialDeepStrictEqual(edited, {
		stage: "working",
		relationship_level: 1,
		owner: "joe",
		is_target: true,
		categories: ["contractor", "lender"],
	});
	const [cleared, untargeted] = await edit({
		is_target: { from: true, to: false },
	});
	assert.equal(cleared, 200, JSON.stringify(untargeted));
	assert.equal(untargeted.is_target, false);
	const [noReason, refusal] = await edit({
		disposition: { from: null, to: "parked" },
	});
	assert.equal(noReason, 422);
	assert.equal(refusal.rule, "party_role_ruling_has_a_reason");
	const [ruled, answer] = await edit({
		disposition: { from: null, to: "parked" },
		disposition_reason: { from: null, to: "Example reason" },
		categories: { from: ["lender", "contractor"], to: [] },
	});
	assert.equal(ruled, 200, JSON.stringify(answer));
	assert.partialDeepStrictEqual(answer, {
		disposition: "parked",
		disposition_reason: "Example reason",
		categories: [],
	});
	const [stale] = await edit(
		{ stage: { from: "prospect", to: "working" } },
		dell,
	);
	assert.equal(stale, 409);
	assert.equal(
		(
			await save(joe, `vendors/${practice}`, {
				...key(),
				stage: { from: null, to: "working" },
			})
		)[0],
		404,
	);
});

test("a client role a deal opened gets its profile", async () => {
	const [status, client] = await save(joe, "clients", {
		...key(),
		party_id: dealClient,
	});
	assert.equal(status, 201, JSON.stringify(client));
	assert.partialDeepStrictEqual(client, { status: "roster", owner: "joe" });
});

test("clearing practice type and subtype together saves", async () => {
	const party = randomUUID();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into party (id, kind, name, how_found) values ('${party}', 'company', 'Example Two', 'referral');
		commit;`);
	const [status, client] = await save(joe, "clients", {
		...key(),
		party_id: party,
		vertical: "Dental",
		subtype: "Pediatric",
	});
	assert.equal(status, 201, JSON.stringify(client));
	const [cleared, answer] = await save(joe, `clients/${party}`, {
		...key(),
		vertical: { from: "Dental", to: null },
		subtype: { from: "Pediatric", to: null },
	});
	assert.equal(cleared, 200, JSON.stringify(answer));
	assert.partialDeepStrictEqual(answer, { vertical: null, subtype: null });
});
