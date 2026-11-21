import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request } = doorTest();
const joe = randomUUID();
const dell = randomUUID();
const claim = randomUUID();
const stage = randomUUID();
const outreach = randomUUID();
const nurture = randomUUID();
const archived = randomUUID();
const link = randomUUID();
const client = randomUUID();
const unrelatedClient = randomUUID();
const legacy = randomUUID();
const switched = { LEADS_READ_SCHEMA: "next" };

before(async () => {
	await setup();
	await db.query(`begin;
		set local engine.job = 'old_system';
		insert into how_found values ('referral', 'Referral');
		insert into role (slug, label) values ('lead', 'Lead'), ('client', 'Client');
		insert into stage values ('lead', 'new', 'New'), ('lead', 'qualified', 'Qualified'),
			('lead', 'opportunity', 'Opportunity'), ('lead', 'nurture', 'Nurture'),
			('lead', 'archived', 'Archived'), ('lead', 'outreach_active', 'Outreach');
		insert into party (id, kind, name, how_found) values
			('${joe}', 'person', 'Example Partner A', null),
			('${dell}', 'person', 'Example Partner B', null),
			('${claim}', 'person', 'Example Claim', 'referral'),
			('${stage}', 'person', 'Example Stage', 'referral'),
			('${outreach}', 'person', 'Example Outreach', 'referral'),
			('${nurture}', 'person', 'Example Nurture', 'referral'),
			('${archived}', 'person', 'Example Archived', 'referral'),
			('${link}', 'company', 'Example Practice', 'referral'),
			('${client}', 'company', 'EXAMPLE PRACTICE', 'referral'),
			('${unrelatedClient}', 'company', 'Example Other Practice', 'referral');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into party_role (party_id, role, stage) values
			('${claim}', 'lead', 'new'), ('${stage}', 'lead', 'qualified'),
			('${outreach}', 'lead', 'outreach_active'), ('${nurture}', 'lead', 'nurture'),
			('${archived}', 'lead', 'new'),
			('${link}', 'lead', 'opportunity'), ('${client}', 'client', null),
			('${unrelatedClient}', 'client', null);
		insert into client (party_id) values ('${client}'), ('${unrelatedClient}');
		insert into outside_id (source, value, party_id) values ('old_system_lead', '${legacy}', '${claim}');
		commit;`);
});
after(cleanup);

async function read(path: string) {
	const response = await request(
		{ user: "joe" },
		path,
		{ method: "GET" },
		switched,
	);
	assert.equal(response.status, 200);
	return record(await response.json());
}

async function board(id: string) {
	const detail = record(
		(await read(`leads?workspace=leads&lead_id=${id}`)).detail,
	);
	assert.ok(Array.isArray(detail.stage_history));
	return { detail, lastStage: record(detail.stage_history[0] ?? {}) };
}

async function visibleOnLeads(id: string) {
	const { leads } = await read("leads?workspace=leads");
	assert.ok(Array.isArray(leads));
	return leads
		.map(record)
		.some((lead) => lead.id === id && !lead.client_id && !lead.linked_client);
}

function record(value: unknown) {
	assert.ok(isArguments(value));
	return value;
}

async function save(
	id: string,
	body: object,
	user = "joe",
	bindings: object = switched,
) {
	const response = await request(
		{ user },
		`leads/${id}/changes`,
		{
			method: "POST",
			body: JSON.stringify(body),
		},
		bindings,
	);
	const { ok, error, replayed } = record(await response.json());
	return { status: response.status, ok, error, replayed };
}

function command(base_version: unknown, action: string) {
	return {
		idempotency_key: randomUUID(),
		base_version,
		action,
		expected_actor: "joe",
	};
}

test("a copied New lead can be claimed once by the signed-in partner", async () => {
	const beforeClaim = (await board(legacy)).detail;
	const body = command(beforeClaim.base_version, "claim");
	assert.equal((await save(legacy, body, "joe", {})).status, 404);
	assert.equal((await save(legacy, body, "dell")).error, "account_changed");
	assert.equal((await save(legacy, body)).ok, true);
	assert.equal((await save(legacy, body)).replayed, true);
	const claimed = (await board(legacy)).detail;
	assert.equal(claimed.owner, "joe");
	assert.equal(
		(await save(legacy, { ...body, idempotency_key: randomUUID() })).error,
		"version_conflict",
	);
	assert.equal(
		(await save(legacy, command(claimed.base_version, "claim"))).error,
		"lead_not_claimable",
	);
});

