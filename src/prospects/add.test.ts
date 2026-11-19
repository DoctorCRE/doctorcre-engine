import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const joe = { user: "joe" };
const dell = { user: "dell" };
const key = () => ({ idempotency_key: randomUUID() });
const joeId = randomUUID();
const dellId = randomUUID();
const known = randomUUID();
const copied = randomUUID();
const earlierLead = randomUUID();
const client = randomUUID();
const onDeal = randomUUID();
const deal = randomUUID();
const secondDeal = randomUUID();
const clientOnDeal = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into role (slug, label) values ('lead', 'Lead'), ('client', 'Client'), ('client_contact', 'Client contact'), ('listing_agent', 'Listing agent');
		insert into stage (role, slug, label) values ('lead', 'opportunity', 'Opportunity'), ('lead', 'qualified', 'Qualified');
		insert into how_found (slug, label) values ('referral', 'Referral'), ('own_research', 'Own research'), ('not_recorded', 'Not recorded');
		insert into party (id, kind, name, how_found) values
			('${joeId}', 'person', 'Example Partner One', null),
			('${dellId}', 'person', 'Example Partner Two', null),
			('${known}', 'person', 'Example Known', null),
			('${copied}', 'person', 'Example Copied', 'not_recorded'),
			('${earlierLead}', 'company', 'Example Lead', 'referral'),
			('${client}', 'company', 'Example Client', 'referral'),
			('${clientOnDeal}', 'company', 'Example Deal Client', 'referral'),
			('${onDeal}', 'person', 'Example Contact', 'referral');
		insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell');
		insert into outside_id (source, value, party_id) values ('old_system', '${randomUUID()}', '${copied}');
		insert into party_role (party_id, role, stage, owner_user_id) values
			('${earlierLead}', 'lead', 'qualified', '${dellId}'), ('${client}', 'client', null, null),
			('${clientOnDeal}', 'client', null, null);
		insert into deal (id, name, owner_user_id) values
			('${deal}', 'Example Deal', '${joeId}'), ('${secondDeal}', 'Example Second Deal', '${joeId}');
		insert into deal_party (deal_id, party_id, role) values
			('${deal}', '${onDeal}', 'client_contact'), ('${deal}', '${onDeal}', 'listing_agent'),
			('${secondDeal}', '${onDeal}', 'client_contact'), ('${deal}', '${clientOnDeal}', 'client');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

const pick = (party_id: string, fields = {}) =>
	save(joe, "prospects", { ...key(), party_id, ...fields });

async function readProspect(id: unknown) {
	const [status, prospect] = await save(joe, `prospects/${id}`, {}, "GET");
	assert.equal(status, 200);
	return prospect;
}

test("a quick add stores the new party, unclaimed Opportunity and note and replays them", async () => {
	const args = {
		...key(),
		name: " Example New Practice ",
		kind: "company",
		how_found: "referral",
		note: "Quick note",
	};
	const [status, answer] = await save(joe, "prospects", args);
	assert.equal(status, 201, JSON.stringify(answer));
	assert.equal(answer.existing, false);
	assert.ok(typeof answer.change_id === "number" && answer.change_id > 0);
	assert.deepEqual(await save(joe, "prospects", args), [
		201,
		{ ...answer, replayed: true },
	]);
	assert.equal(
		(await save(joe, "prospects", { ...args, note: "Different" }))[0],
		409,
	);
	assert.partialDeepStrictEqual(await readProspect(answer.party_id), {
		name: "Example New Practice",
		kind: "company",
		how_found: "referral",
		owner: null,
		notes: [
			{ activity_id: answer.activity_id, summary: "Quick note", by: "joe" },
		],
	});
});

for (const [label, partyId, how_found] of [
	["known party", known, "own_research"],
	["copied party with no recorded source", copied, "referral"],
] as const) {
	test(`two partners selecting a ${label} get one lead and both notes`, async () => {
		const [missing, refusal] = await pick(partyId);
		assert.equal(missing, 400);
		assert.partialDeepStrictEqual(refusal, {
			error: "missing_required",
			fields: ["how_found"],
		});
		const args = { party_id: partyId, how_found, note: "Example note" };
		const results = await Promise.all(
			[joe, dell].map((caller) =>
				save(caller, "prospects", { ...key(), ...args }),
			),
		);
		assert.deepEqual(
			results.map(([status, answer]) => [status, answer.party_id]),
			[
				[201, partyId],
				[201, partyId],
			],
		);
		assert.deepEqual(results.map(([, answer]) => answer.existing).sort(), [
			false,
			true,
		]);
		const prospect = await readProspect(partyId);
		assert.partialDeepStrictEqual(prospect, { how_found, owner: null });
		assert.ok(Array.isArray(prospect.notes));
		assert.equal(prospect.notes.length, 2);
		assert.ok(prospect.notes.every(isArguments));
		assert.deepEqual(prospect.notes.map(({ by }) => by).sort(), [
			"dell",
			"joe",
		]);
	});
}

test("an existing lead keeps its owner and a client is sent to Add deal", async () => {
	const [status, lead] = await pick(earlierLead, { how_found: "own_research" });
	assert.equal(status, 201);
	assert.partialDeepStrictEqual(lead, {
		party_id: earlierLead,
		activity_id: null,
		existing: false,
	});
	assert.partialDeepStrictEqual(await readProspect(earlierLead), {
		how_found: "referral",
		owner: "dell",
	});

	const [clientStatus, answer] = await pick(client, { note: "Example note" });
	assert.equal(clientStatus, 409);
	assert.equal(answer.error, "already_client");
	assert.equal(answer.party_id, client);
});

test("a party on a deal offers each deal without saving a lead or a note", async () => {
	for (const [partyId, dealIds] of [
		[onDeal, [deal, secondDeal].sort()],
		[clientOnDeal, [deal]],
	] as const) {
		const [status, answer] = await pick(partyId, { note: "Unsaved note" });
		assert.equal(status, 409);
		assert.partialDeepStrictEqual(answer, {
			error: "not_a_prospect",
			party_id: partyId,
			deal_ids: dealIds,
		});
		const { rows } = await db.query(
			`
			select exists (select from party_role where party_id = $1 and role = 'lead') as lead,
				exists (select from activity_about where party_id = $1) as note
		`,
			[partyId],
		);
		assert.deepEqual(rows, [{ lead: false, note: false }]);
	}
});

test("quick add refuses incomplete new parties and the old-system stand-in", async () => {
	const args = { ...key(), name: "Example Incomplete Party", kind: "person" };
	for (const invalid of [
		{ ...args, name: "", how_found: "referral" },
		args,
		{ ...args, how_found: "not_recorded" },
		{ ...args, how_found: "referral", kind: "property" },
	]) {
		assert.equal((await save(joe, "prospects", invalid))[0], 400);
	}
	const [status, error] = await save(joe, "prospects", {
		...args,
		how_found: "unknown_source",
		note: "Example note",
	});
	assert.equal(status, 422);
	assert.equal(error.rule, "party_how_found_fkey");
	assert.equal(
		(await db.query("select from party where name = $1", [args.name])).rowCount,
		0,
	);
	assert.equal(
		(
			await save({ job: "agent", for_user: "joe" }, "prospects", {
				...args,
				how_found: "referral",
			})
		)[0],
		404,
	);
});
