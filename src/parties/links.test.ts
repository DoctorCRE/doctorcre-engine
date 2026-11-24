import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const joe = { user: "joe" };
const key = () => ({ idempotency_key: randomUUID() });
const joeId = randomUUID();
const avery = randomUUID();
const blake = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into party (id, kind, name) values
			('${joeId}', 'person', 'Example Partner One'), ('${avery}', 'person', 'Avery Example'),
			('${blake}', 'company', 'Blake Example Lending');
		insert into app_user (id, slug) values ('${joeId}', 'joe');
		commit;`);
});
after(cleanup);

const link = (fields: object) =>
	save(joe, "party-links", { ...key(), ...fields });

test("a knows link is stored once whichever party it names first", async () => {
	const args = {
		...key(),
		kind: "knows",
		party_id: avery,
		other_party_id: blake,
		started_on: "2026-01-05",
		note: " Met at a study club ",
	};
	const [status, added] = await save(joe, "party-links", args);
	assert.equal(status, 201, JSON.stringify(added));
	assert.deepEqual(added, {
		link_id: added.link_id,
		kind: "knows",
		party_id: avery,
		other_party_id: blake,
		started_on: "2026-01-05",
		ended_on: null,
		note: "Met at a study club",
	});
	assert.deepEqual(await save(joe, "party-links", args), [
		201,
		{ ...added, replayed: true },
	]);
	const [again, refusal] = await link({
		kind: "knows",
		party_id: blake,
		other_party_id: avery,
	});
	assert.equal(again, 409);
	assert.deepEqual(
		{ error: refusal.error, link_id: refusal.link_id },
		{ error: "already_linked", link_id: added.link_id },
	);
	const [offered] = await link({
		kind: "can_introduce",
		party_id: blake,
		other_party_id: avery,
	});
	assert.equal(offered, 201);
});

test("a link names two known, different parties and a kept kind", async () => {
	for (const [fields, status] of [
		[{ kind: "knows", party_id: avery, other_party_id: avery }, 400],
		[
			{ kind: "knows", party_id: avery, other_party_id: avery.toUpperCase() },
			400,
		],
		[{ kind: "knows", party_id: avery, other_party_id: randomUUID() }, 404],
		[{ kind: "works_with", party_id: avery, other_party_id: blake }, 400],
	] as const)
		assert.equal((await link(fields))[0], status, JSON.stringify(fields));
});

test("a link's dates and note change from what the partner saw, and an ended link makes room for a new one", async () => {
	const [, added] = await link({
		kind: "can_introduce",
		party_id: avery,
		other_party_id: blake,
	});
	const edit = (fields: object) =>
		save(joe, `party-links/${added.link_id}`, { ...key(), ...fields });
	const [status, ended] = await edit({
		ended_on: { from: null, to: "2026-02-01" },
		note: { from: null, to: "Moved away" },
	});
	assert.equal(status, 200, JSON.stringify(ended));
	assert.partialDeepStrictEqual(ended, {
		ended_on: "2026-02-01",
		note: "Moved away",
	});
	const [stale, conflict] = await edit({ note: { from: null, to: "Other" } });
	assert.equal(stale, 409);
	assert.partialDeepStrictEqual(conflict, { fields: ["note"] });
	const [backwards, refusal] = await edit({
		started_on: { from: null, to: "2026-03-01" },
	});
	assert.equal(backwards, 422);
	assert.equal(refusal.rule, "party_link_ends_after_it_starts");
	assert.equal(
		(await edit({ started_on: { from: null, to: "2026-01-05" } }))[0],
		200,
	);
	const [cleared, clearedLink] = await edit({
		started_on: { from: "2026-01-05", to: null },
		note: { from: "Moved away", to: null },
	});
	assert.equal(cleared, 200, JSON.stringify(clearedLink));
	assert.partialDeepStrictEqual(clearedLink, {
		started_on: null,
		ended_on: "2026-02-01",
		note: null,
	});
	const [renewed] = await link({
		kind: "can_introduce",
		party_id: avery,
		other_party_id: blake,
		started_on: "2026-03-01",
	});
	assert.equal(renewed, 201);
	const missing = await save(joe, `party-links/${randomUUID()}`, {
		...key(),
		note: { from: null, to: "Example" },
	});
	assert.equal(missing[0], 404);
});

test("a pair links again after an undated link ends, and an ended link reopens only while no other is current", async () => {
	const [, first] = await link({
		kind: "knows",
		party_id: joeId.toUpperCase(),
		other_party_id: blake.toUpperCase(),
	});
	assert.partialDeepStrictEqual(first, {
		party_id: joeId,
		other_party_id: blake,
	});
	const [ended] = await save(joe, `party-links/${first.link_id}`, {
		...key(),
		ended_on: { from: null, to: "2026-02-01" },
	});
	assert.equal(ended, 200);
	const [relinked, second] = await link({
		kind: "knows",
		party_id: blake,
		other_party_id: joeId,
	});
	assert.equal(relinked, 201, JSON.stringify(second));
	const [reopened, refusal] = await save(joe, `party-links/${first.link_id}`, {
		...key(),
		ended_on: { from: "2026-02-01", to: null },
	});
	assert.equal(reopened, 409);
	assert.deepEqual(
		{ error: refusal.error, link_id: refusal.link_id },
		{ error: "already_linked", link_id: second.link_id },
	);
});
