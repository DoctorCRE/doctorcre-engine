import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isArguments } from "../save-door.ts";
import { readSchema } from "../test-copy.ts";
import { doorTest } from "../test-door.ts";

const { db, setup, cleanup, request, save } = doorTest();
const switched = { LEADS_READ_SCHEMA: "next" };
type Partner = "joe" | "dell";

before(async () => {
	await setup();
	const joe = randomUUID();
	const dell = randomUUID();
	await db.query(`begin;
		set local engine.job = 'old_system';
		insert into party (id, kind, name) values
			('${joe}', 'person', 'Example Partner A'),
			('${dell}', 'person', 'Example Partner B');
		insert into app_user (id, slug) values ('${joe}', 'joe'), ('${dell}', 'dell');
		insert into how_found values ('inbound', 'Inbound');
		insert into role (slug, label) values ('lead', 'Lead');
		insert into stage values ('lead', 'new', 'New');
		commit;`);
});
after(cleanup);

async function emailLead() {
	const email = `${randomUUID()}@clinic.example.test`;
	const evidence = `Example Clinic needs help finding space. Contact ${email}.`;
	const [status, { party_id }] = await save(
		{ job: "mail_capture", for_user: "joe" },
		"leads/email-intake",
		{
			idempotency_key: randomUUID(),
			kind: "lead_source",
			happened_at: "2026-11-02T15:00:00Z",
			email: {
				message_id: `${randomUUID()}@example.test`,
				sender: "notices@example.test",
				recipients: [{ address: "partner@example.test", kind: "to" }],
				subject: "Example lead",
				body: evidence,
			},
			evidence,
			prospect: { kind: "company", name: "Example Clinic", email },
		},
	);
	assert.equal(status, 201);
	assert.ok(typeof party_id === "string");
	return party_id;
}

async function open(id: string, user: Partner, view: "board" | "drawer") {
	const path = view === "board" ? "leads" : `leads?lead_id=${id}`;
	const response = await request({ user }, path, { method: "GET" }, switched);
	assert.equal(response.status, 200);
	const body: unknown = await response.json();
	assert.ok(isArguments(body));
	const lead: unknown =
		view === "board" && Array.isArray(body.leads)
			? body.leads.find((row: unknown) => isArguments(row) && row.id === id)
			: body.detail;
	assert.ok(isArguments(lead));
	return lead;
}

function command(
	action: "acknowledge_email" | "claim",
	user: Partner,
	base_version: unknown,
) {
	return {
		action,
		expected_actor: user,
		base_version,
		idempotency_key: randomUUID(),
	};
}

async function change(
	id: string,
	user: string,
	body: object,
	headers: HeadersInit = {},
) {
	const response = await request(
		{ user },
		`leads/${id}/changes`,
		{ method: "POST", body: JSON.stringify(body), headers },
		switched,
	);
	const answer: unknown = await response.json();
	assert.ok(isArguments(answer));
	return { status: response.status, error: answer.error };
}

async function assertState(
	id: string,
	newFromEmail: boolean,
	owner: Partner | null,
	acknowledger: Partner | null,
) {
	for (const [user, view] of [
		["joe", "board"],
		["dell", "drawer"],
	] as const) {
		const lead = await open(id, user, view);
		assert.equal(lead.new_from_email, newFromEmail);
		assert.equal(lead.owner, owner);
	}
	const { rows } = await db.query(
		`select u.slug, a.acknowledged_at is not null as recorded
		from lead_email_attention a left join app_user u on u.id = a.acknowledged_by_user_id
		where a.party_id = $1`,
		[id],
	);
	assert.deepEqual(rows, [
		{ slug: acknowledger, recorded: acknowledger !== null },
	]);
}

test("the board and drawer expose new email attention without acknowledging it", async () => {
	await assertState(await emailLead(), true, null, null);
});

test("either partner can clear shared email attention without claiming the lead", async () => {
	const id = await emailLead();
	const { base_version } = await open(id, "dell", "drawer");
	assert.equal(
		(
			await change(
				id,
				"dell",
				command("acknowledge_email", "dell", base_version),
			)
		).status,
		200,
	);
	assert.equal(
		(await change(id, "joe", command("acknowledge_email", "joe", base_version)))
			.status,
		200,
	);
	await assertState(id, false, null, "dell");
	assert.equal((await open(id, "joe", "board")).base_version, base_version);
	assert.equal(
		(await change(id, "joe", command("claim", "joe", base_version))).status,
		200,
	);
	await assertState(id, false, "joe", "dell");
});

