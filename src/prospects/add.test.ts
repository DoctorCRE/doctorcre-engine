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
const known = randomUUID();
const earlierLead = randomUUID();
const client = randomUUID();
const onDeal = randomUUID();
const deal = randomUUID();

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into role (slug, label) values ('lead', 'Lead'), ('client', 'Client'), ('client_contact', 'Client contact');
		insert into stage (role, slug, label) values ('lead', 'opportunity', 'Opportunity'), ('lead', 'qualified', 'Qualified');
		insert into how_found (slug, label) values ('referral', 'Referral'), ('own_research', 'Own research');
		insert into party (id, kind, name, how_found) values
			('${joeId}', 'person', 'Example Partner One', null),
			('${dellId}', 'person', 'Example Partner Two', null),
			('${known}', 'person', 'Example Known', null),
			('${earlierLead}', 'company', 'Example Lead', 'referral'),
			('${client}', 'company', 'Example Client', 'referral'),
			('${onDeal}', 'person', 'Example Contact', 'referral');
		insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell');
		insert into party_role (party_id, role, stage, owner_user_id) values
			('${earlierLead}', 'lead', 'qualified', '${dellId}'), ('${client}', 'client', null, null);
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Deal', '${joeId}');
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${onDeal}', 'client_contact');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function savedProspect(id: unknown) {
	const { rows } = await db.query({
		text: `select p.name, p.kind, p.how_found, r.stage, r.owner_user_id
			from party p join party_role r on r.party_id = p.id and r.role = 'lead'
			where p.id = $1`,
		values: [id],
	});
	assert.equal(rows.length, 1);
	return rows[0];
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
	assert.deepEqual(await savedProspect(answer.party_id), {
		name: "Example New Practice",
		kind: "company",
		how_found: "referral",
		stage: "opportunity",
		owner_user_id: null,
	});
	const { rows } = await db.query({
		text: `select a.id, a.summary, a.changed_by_user_id from activity_about l
			join activity a on a.id = l.activity_id where l.party_id = $1 and a.kind = 'note'`,
		values: [answer.party_id],
	});
	assert.deepEqual(rows, [
		{
			id: answer.activity_id,
			summary: "Quick note",
			changed_by_user_id: joeId,
		},
	]);
});

test("two partners selecting the same known party get one lead and both notes", async () => {
	const missing = await save(joe, "prospects", { ...key(), party_id: known });
	assert.equal(missing[0], 400);
	assert.equal(missing[1].error, "missing_required");
	assert.deepEqual(missing[1].fields, ["how_found"]);
	const results = await Promise.all(
		[joe, dell].map((caller) =>
			save(caller, "prospects", {
				...key(),
				party_id: known,
				how_found: "own_research",
				note: "Example note",
			}),
		),
	);
	assert.deepEqual(
		results.map(([status, answer]) => [status, answer.party_id]),
		[
			[201, known],
			[201, known],
		],
	);
	assert.deepEqual(results.map(([, answer]) => answer.existing).sort(), [
		false,
		true,
	]);
	const { rows } = await db.query({
		text: `select a.changed_by_user_id from activity a join activity_about l on l.activity_id = a.id where l.party_id = $1`,
		values: [known],
	});
	assert.deepEqual(
		rows.map((row) => row.changed_by_user_id).sort(),
		[joeId, dellId].sort(),
	);
	assert.deepEqual(await savedProspect(known), {
		name: "Example Known",
		kind: "person",
		how_found: "own_research",
		stage: "opportunity",
		owner_user_id: null,
	});
});

test("an existing lead keeps its owner and a client is sent to Add deal", async () => {
	const [status, lead] = await save(joe, "prospects", {
		...key(),
		party_id: earlierLead,
		how_found: "own_research",
	});
	assert.equal(status, 201);
	assert.equal(lead.party_id, earlierLead);
	assert.equal(lead.activity_id, null);
	assert.equal(lead.existing, false);
	assert.deepEqual(await savedProspect(earlierLead), {
		name: "Example Lead",
		kind: "company",
		how_found: "referral",
		stage: "opportunity",
		owner_user_id: dellId,
	});

	const [clientStatus, answer] = await save(joe, "prospects", {
		...key(),
		party_id: client,
		note: "Example note",
	});
	assert.equal(clientStatus, 409);
	assert.equal(answer.error, "already_client");
	assert.equal(answer.party_id, client);
});

test("a party already on a deal cannot enter the lane", async () => {
	const [status, answer] = await save(joe, "prospects", {
		...key(),
		party_id: onDeal,
	});
	assert.equal(status, 409);
	assert.equal(answer.error, "not_a_prospect");
	assert.equal(
		(await db.query("select from party_role where party_id = $1", [onDeal]))
			.rowCount,
		0,
	);
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
