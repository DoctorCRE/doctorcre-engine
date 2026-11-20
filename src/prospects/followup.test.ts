import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, save, request } = doorTest();
const joe = { user: "joe" };
const dell = { user: "dell" };
const joeId = randomUUID();
const dellId = randomUUID();
const lead = randomUUID();
const key = () => ({ idempotency_key: randomUUID() });
const leadPath = `prospects/${lead}`;

before(async () => {
	await setup();
	await db.query(`begin; set local engine.job = 'old_system';
		insert into job values ('cadence', 'Example follow-up schedule') on conflict do nothing;
		insert into role (slug, label) values ('lead', 'Lead');
		insert into stage (role, slug, label) values ('lead', 'opportunity', 'Opportunity'), ('lead', 'qualified', 'Qualified');
		insert into how_found (slug, label) values ('referral', 'Referral');
		insert into party (id, kind, name, how_found)
			select id, 'person', 'Example Person', 'referral'
			from unnest(array['${joeId}', '${dellId}', '${lead}']::uuid[]) as id;
		insert into app_user (id, slug) values ('${joeId}', 'joe'), ('${dellId}', 'dell');
		insert into party_role (party_id, role, stage) values ('${lead}', 'lead', 'opportunity');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function followUps() {
	const [status, prospect] = await save(dell, leadPath, {}, "GET");
	assert.equal(status, 200);
	assert.ok(Array.isArray(prospect.follow_ups));
	return prospect.follow_ups.filter(isArguments);
}

test("a dated follow-up replaces only the setting partner's step and opens that prospect from Home", async () => {
	const day = "2023-08-21";
	const [autoStatus, automatic] = await save(
		{ job: "cadence", for_user: "joe" },
		"next-steps",
		{
			...key(),
			party_id: lead,
			due_on: day,
			what: "Automatic check-in",
		},
	);
	assert.equal(autoStatus, 201);
	const [dellStatus, dellStep] = await save(dell, "next-steps", {
		...key(),
		party_id: lead,
		replaces: "current",
		seen_current_step: null,
		due_on: day,
		what: "Ask for timing",
	});
	assert.equal(dellStatus, 201);
	const [alreadySet, conflict] = await save(dell, "next-steps", {
		...key(),
		party_id: lead,
		replaces: "current",
		seen_current_step: null,
		due_on: day,
		what: "Stale form",
	});
	assert.equal(alreadySet, 409);
	assert.equal(conflict.error, "version_conflict");
	const open = await followUps();
	const current = open.find((step) => step.owner === "joe");
	assert.equal(current?.next_step_id, automatic.next_step_id);
	assert.equal(current?.change_id, automatic.change_id);
	assert.equal(current?.set_by, null);
	assert.equal(current?.set_from, "cadence");
	const direct = open.find((step) => step.owner === "dell");
	assert.ok(direct && typeof direct.set_at === "string");
	assert.equal(direct.set_by, "Example Person");
	assert.equal(direct.set_from, null);
	assert.ok(Number.isFinite(Date.parse(direct.set_at)));

	const version = {
		next_step_id: current?.next_step_id,
		change_id: current?.change_id,
	};
	const followUp = {
		...key(),
		party_id: lead,
		replaces: "current",
		seen_current_step: version,
		due_on: day,
		what: "Call about the second location",
	};
	const [changedStatus] = await save(
		joe,
		`next-steps/${automatic.next_step_id}/changes`,
		{
			...key(),
			seen_change_id: version.change_id,
			what: "Check in by email",
		},
	);
	assert.equal(changedStatus, 200);
	const [staleStatus, stale] = await save(joe, "next-steps", followUp);
	assert.equal(staleStatus, 409);
	assert.equal(stale.error, "version_conflict");

	const [success, added] = await save(joe, "next-steps", {
		...followUp,
		...key(),
		seen_current_step: { ...version, change_id: stale.current_version },
	});
	assert.equal(success, 201);
	assert.deepEqual(
		(await followUps()).map(({ next_step_id }) => next_step_id).sort(),
		[added.next_step_id, dellStep.next_step_id].sort(),
	);
	assert.deepEqual(
		(
			await db.query(
				"select status, resolution_reason from next_step where id = $1",
				[automatic.next_step_id],
			)
		).rows,
		[{ status: "cancelled", resolution_reason: "Replaced by a new next step" }],
	);

	const inbox = await request(
		joe,
		"home/inbox",
		{ method: "GET" },
		{ HOME_INBOX_READ_SCHEMA: "next" },
	);
	assert.equal(inbox.status, 200);
	const home = await inbox.json();
	assert.ok(isArguments(home) && Array.isArray(home.items));
	const card = home.items
		.filter(isArguments)
		.find((item) => item.action_id === added.next_step_id);
	assert.equal(
		card?.open_url,
		`/deals?prospect=${lead}&focus=follow-up&step=${added.next_step_id}`,
	);
	assert.equal(card?.action_version, added.change_id);
	assert.equal(
		(
			await save(joe, `next-steps/${added.next_step_id}/end`, {
				...key(),
				resolution: "done",
				base_version: card?.action_version,
			})
		)[0],
		200,
	);
	assert.deepEqual(
		(await followUps()).map(({ next_step_id }) => next_step_id),
		[dellStep.next_step_id],
	);
});

async function newProspect(stage = "opportunity") {
	const partyId = randomUUID();
	await db.query(`begin; set local engine.user_id = '${joeId}';
		insert into party (id, kind, name, how_found)
		values ('${partyId}', 'company', 'Example Prospect', 'referral');
		insert into party_role (party_id, role, stage) values ('${partyId}', 'lead', 'opportunity');
		update party_role set stage = '${stage}' where party_id = '${partyId}' and role = 'lead';
		commit;`);
	return partyId;
}

const replacement = {
	replaces: "current",
	seen_current_step: null,
	due_on: "2024-03-01",
	what: "Call for timing",
};

test("a signed-in prospect follow-up requires the step version", async () => {
	const [status, answer] = await save(joe, "next-steps", {
		...key(),
		...replacement,
		seen_current_step: undefined,
		party_id: await newProspect(),
	});
	assert.deepEqual(
		[status, answer.error, answer.fields],
		[400, "missing_required", ["seen_current_step"]],
	);
});

test("a follow-up refuses a lead that has left Prospects", async () => {
	const [status, answer] = await save(joe, "next-steps", {
		...key(),
		...replacement,
		party_id: await newProspect("qualified"),
	});
	assert.equal(status, 409);
	assert.equal(answer.error, "not_a_prospect");
});

for (const [label, invalid, error, field] of [
	["without a due date", { due_on: undefined }, "missing_required", "due_on"],
	[
		"with an explicit owner",
		{ owner: "joe" },
		"invalid_field_value",
		"seen_current_step",
	],
	[
		"without replacement",
		{ replaces: undefined },
		"invalid_field_value",
		"seen_current_step",
	],
] as const) {
	test(`a versioned follow-up refuses a save ${label}`, async () => {
		const [status, answer] = await save(joe, "next-steps", {
			...key(),
			...replacement,
			...invalid,
			party_id: await newProspect(),
		});
		assert.equal(status, 400);
		assert.equal(answer.error, error);
		assert.deepEqual(answer.fields, [field]);
	});
}