test("the drawer identifies the intake email after acknowledgement and among other correspondence", async () => {
	const id = await emailLead();
	const { rows } = await db.query(
		"select activity_id from lead_email_attention where party_id = $1",
		[id],
	);
	const activityId = rows[0].activity_id;
	const otherId = randomUUID();
	await db.query("begin; set local engine.job = 'old_system'");
	await db.query(
		"insert into activity (id, kind, happened_at, summary, changed_by_job) values ($1, 'email', now(), 'Another contact', 'old_system')",
		[otherId],
	);
	await db.query(
		"insert into activity_about (activity_id, party_id) values ($1, $2)",
		[otherId, id],
	);
	await db.query("commit");
	const first = await open(id, "joe", "drawer");
	assert.ok(Array.isArray(first.correspondence));
	assert.equal(first.correspondence.length, 2);
	assert.ok(first.source_email);
	assert.deepEqual(
		first.source_email,
		first.correspondence.find(
			(entry: unknown) => isArguments(entry) && entry.id === activityId,
		),
	);
	assert.equal(
		(
			await change(
				id,
				"joe",
				command("acknowledge_email", "joe", first.base_version),
			)
		).status,
		200,
	);
	assert.deepEqual(
		(await open(id, "dell", "drawer")).source_email,
		first.source_email,
	);
	await db.query("delete from lead_email_attention where party_id = $1", [id]);
	assert.equal((await open(id, "joe", "drawer")).source_email, null);
});

test("concurrent claims give the lead to one partner and clear attention in that save", async () => {
	const id = await emailLead();
	const { base_version } = await open(id, "joe", "board");
	const partners = ["joe", "dell"] as const;
	const outcomes = await Promise.all(
		partners.map(async (user) => ({
			user,
			...(await change(id, user, command("claim", user, base_version))),
		})),
	);
	const winner = outcomes.find(({ status }) => status === 200);
	assert.ok(winner);
	assert.deepEqual(
		outcomes
			.filter(({ user }) => user !== winner.user)
			.map(({ status, error }) => [status, error]),
		[[409, "version_conflict"]],
	);
	await assertState(id, false, winner.user, winner.user);
});

test("email acknowledgement and claim require partner sign-in", async () => {
	const id = await emailLead();
	const { base_version } = await open(id, "joe", "board");
	const acknowledgement = command("acknowledge_email", "joe", base_version);
	for (const body of [acknowledgement, command("claim", "joe", base_version)]) {
		assert.equal((await change(id, "joe", body, { Cookie: "" })).status, 401);
		assert.equal((await change(id, "guest", body)).status, 403);
	}
	assert.equal((await change(id, "joe", acknowledgement)).status, 200);
	await assertState(id, false, null, "joe");
});

test("until the grant lands, reads work and failed saves leave attention and owner unchanged", async () => {
	const id = await emailLead();
	const ordinaryId = await emailLead();
	await db.query("delete from lead_email_attention where party_id = $1", [
		ordinaryId,
	]);
	const ordinary = await open(ordinaryId, "joe", "board");
	const { base_version } = await open(id, "joe", "board");
	const claim = command("claim", "joe", base_version);
	await db.query(
		"revoke update (acknowledged_by_user_id, acknowledged_at) on lead_email_attention from engine",
	);
	try {
		assert.equal(
			(
				await change(
					ordinaryId,
					"joe",
					command("claim", "joe", ordinary.base_version),
				)
			).status,
			200,
		);
		assert.equal((await open(ordinaryId, "joe", "board")).owner, "joe");
		for (const body of [
			command("acknowledge_email", "joe", base_version),
			claim,
		]) {
			assert.deepEqual(await change(id, "joe", body), {
				status: 503,
				error: "database_unavailable",
			});
		}
		await assertState(id, true, null, null);
	} finally {
		await db.query(await readSchema("add-lead-email-ack-grant.sql"));
	}
	assert.equal((await change(id, "joe", claim)).status, 200);
	await assertState(id, false, "joe", "joe");
});