test("a lead moved to a company is listed, opens, and can be claimed", async () => {
	const person = randomUUID();
	const company = randomUUID();
	const copiedId = randomUUID();
	await db.query(`begin;
		set local engine.job = 'agent';
		insert into party (id, kind, name) values
			('${person}', 'person', 'Example Placeholder'), ('${company}', 'company', 'Example Company');
		insert into party_role (party_id, role, stage) values ('${person}', 'lead', 'new');
		insert into outside_id (source, value, party_id) values ('old_system_lead', '${copiedId}', '${person}');
		update party_role set party_id = '${company}' where party_id = '${person}' and role = 'lead';
		update outside_id set party_id = '${company}' where party_id = '${person}' and source = 'old_system_lead';
		commit;`);

	const { leads } = await read("leads?workspace=leads");
	assert.ok(Array.isArray(leads));
	const lead = leads.map(record).find((row) => row.id === copiedId);
	const version = lead?.base_version;
	assert.ok(
		typeof version === "number" && Number.isSafeInteger(version) && version > 0,
	);
	assert.equal((await board(copiedId)).detail.base_version, version);
	assert.equal((await save(copiedId, command(version, "claim"))).ok, true);
	assert.equal((await board(copiedId)).detail.owner, "joe");
	assert.equal(
		(await save(copiedId, command(version, "claim"))).error,
		"version_conflict",
	);
});

test("unowned active leads can be claimed at any stage, but archived leads cannot", async () => {
	for (const id of [outreach, nurture]) {
		const before = (await board(id)).detail;
		assert.equal(
			(await save(id, command(before.base_version, "claim"))).ok,
			true,
		);
		const claimed = (await board(id)).detail;
		assert.equal(claimed.owner, "joe");
		assert.equal(
			(await save(id, command(claimed.base_version, "claim"))).error,
			"lead_not_claimable",
		);
	}
	const initial = (await board(archived)).detail;
	assert.equal(
		(
			await save(archived, {
				...command(initial.base_version, "stage"),
				stage: "archived",
				reason: "Example ended",
			})
		).ok,
		true,
	);
	const before = (await board(archived)).detail;
	assert.equal(
		(await save(archived, command(before.base_version, "claim"))).error,
		"lead_not_claimable",
	);
});

test("ordinary stage changes and an archive appear in the drawer history", async () => {
	const { detail } = await board(stage);
	const move = {
		...command(detail.base_version, "stage"),
		stage: "nurture_drip",
	};
	assert.equal((await save(stage, move)).ok, true);
	const moved = await board(stage);
	assert.equal(moved.detail.stage, "nurture_drip");
	assert.equal(moved.lastStage.prior_stage, "qualified");
	const archive = {
		...command(moved.detail.base_version, "stage"),
		stage: "archived",
	};
	assert.equal((await save(stage, archive)).status, 400);
	assert.equal(
		(await save(stage, { ...archive, reason: "Example ended" })).ok,
		true,
	);
	const ended = await board(stage);
	assert.equal(ended.detail.stage, "archived");
	assert.equal(ended.lastStage.reason, "Example ended");
});

test("an explicit link records the exact client without converting the lead", async () => {
	const { detail: lead } = await board(link);
	assert.equal(await visibleOnLeads(link), true);
	assert.deepEqual(lead.possible_clients, [
		{ client_id: client, name: "EXAMPLE PRACTICE" },
	]);
	const body = {
		...command(lead.base_version, "link"),
		client_id: client,
		confirmed: true,
	};
	await db.query("begin; set local engine.job = 'old_system'");
	try {
		await assert.rejects(
			db.query(
				"update party_role set lead_client_id = $1 where party_id = $2 and role = 'lead'",
				[client, link],
			),
			{ constraint: "lead_client_link_confirmation" },
		);
	} finally {
		await db.query("rollback");
	}
	assert.equal((await save(link, { ...body, confirmed: false })).status, 400);
	assert.equal(
		(await save(link, { ...body, client_id: claim })).error,
		"client_not_found",
	);
	const refused = await save(link, { ...body, client_id: unrelatedClient });
	assert.equal(refused.status, 409);
	assert.equal(refused.error, "client_not_suggested");
	await db.query(`begin; set local engine.user_id = '${joe}'`);
	try {
		await assert.rejects(
			db.query(
				"update party_role set lead_client_id = $1 where party_id = $2 and role = 'lead'",
				[unrelatedClient, link],
			),
			{ constraint: "lead_client_link_suggested" },
		);
	} finally {
		await db.query("rollback");
	}
	assert.equal((await save(link, body)).ok, true);
	const { detail: linked } = await board(link);
	assert.equal(linked.linked_client, true);
	assert.equal(linked.client_id, client);
	assert.equal(linked.is_client, false);
	assert.equal(linked.is_deal, false);
	assert.deepEqual(linked.possible_clients, []);
	assert.equal(await visibleOnLeads(link), false);
	const { prospects } = await read("prospects");
	assert.ok(Array.isArray(prospects));
	assert.ok(
		prospects.map(record).some((prospect) => prospect.party_id === link),
	);
	const again = { ...body, ...command(linked.base_version, "link") };
	assert.equal((await save(link, again)).error, "lead_not_linkable");

	await db.query(`begin; set local engine.user_id = '${joe}';
		select merge_party('${client}', '${link}'); commit;`);
	assert.equal((await board(link)).detail.is_client, true);
	assert.deepEqual(
		(
			await db.query(
				"select lead_client_id from party_role where party_id = $1 and role = 'lead'",
				[link],
			)
		).rows,
		[{ lead_client_id: null }],
	);
});
