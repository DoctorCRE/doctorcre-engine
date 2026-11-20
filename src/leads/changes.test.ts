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
const link = randomUUID();
const client = randomUUID();
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
			('lead', 'archived', 'Archived');
		insert into party (id, kind, name, how_found) values
			('${joe}', 'person', 'Example Partner A', null),
			('${dell}', 'person', 'Example Partner B', null),
			('${claim}', 'person', 'Example Claim', 'referral'),
			('${stage}', 'person', 'Example Stage', 'referral'),
			('${link}', 'company', 'Example Practice', 'referral'),
			('${client}', 'company', 'EXAMPLE PRACTICE', 'referral');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into party_role (party_id, role, stage) values
			('${claim}', 'lead', 'new'), ('${stage}', 'lead', 'qualified'),
			('${link}', 'lead', 'opportunity'), ('${client}', 'client', null);
		insert into client (party_id) values ('${client}');
		insert into outside_id (source, value, party_id) values ('old_system_lead', '${legacy}', '${claim}');
		commit;`);
});
after(cleanup);

async function board(id: string) {
	const response = await request(
		{ user: "joe" },
		`leads?workspace=leads&lead_id=${id}`,
		{ method: "GET" },
		switched,
	);
	assert.equal(response.status, 200);
	const detail = record(record(await response.json()).detail);
	assert.ok(Array.isArray(detail.stage_history));
	return { detail, lastStage: record(detail.stage_history[0] ?? {}) };
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
	assert.equal((await save(link, body)).ok, true);
	const { detail: linked } = await board(link);
	assert.equal(linked.linked_client, true);
	assert.equal(linked.client_id, client);
	assert.equal(linked.is_client, false);
	assert.equal(linked.is_deal, false);
	assert.deepEqual(linked.possible_clients, []);
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
