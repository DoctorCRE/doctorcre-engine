import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { copyTest, readSchema } from "../test-copy.ts";
import app from "../worker.ts";

const { db, setup, cleanup, connectionString } = copyTest();
const writer = `activity_door_${randomUUID().replaceAll("-", "")}`;
const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [JOE, CASEY, DEAL, MISSING, DELL] = [id(1), id(2), id(3), id(4), id(5)];
const ORIGIN = "https://engine.example.test";
const TEAM = "https://example.cloudflareaccess.com";
const access = await generateKeyPair("RS256", { extractable: true });

before(async () => {
	const key = await exportJWK(access.publicKey);
	mock.method(globalThis, "fetch", async () =>
		Response.json({ keys: [{ ...key, kid: "made-up-kid" }] }),
	);
	await setup();
	await db.query(`create role ${writer} login; grant engine, engine_reader to ${writer};
		begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${JOE}', 'person', 'Joe Example'), ('${CASEY}', 'person', 'Casey Example'), ('${DELL}', 'person', 'Dell Example');
		insert into app_user (id, slug) values ('${JOE}', 'joe'), ('${DELL}', 'dell');
		insert into how_found (slug, label) values ('inbound', 'Inbound');
		insert into role (slug, label) values ('lead', 'Lead');
		insert into stage (role, slug, label) values ('lead', 'new', 'New');
		insert into party_email (party_id, address, label) values
			('${JOE}', 'joe@example.com', 'work'), ('${CASEY}', 'casey@example.com', 'work');
		insert into deal (id, name, owner_user_id) values ('${DEAL}', 'Example Deal', '${JOE}'); commit;`);
});
after(async () => {
	mock.restoreAll();
	await db.query(`drop owned by ${writer}; drop role ${writer}`);
	await cleanup();
});

type Answer = { status: number; body: Record<string, unknown> };
async function ask(path: string, body: object | undefined, headers: object) {
	const url = new URL(connectionString);
	url.username = writer;
	const session = { actor: { slug: "joe", display: "Joe" }, csrf_token: "x" };
	const response = await app.request(
		`${ORIGIN}${path}`,
		{
			method: body === undefined ? "GET" : "POST",
			headers: { ...headers },
			body: JSON.stringify(body),
		},
		{
			ACCESS_TEAM_DOMAIN: TEAM,
			JOBS_ACCESS_AUD: "made-up-jobs",
			DATABASE_WRITER: { connectionString: url.href },
			DATABASE: { connectionString: url.href },
			HOME_INBOX_READ_SCHEMA: "next",
			CARR: { fetch: async () => Response.json(session) },
		},
	);
	const answer = (await response.json()) as Answer["body"];
	return { status: response.status, body: answer };
}
const MAIL_CAPTURE = { "Engine-Job": "mail_capture", "Engine-For-User": "joe" };
async function jobRequest(path: string, body: object | undefined, job: object) {
	return ask(`/jobs/${path}`, body, {
		"Cf-Access-Jwt-Assertion": await new SignJWT({})
			.setProtectedHeader({ alg: "RS256", kid: "made-up-kid" })
			.setIssuer(TEAM)
			.setAudience("made-up-jobs")
			.setExpirationTime("5 minutes")
			.sign(access.privateKey),
		...job,
	});
}
const viaJob = (body: object, job: object = MAIL_CAPTURE, path = "") =>
	jobRequest(`activities${path}`, body, job);
const viaApp = (body: object) =>
	ask("/api/engine/activities", body, {
		Cookie: "__Host-dealroom_session=made-up",
		Origin: ORIGIN,
		"Sec-Fetch-Site": "same-origin",
		"x-carr-csrf": "x",
	});
async function refused(
	asked: Promise<Answer>,
	status: number,
	error: string,
	details = {},
) {
	const { status: given, body } = await asked;
	const { correlation_id: _id, hint: _hint, ...rest } = body;
	assert.deepEqual([given, rest], [status, { error, ...details }]);
}

const mail = (message_id: string, fields = {}, more = {}) => ({
	idempotency_key: randomUUID(),
	kind: "email",
	happened_at: "2026-11-02T15:00:00Z",
	email: {
		message_id,
		sender: "Casey@Example.com",
		recipients: [
			{ address: "joe@example.com", kind: "to" },
			{ address: "pat@example.net", kind: "cc" },
		],
		subject: "Example subject",
		body: "Example body",
		...fields,
	},
	...more,
});
const note = (more = {}) => ({
	idempotency_key: randomUUID(),
	kind: "note",
	happened_at: "2026-11-03T12:00:00-06:00",
	about: [{ party_id: CASEY }],
	...more,
});

test("mail capture queues each new message once per mailbox partner", async () => {
	const conversation_id = "summary-job-thread";
	const first = mail("summary-job-first", { conversation_id });
	const second = mail("summary-job-second", { conversation_id });
	const otherMailbox = { ...MAIL_CAPTURE, "Engine-For-User": "dell" };
	const one = await viaJob(first);
	const two = await viaJob(second);
	assert.equal(one.status, 201);
	assert.equal(two.status, 201);
	assert.equal((await viaJob(first)).body.replayed, true);
	assert.equal(
		(await viaJob({ ...first, idempotency_key: randomUUID() })).status,
		201,
	);
	const other = await viaJob(
		{ ...first, idempotency_key: randomUUID() },
		otherMailbox,
	);
	assert.equal(other.status, 201);
	assert.equal(other.body.activity_id, one.body.activity_id);
	const { rows } = await db.query(
		`select activity_id, owner_user_id, idempotency_key, kind from doc_judgment_job
		where activity_id in ($1, $2) order by activity_id, owner_user_id`,
		[one.body.activity_id, two.body.activity_id],
	);
	assert.deepEqual(
		rows
			.map(({ activity_id, owner_user_id, idempotency_key, kind }) => {
				assert.equal(idempotency_key, activity_id);
				assert.equal(kind, "email_summary");
				return `${activity_id}:${owner_user_id}`;
			})
			.sort(),
		[
			`${one.body.activity_id}:${JOE}`,
			`${one.body.activity_id}:${DELL}`,
			`${two.body.activity_id}:${JOE}`,
		].sort(),
	);
});

test("mail capture skips lead notices and available summaries", async () => {
	const sender = "summary-excluded@example.test";
	await db.query(
		"insert into lead_source_sender (address, name) values ($1, 'Example source')",
		[sender],
	);
	const lead = await viaJob(
		mail("summary-lead-notice", { sender }, { about: [{ party_id: CASEY }] }),
	);
	assert.equal(lead.status, 201);
	await assertRows(
		0,
		"select from doc_judgment_job where activity_id = $1",
		lead.body.activity_id,
	);

	const otherMailbox = { ...MAIL_CAPTURE, "Engine-For-User": "dell" };
	for (const available of [true, false]) {
		const message = mail(`summary-prior-${available}`);
		const saved = await viaJob(message);
		assert.equal(saved.status, 201);
		await db.query(
			`insert into email_summary
			(activity_id, source_activity_id, source_hash, generator_version, status, text, provenance, recorded_at)
			values ($1, $1, 'sha256:' || repeat('a', 64), 'example.v1', $2, $3, '{}', '2026-01-01')`,
			[
				saved.body.activity_id,
				available ? "available" : "unavailable",
				available ? "An older summary." : null,
			],
		);
		assert.equal(
			(
				await viaJob(
					{ ...message, idempotency_key: randomUUID() },
					otherMailbox,
				)
			).status,
			201,
		);
		await assertRows(
			available ? 0 : 1,
			"select from doc_judgment_job where activity_id = $1 and owner_user_id = $2",
			saved.body.activity_id,
			DELL,
		);
	}
});

test("mail capture succeeds before the enqueue migration", async () => {
	await db.query("drop function queue_email_summary(uuid)");
	try {
		const response = await viaJob(mail("summary-before-enqueue-migration"));
		assert.equal(response.status, 201);
		await assertRows(
			1,
			"select from email_mailbox where activity_id = $1 and user_id = $2",
			response.body.activity_id,
			JOE,
		);
		await assertRows(
			0,
			"select from doc_judgment_job where activity_id = $1",
			response.body.activity_id,
		);
	} finally {
		await db.query(await readSchema("add-queue-email-summary.sql"));
	}
});

const stored = async (message_id: string) =>
	(
		await db.query(
			`select e.sender, e.body, a.from_party_id, a.changed_by_job, a.changed_for_user_id
			from email e join activity a on a.id = e.activity_id where e.message_id = $1`,
			[message_id],
		)
	).rows;

const intake = (body: object, user = "joe") =>
	jobRequest("leads/email-intake", body, {
		...MAIL_CAPTURE,
		"Engine-For-User": user,
	});
function notice(id: string, facts = {}, contact = `${id}@clinic.example.test`) {
	const evidence = "I need help opening Example Clinic.";
	const email = mail(`${id}@example.test`, {
		sender: "notices@example.test",
		body: `${evidence} Contact ${contact}.`,
	});
	return {
		...email,
		kind: "lead_source",
		evidence,
		prospect: {
			kind: "company",
			name: "Example Clinic",
			email: contact,
			...facts,
		},
	};
}
async function assertRows(
	count: number,
	statement: string,
	...values: unknown[]
) {
	assert.equal((await db.query(statement, values)).rowCount, count);
}

const [storedNotice, ordinary] = [id(80), id(81)];
const [unrelated, filing, suggestedDeal, otherFiling, reply] = [
	id(82),
	id(83),
	id(84),
	id(85),
	id(86),
];
const reconcile = (activity_id: string, options = {}) =>
	jobRequest(
		"leads/email-reconcile",
		{
			activity_id,
			idempotency_key: randomUUID(),
			...options,
		},
		MAIL_CAPTURE,
	);

test("reconciliation moves exact filings to Leads and keeps other Home work", async () => {
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into lead_source_sender (domain, name) values ('source.example.test', 'Example domain');
		insert into lead_source_sender (address, name, fields) values
			('intake@source.example.test', 'Example sender', '{"name":"Contact","street_address":"Address"}');
		insert into activity (id, kind, happened_at)
			select id, 'email', '2026-11-02T15:00:00Z'
			from unnest(array['${storedNotice}', '${ordinary}']::uuid[]) as e(id);
		insert into email (activity_id, message_id, conversation_id, sender, subject, body, imported)
			select id, null, 'same-thread', sender, 'Example notice',
				'New request Contact: Maya Example · maya@example.test Address: 12 Fixture Row', true
			from (values ('${storedNotice}'::uuid, 'intake@source.example.test'), ('${ordinary}', 'other@example.test')) as e(id, sender);
		insert into email_mailbox (activity_id, user_id) select id, '${JOE}' from activity where id in ('${storedNotice}', '${ordinary}');
		insert into activity_about (activity_id, party_id) select id, '${JOE}' from activity where id in ('${storedNotice}', '${ordinary}');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job)
			values ('${filing}', 'possible_new_deal', '${storedNotice}', 'email', 'Example notice', 'old_system'),
				('${otherFiling}', 'possible_new_deal', '${ordinary}', 'email', 'Other email', 'old_system');
		insert into proposal (id, kind, activity_id, activity_kind, evidence, proposed_by_job, deal_id, what)
			values ('${suggestedDeal}', 'file_to_deal', '${storedNotice}', 'email', 'Example notice', 'old_system', '${DEAL}', null),
				('${unrelated}', 'next_step', '${storedNotice}', 'email', 'Please call', 'old_system', '${DEAL}', 'Call the prospect');
		insert into reply_draft (id, email_activity_id, owner_user_id, proposed_by_job, subject, body, evidence)
			values ('${reply}', '${storedNotice}', '${JOE}', 'old_system', 'Re: Example notice', 'Thanks for writing.', 'New request');
		commit;`);
	const key = randomUUID();
	assert.deepEqual(
		await reconcile(storedNotice, { dry_run: true, idempotency_key: key }),
		{ status: 200, body: { eligible_emails: 1, filing_decisions: 2 } },
	);
	await assertRows(
		1,
		`select where not exists (select from lead_email_source where activity_id = $1)
		and not exists (select from save_receipt where idempotency_key = $2)`,
		storedNotice,
		key,
	);

	const {
		status,
		body: { party_id, filing_decisions },
	} = await reconcile(storedNotice, { idempotency_key: key });
	assert.equal(status, 200);
	assert.equal(filing_decisions, 2);
	assert.ok(typeof party_id === "string");
	await assertRows(
		2,
		`select from proposal where id in ($1, $2) and status = 'superseded'
		and changed_by_job = 'mail_capture' and superseded_reason = 'Moved to Leads'`,
		filing,
		suggestedDeal,
	);
	const home = await ask("/api/engine/home/inbox?view=dashboard", undefined, {
		Cookie: "__Host-dealroom_session=made-up",
	});
	assert.equal(home.status, 200);
	const cards = JSON.stringify(home.body);
	for (const kept of [reply, unrelated, otherFiling])
		assert.ok(cards.includes(kept), kept);
	for (const settled of [filing, suggestedDeal])
		assert.ok(!cards.includes(settled), settled);

	await assertRows(
		1,
		`select from lead_email_source s join party p on p.id = s.party_id
		join party_role r on r.party_id = p.id and r.role = 'lead'
		join lead_email_attention a on a.party_id = p.id
		where s.activity_id = $1 and p.id = $2 and p.name = 'Maya Example'
		and r.owner_user_id is null and a.acknowledged_at is null`,
		storedNotice,
		party_id,
	);
	await db.query(`begin; select set_config('engine.user_id', '${JOE}', true);
		update party_role set owner_user_id = '${JOE}' where party_id = '${party_id}' and role = 'lead';
		update lead_email_attention set acknowledged_by_user_id = '${JOE}', acknowledged_at = now()
		where party_id = '${party_id}'; commit;`);
	const history = async () =>
		(
			await db.query(
				`select id from change
		where record->>'id' in ($1, $2) or record->>'party_id' = $3 order by id`,
				[filing, suggestedDeal, party_id],
			)
		).rows;
	const before = await history();
	assert.deepEqual(await reconcile(storedNotice), {
		status: 200,
		body: { party_id, eligible_emails: 1, filing_decisions: 0 },
	});
	assert.deepEqual(await history(), before);
	await assertRows(
		1,
		`select from party_role r join lead_email_attention a using (party_id)
		where r.party_id = $1 and r.role = 'lead' and r.owner_user_id = $2 and a.acknowledged_by_user_id = $2`,
		party_id,
		JOE,
	);

	assert.deepEqual(await reconcile(ordinary), {
		status: 200,
		body: { eligible_emails: 0, filing_decisions: 0 },
	});
	await assertRows(
		1,
		`select from proposal where id = $1 and status = 'pending'
		and not exists (select from lead_email_source where activity_id = $2)`,
		otherFiling,
		ordinary,
	);
});

async function copiedNotice(
	activity_id: string,
	sender: string,
	body: string,
	nameLabel?: string,
) {
	await db.query("begin");
	try {
		await db.query("select set_config('engine.job', 'old_system', true)");
		await db.query(
			"insert into lead_source_sender (address, name, fields) values ($1, 'Example source', $2)",
			[sender, nameLabel ? { name: nameLabel } : null],
		);
		await db.query(
			"insert into activity (id, kind, happened_at) values ($1, 'email', '2026-11-02T15:00:00Z')",
			[activity_id],
		);
		await db.query(
			`insert into email (activity_id, message_id, sender, subject, body, imported)
			values ($1, null, $2, 'Example notice', $3, true)`,
			[activity_id, sender, body],
		);
		await db.query(
			"insert into email_mailbox (activity_id, user_id) values ($1, $2)",
			[activity_id, JOE],
		);
		await db.query(
			"insert into activity_about (activity_id, party_id) values ($1, $2)",
			[activity_id, JOE],
		);
		await db.query(
			`insert into proposal (kind, activity_id, activity_kind, evidence, proposed_by_job)
			values ('possible_new_deal', $1, 'email', 'Example notice', 'old_system')`,
			[activity_id],
		);
		await db.query("commit");
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
}

for (const { number, separator, marker } of [
	{ number: 87, separator: "\r\n", marker: "-----Original Message-----" },
	{ number: 89, separator: " ", marker: "Begin forwarded message:" },
]) {
	test(`reconciliation leaves filings pending when the notice follows ${marker}`, async () => {
		const activity_id = id(number);
		await copiedNotice(
			activity_id,
			`withdrawals-${number}@example.test`,
			[
				"Please withdraw this inquiry.",
				marker,
				"Name: Robin Example",
				"Email: robin@example.test",
			].join(separator),
		);
		const none = {
			status: 200,
			body: { eligible_emails: 0, filing_decisions: 0 },
		};
		assert.deepEqual(await reconcile(activity_id, { dry_run: true }), none);
		assert.deepEqual(await reconcile(activity_id), none);
		await assertRows(
			1,
			`select from proposal where activity_id = $1 and status = 'pending'
			and not exists (select from lead_email_source where activity_id = $1)`,
			activity_id,
		);
	});
}

test("reconciliation moves a copied one-line notice with default labels", async () => {
	const activity_id = id(88);
	await copiedNotice(
		activity_id,
		"forms@example.test",
		"New request Name: Alex Example Email: alex@example.test",
	);
	assert.deepEqual(await reconcile(activity_id, { dry_run: true }), {
		status: 200,
		body: { eligible_emails: 1, filing_decisions: 1 },
	});
	const { status, body } = await reconcile(activity_id);
	assert.equal(status, 200);
	assert.ok(typeof body.party_id === "string");
	await assertRows(
		1,
		`select from lead_email_source s join party p on p.id = s.party_id
		join party_email e on e.party_id = p.id
		join proposal f on f.activity_id = s.activity_id
		where s.activity_id = $1 and p.id = $2 and p.name = 'Alex Example'
		and e.address = 'alex@example.test' and f.status = 'superseded'`,
		activity_id,
		body.party_id,
	);
});

for (const { number, hint, prefix, phone, street } of [
	{
		number: 90,
		hint: "alone",
		prefix: "—",
		phone: null,
		street: "64 Fixture Row Suite B",
	},
	{
		number: 93,
		hint: "after a phone",
		prefix: "214-555-0142",
		phone: "+12145550142",
		street: "64 Fixture Ave. Northwest #12-B",
	},
	{
		number: 94,
		hint: "on a numbered highway with directions",
		prefix: "—",
		phone: null,
		street: "4100 E Highway 80 W",
	},
	{
		number: 95,
		hint: "on a numbered route with an abbreviated type",
		prefix: "—",
		phone: null,
		street: "825 Rte 9",
	},
]) {
	test(`reconciliation moves a copied notice with a combined contact address ${hint}`, async () => {
		const activity_id = id(number);
		await copiedNotice(
			activity_id,
			`address-notices-${number}@example.test`,
			`New inquiry Contact: Dana Example · ${prefix} Address: ${street}, Example City, TX 75001 Received: 2026-11-02`,
			"Contact",
		);
		assert.deepEqual(await reconcile(activity_id, { dry_run: true }), {
			status: 200,
			body: { eligible_emails: 1, filing_decisions: 1 },
		});
		const { status, body } = await reconcile(activity_id);
		assert.equal(status, 200);
		assert.ok(typeof body.party_id === "string");
		await assertRows(
			1,
			`select from lead_email_source s join party p on p.id = s.party_id
		join proposal f on f.activity_id = s.activity_id
		where s.activity_id = $1 and p.id = $2 and p.name = 'Dana Example'
		and p.city = 'Example City' and s.prospect->>'street_address' = $4
		and s.prospect->>'city' = 'Example City' and f.status = 'superseded'
		and s.prospect->>'phone' is not distinct from $3::text`,
			activity_id,
			body.party_id,
			phone,
			street,
		);
	});
}

for (const { number, missing, body } of [
	{
		number: 91,
		missing: "a prospect name",
		body: "New inquiry Contact: · — Address: 64 Fixture Row, Example City, TX 75001",
	},
	{
		number: 92,
		missing: "a prospect contact detail",
		body: "Target property: 64 Fixture Row, Example City, TX 75001 Contact: Taylor Example · — No phone listed",
	},
]) {
	test(`reconciliation keeps a copied notice without ${missing} pending`, async () => {
		const activity_id = id(number);
		await copiedNotice(
			activity_id,
			`missing-${number}@example.test`,
			body,
			"Contact",
		);
		assert.deepEqual(await reconcile(activity_id), {
			status: 200,
			body: { eligible_emails: 0, filing_decisions: 0 },
		});
		await assertRows(
			1,
			`select from proposal where activity_id = $1 and status = 'pending'
			and not exists (select from lead_email_source where activity_id = $1)`,
			activity_id,
		);
	});
}

test("reconciliation drops invalid streets and retains a valid phone", async () => {
	for (const [offset, street] of [
		"64",
		"24 hours to call",
		"7 Oaks Dental",
		"19 Example Dental LLC",
		"64 Fixture Row!",
		"64 Fixture Road 80",
		"24 hours should be enough",
	].entries()) {
		const activity_id = id(120 + offset);
		await copiedNotice(
			activity_id,
			`bad-street-${offset}@example.test`,
			`Contact: 7 Oaks Dental · ${offset === 0 ? "214-555-0143" : "—"} Address: ${street}, Example City, TX 75001`,
			"Contact",
		);
		const { status, body } = await reconcile(activity_id);
		assert.equal(status, 200);
		assert.equal(body.eligible_emails, offset === 0 ? 1 : 0, street);
		await assertRows(
			offset === 0 ? 1 : 0,
			`select from lead_email_source where activity_id = $1`,
			activity_id,
		);
		await assertRows(
			0,
			`select from lead_email_source where activity_id = $1 and prospect ?| array['street_address', 'city']`,
			activity_id,
		);
	}
});

for (const [offset, sentence] of [
	"24 hours should be enough",
	"3 brokers will follow up",
	"10 people can make the call on Monday",
].entries()) {
	test(`reconciliation drops the sentence ${JSON.stringify(sentence)} as a street`, async () => {
		const activity_id = id(127 + offset);
		const phone = `214-555-015${offset}`;
		await copiedNotice(
			activity_id,
			`numbered-sentence-${offset}@example.test`,
			`Contact: Dana Example · ${phone} Address: ${sentence}, Example City, TX 75001`,
			"Contact",
		);
		const { status, body } = await reconcile(activity_id);
		assert.equal(status, 200);
		assert.equal(body.eligible_emails, 1);
		await assertRows(
			1,
			`select from lead_email_source where activity_id = $1
			and prospect->>'phone' = $2 and not (prospect ?| array['street_address', 'city'])`,
			activity_id,
			`+1${phone.replaceAll("-", "")}`,
		);
	});
}

test("reconciliation stops reading facts at the end of the contact block", async () => {
	for (const [offset, rest] of [
		"— Received: 2026-11-02 · Address: 64 Fixture Row, Example City, TX 75001",
		"— > Earlier reply · Address: 64 Fixture Row, Example City, TX 75001",
		"— · Email: earlier@example.test",
		"Received: 2026-11-02 Email: earlier@example.test",
		"— · Profile updated · earlier@example.test",
	].entries()) {
		const activity_id = id(130 + offset);
		await copiedNotice(
			activity_id,
			`contact-block-${offset}@example.test`,
			`Name: Dana Example · ${rest}`,
		);
		assert.deepEqual(
			await reconcile(activity_id),
			{
				status: 200,
				body: { eligible_emails: 0, filing_decisions: 0 },
			},
			rest,
		);
		await assertRows(
			1,
			`select from proposal where activity_id = $1 and status = 'pending'`,
			activity_id,
		);
	}
});

test("reconciliation reads the email slot after an empty phone slot", async () => {
	const activity_id = id(140);
	await copiedNotice(
		activity_id,
		"email-slot@example.test",
		"Name: Dana Example · — · dana@example.test Address: 64 Fixture Row, Example City, TX 75001 · Email: earlier@example.test",
	);
	const { status, body } = await reconcile(activity_id);
	assert.equal(status, 200);
	assert.equal(body.filing_decisions, 1);
	assert.ok(typeof body.party_id === "string");
	await assertRows(
		1,
		`select from lead_email_source s join proposal f using (activity_id)
		where s.activity_id = $1 and s.party_id = $2 and f.status = 'superseded'
		and s.prospect = '{"kind":"person","name":"Dana Example","email":"dana@example.test"}'::jsonb`,
		activity_id,
		body.party_id,
	);
});

test("reconciliation accepts a repeated city and drops a conflicting address", async () => {
	for (const [offset, city] of ["example   city", "Different City"].entries()) {
		const activity_id = id(141 + offset);
		await copiedNotice(
			activity_id,
			`city-label-${offset}@example.test`,
			`Name: Dana Example · 214-555-0144 Address: 64 Fixture Row, Example City, TX 75001 City: ${city}`,
		);
		assert.deepEqual(await reconcile(activity_id, { dry_run: true }), {
			status: 200,
			body: { eligible_emails: 1, filing_decisions: 1 },
		});
		const { status, body } = await reconcile(activity_id);
		assert.equal(status, 200);
		assert.ok(typeof body.party_id === "string");
		await assertRows(
			1,
			`select from lead_email_source s join proposal f using (activity_id)
			where s.activity_id = $1 and s.party_id = $2 and f.status = 'superseded'
			and s.prospect->>'phone' = '+12145550144'
			and s.prospect->>'street_address' is not distinct from $3::text
			and s.prospect->>'city' is not distinct from $4::text`,
			activity_id,
			body.party_id,
			offset === 0 ? "64 Fixture Row" : null,
			offset === 0 ? "Example City" : null,
		);
	}
});

test("the router queue identifies emails saved by lead intake", async () => {
	const happened_at = new Date().toISOString();
	const source = notice("router-source");
	const lead = await intake({ ...source, happened_at });
	const ordinary = await viaJob(
		mail(
			"router-ordinary@example.test",
			{ sender: source.email.sender },
			{ happened_at, about: [{ party_id: CASEY }] },
		),
	);
	assert.equal(lead.status, 201);
	assert.equal(ordinary.status, 201);

	const { status, body } = await jobRequest(
		"router-queue?limit=200",
		undefined,
		MAIL_CAPTURE,
	);
	assert.equal(status, 200);
	assert.ok(Array.isArray(body.emails));
	const flags = new Map(
		body.emails.map((email) => [email.activity_id, email.lead_source]),
	);
	assert.equal(flags.get(lead.body.activity_id), true);
	assert.equal(flags.get(ordinary.body.activity_id), false);
});

test("a second lead mailbox can fill the first complete split on the same source", async () => {
	const request = notice("Intake-A");
	const first = await intake(request);
	assert.equal(first.status, 201);
	assert.equal((await intake(request)).body.replayed, true);
	assert.deepEqual(await savedEmailText(first.body.activity_id), {
		body: request.email.body,
		authored: null,
		history: null,
	});
	const split = { authored: request.email.body, history: splitText.history };
	const email = {
		...request.email,
		body: `${split.authored}\n\n${split.history}`,
		...split,
	};
	const second = await intake(
		{ ...request, email, idempotency_key: randomUUID() },
		"dell",
	);
	assert.equal(second.status, 200);
	assert.equal(second.body.party_id, first.body.party_id);
	assert.equal(second.body.activity_id, first.body.activity_id);
	const stored = { body: request.email.body, ...split };
	assert.deepEqual(await savedEmailText(first.body.activity_id), stored);
	for (const duplicate of [
		request.email,
		{ ...email, authored: "Different sender text.", history: "" },
	]) {
		const retry = await intake(
			{ ...request, email: duplicate, idempotency_key: randomUUID() },
			"joe",
		);
		assert.equal(retry.status, 200);
		assert.equal(retry.body.activity_id, first.body.activity_id);
		assert.equal(retry.body.party_id, first.body.party_id);
		assert.deepEqual(await savedEmailText(first.body.activity_id), stored);
	}
	await assertRows(
		1,
		`select from lead_email_attention n join lead_email_source s using (activity_id, party_id)
		join activity_about a using (activity_id, party_id) join email e using (activity_id)
		join party p on p.id = a.party_id join party_role r on r.party_id = p.id
		where e.message_id = $1 and e.sender = 'notices@example.test' and e.body = $2 and p.name = 'Example Clinic'
			and r.stage = 'new' and p.how_found = 'inbound' and r.owner_user_id is null
			and r.changed_by_job = 'mail_capture' and s.mailbox_user_id = $3
			and n.acknowledged_at is null and (select count(*) from email_mailbox where activity_id = e.activity_id) = 2`,
		request.email.message_id,
		request.email.body,
		JOE,
	);
});

test("concurrent phone matches converge and later intake preserves claim and acknowledgement", async () => {
	const phone = (id: string) =>
		notice(id, { email: undefined, phone: "+15125550101" }, "(512) 555-0101");
	const [a, b] = await Promise.all([
		intake(phone("phone-a")),
		intake(phone("phone-b"), "dell"),
	]);
	assert.deepEqual([a.status, b.status].sort(), [200, 201]);
	const { party_id } = a.body;
	assert.equal(b.body.party_id, party_id);
	const acknowledge =
		"update lead_email_attention set acknowledged_by_user_id = $2, acknowledged_at = now() where party_id = $1";
	await assert.rejects(db.query(acknowledge, [party_id, DELL]), {
		constraint: "lead_email_attention_acknowledged_once",
	});
	await db.query("begin");
	await db.query("select set_config('engine.user_id', $1, true)", [DELL]);
	await db.query(
		"update party_role set owner_user_id = $2 where party_id = $1",
		[party_id, DELL],
	);
	await db.query(acknowledge, [party_id, DELL]);
	await db.query("commit");
	const again = await intake(phone("phone-c"));
	assert.equal(again.status, 200);
	assert.equal(again.body.party_id, party_id);
	await assertRows(
		1,
		`select from party_role join lead_email_attention using (party_id)
		where party_id = $1 and owner_user_id = $2 and acknowledged_by_user_id = $2
			and (select count(*) from lead_email_source where party_id = $1) = 3`,
		party_id,
		DELL,
	);
});

test("later notices match contact facts first recorded on an existing lead", async () => {
	const phone = "+15125550102";
	const first = await intake(notice("contact-original"));
	assert.equal(first.status, 201);
	const combined = notice("contact-combined", {
		email: "contact-original@clinic.example.test",
		phone,
	});
	combined.email.body +=
		" Contact contact-original@clinic.example.test or (512) 555-0102.";
	const second = await intake(combined);
	assert.equal(second.status, 200);
	assert.equal(second.body.party_id, first.body.party_id);
	const last = await intake(
		notice("contact-phone", { email: undefined, phone }, "(512) 555-0102"),
	);
	assert.equal(last.status, 200);
	assert.equal(last.body.party_id, first.body.party_id);
});

test("a street and city qualify a notice and reuse email already stored by Message-ID", async () => {
	const address = (id: string) => {
		const request = notice(
			id,
			{
				email: undefined,
				street_address: "42 Example Way",
				city: "Sample City",
			},
			"42 Example Way, Sample City",
		);
		return { ...request, evidence: request.email.body };
	};
	const request = address("address");
	const { email, happened_at } = request;
	const filed = await viaJob({
		idempotency_key: randomUUID(),
		kind: "email",
		email,
		happened_at,
		about: [{ party_id: CASEY }],
	});
	assert.equal(filed.status, 201);
	const result = await intake(request);
	assert.equal(result.status, 201);
	assert.equal(result.body.activity_id, filed.body.activity_id);
	await assertRows(
		1,
		`select from party p join lead_email_source s on s.party_id = p.id where s.activity_id = $1
			and p.city = 'Sample City' and s.prospect->>'street_address' = '42 Example Way'`,
		result.body.activity_id,
	);
	const distinct = await intake(address("new-address"));
	assert.equal(distinct.status, 201);
	assert.notEqual(distinct.body.party_id, result.body.party_id);
	await db.query("begin");
	await db.query("select set_config('engine.user_id', $1, true)", [DELL]);
	await db.query("select merge_party($1, $2)", [
		distinct.body.party_id,
		result.body.party_id,
	]);
	await db.query("commit");
	await assertRows(
		2,
		`select from lead_email_attention n join lead_email_source s using (party_id)
			where n.party_id = $1 and n.activity_id = $2`,
		result.body.party_id,
		result.body.activity_id,
	);
});

test("ineligible email leaves evidence only", async (t) => {
	const { rowCount: proposals } = await db.query("select from proposal");
	const internal = notice("internal");
	internal.email.sender = "joe@example.com";
	const cases = [
		internal,
		{ ...notice("system"), kind: "system" },
		{ ...notice("uncertain"), kind: "uncertain" },
		notice("no-contact", { email: undefined }),
		notice("no-name", { name: undefined }),
		notice("blank-name", { name: " \t\n " }),
		notice("invalid-address", {}, "invalid-address"),
		notice(
			"email-substring",
			{ email: "clinic@example.test" },
			"new.clinic@example.test",
		),
		notice(
			"address-outside-quote",
			{
				email: undefined,
				street_address: "42 Example Way",
				city: "Sample City",
			},
			"42 Example Way, Sample City",
		),
	];
	const partialAddress = notice(
		"address-substring",
		{ email: undefined, street_address: "42 Example Way", city: "Sample City" },
		"142 Example Way, Sample City",
	);
	cases.push({ ...partialAddress, evidence: partialAddress.email.body });
	for (const item of cases) {
		await t.test(item.email.message_id, async () => {
			const result = await intake(item);
			assert.equal(result.status, 422);
			assert.equal(result.body.error, "lead_email_not_eligible");
			assert.ok(result.body.hint);
			await assertRows(
				1,
				`select from lead_email_evidence where message_id = $1 and source->'email'->>'body' = $2
					and not exists (select from email where message_id = $1)`,
				item.email.message_id,
				item.email.body,
			);
		});
	}
	assert.equal((await db.query("select from proposal")).rowCount, proposals);
});

test("the database requires a prospect name and valid contact facts on a lead source", async () => {
	const lead = await intake(notice("source-constraint"));
	assert.equal(lead.status, 201);
	const { party_id } = lead.body;
	const filed = await viaJob(
		mail(
			"source-constraint-followup@example.test",
			{},
			{ about: [{ party_id }] },
		),
	);
	assert.equal(filed.status, 201);
	await db.query("set role engine");
	try {
		for (const facts of [
			{},
			{ name: " \t", email: "clinic@example.test" },
			{ name: "Example Clinic" },
			{ name: "Example Clinic", email: "invalid", phone: "123" },
			{ name: "Example Clinic", street_address: "42 Example Way" },
		]) {
			await assert.rejects(
				db.query(
					`insert into lead_email_source (activity_id, party_id, mailbox_user_id, prospect, evidence)
					values ($1, $2, $3, $4, 'Example body')`,
					[filed.body.activity_id, party_id, JOE, facts],
				),
				{ constraint: "lead_email_source_prospect_identity" },
			);
		}
	} finally {
		await db.query("reset role");
	}
});

test("a failed attention insert rolls back the lead and email, then the same save can succeed", async () => {
	const request = notice("rollback");
	request.kind = "direct_inquiry";
	request.email.sender = request.prospect.email;
	await db.query(
		"alter table lead_email_attention add constraint test_reject check (false) not valid",
	);
	try {
		await refused(intake(request), 422, "database_refused_the_statement", {
			rule: "test_reject",
		});
		await assertRows(
			0,
			"select from party_email where address = $1",
			request.prospect.email,
		);
		assert.deepEqual(await stored(request.email.message_id), []);
	} finally {
		await db.query(
			"alter table lead_email_attention drop constraint test_reject",
		);
	}
	assert.equal((await intake(request)).status, 201);
});

test("an email links its contacts, never the partners, and lists unknown addresses", async () => {
	const about = [{ deal_id: DEAL }];
	const { status, body } = await viaJob(
		mail("made-up-1@example.com", {}, { about }),
	);
	assert.deepEqual(
		[status, body],
		[
			201,
			{
				activity_id: body.activity_id,
				existing: false,
				about: [...about, { party_id: CASEY }],
				unmatched: ["pat@example.net"],
			},
		],
	);
	assert.deepEqual(await stored("made-up-1@example.com"), [
		{
			sender: "casey@example.com",
			body: "Example body",
			from_party_id: CASEY,
			changed_by_job: "mail_capture",
			changed_for_user_id: JOE,
		},
	]);
});

test("the other mailbox's copy adds its links to the stored email", async () => {
	const copy = () => viaJob(mail("made-up-2@example.com"));
	const copies = await Promise.all([copy(), copy()]);
	const existing = copies.map(({ body }) => body.existing).sort();
	assert.deepEqual(existing, [false, true]);
	const about = [{ deal_id: DEAL }];
	const later = mail("made-up-2@example.com", { body: "Other" }, { about });
	const answer = await viaJob(later);
	assert.deepEqual(answer.body, {
		activity_id: copies[0]?.body.activity_id,
		existing: true,
		about: [{ party_id: CASEY }, ...about],
		unmatched: ["pat@example.net"],
	});
	const kept = (await stored("made-up-2@example.com")).map((row) => row.body);
	assert.deepEqual(kept, ["Example body"]);
	const retry = await viaJob(later);
	assert.deepEqual(retry.body, { replayed: true, ...answer.body });
	await refused(viaJob({ ...later, about: [] }), 409, "key_reuse");
});

test("an email about no record, or with a padded Message-ID, is not stored", async () => {
	const stranger = { sender: "nobody@example.org", recipients: [] };
	const lost = mail("made-up-3@example.com", stranger);
	await refused(viaJob(lost), 422, "about_nothing");
	for (const message_id of ["", " made-up-4@example.com"])
		await refused(viaJob(mail(message_id)), 422, "message_id_invalid");
	assert.deepEqual(await stored("made-up-3@example.com"), []);
});

test("an omitted conversation id and null replay the same email save", async () => {
	const message = mail("missing-conversation@example.test");
	const first = await viaJob(message);
	assert.equal(first.status, 201);
	const retry = await viaJob({
		...message,
		email: { ...message.email, conversation_id: null },
	});
	assert.deepEqual(retry.body, { replayed: true, ...first.body });
	const { rows } = await db.query(
		"select conversation_id from email where activity_id = $1",
		[first.body.activity_id],
	);
	assert.deepEqual(rows, [{ conversation_id: null }]);
});

test("a partner's call is stamped with them and its records must exist", async () => {
	const call = note({ kind: "call", reached: true });
	const { status, body } = await viaApp(call);
	assert.deepEqual([status, body.about, body.unmatched], [201, call.about, []]);
	const { rows } = await db.query(
		"select reached, changed_by_user_id from activity where id = $1",
		[body.activity_id],
	);
	assert.deepEqual(rows, [{ reached: true, changed_by_user_id: JOE }]);
	const fields = (name: string) => ({ fields: [name] });
	const refusals: [object, number, string, object][] = [
		[{ about: undefined }, 400, "missing_required", fields("about")],
		[{ reached: false }, 400, "invalid_field_value", fields("reached")],
		[
			{ about: [{ property_id: MISSING }] },
			404,
			"not_found",
			{
				about: [{ property_id: MISSING }],
			},
		],
		[
			{ from_party_id: MISSING },
			422,
			"database_refused_the_statement",
			{
				rule: "activity_from_party_id_fkey",
			},
		],
	];
	for (const [more, ...refusal] of refusals)
		await refused(viaApp(note(more)), ...refusal);
});

test("an activity without a time gets the save time and replays the same row", async () => {
	const summary = "Example just now";
	const args = note({
		kind: "call",
		happened_at: undefined,
		summary,
	});
	const {
		rows: [before],
	} = await db.query("select now() as time");
	const first = await viaApp(args);
	assert.equal(first.status, 201);
	assert.deepEqual(await viaApp(args), {
		status: 201,
		body: { ...first.body, replayed: true },
	});
	const { rows } = await db.query(
		`select id, happened_at >= $1 and happened_at <= now() as saved_now
		 from activity where summary = $2`,
		[before.time, summary],
	);
	assert.deepEqual(rows, [{ id: first.body.activity_id, saved_now: true }]);
	await refused(
		viaApp({ ...args, happened_at: "2026-01-01T12:00:00Z" }),
		409,
		"key_reuse",
	);
	await refused(
		viaJob({ ...mail("missing-time@example.test"), happened_at: undefined }),
		400,
		"missing_required",
		{ fields: ["happened_at"] },
	);
	await refused(
		viaApp({
			...args,
			kind: "meeting",
			calendar_review_key: "0123456789abcdef",
		}),
		400,
		"missing_required",
		{ fields: ["happened_at"] },
	);
});

test("filing adds links to a stored activity and keeps the ones there", async () => {
	const { activity_id } = (await viaJob(note())).body;
	const about = [{ party_id: CASEY }, { deal_id: DEAL }];
	const filing = { idempotency_key: randomUUID(), about };
	assert.deepEqual(
		await viaJob(filing, MAIL_CAPTURE, `/${activity_id}/about`),
		{
			status: 200,
			body: { activity_id, about },
		},
	);
	const elsewhere = `/${MISSING}/about`;
	await refused(viaJob(filing, MAIL_CAPTURE, elsewhere), 409, "key_reuse");
	const another = { ...filing, idempotency_key: randomUUID() };
	await refused(viaJob(another, MAIL_CAPTURE, elsewhere), 404, "not_found");
});

test("a job names itself and a partner the engine knows", async () => {
	for (const job of [{}, { "Engine-Job": "made_up_job" }])
		await refused(viaJob(note(), job), 403, "unknown_job");
	const pat = { ...MAIL_CAPTURE, "Engine-For-User": "pat" };
	await refused(viaJob(note(), pat), 422, "actor_not_provisioned");
	assert.equal((await ask("/jobs/activities", note(), {})).status, 401);
});

const otherMailbox = { ...MAIL_CAPTURE, "Engine-For-User": "dell" };

test("a calendar review saves one meeting per partner and replays each request", async () => {
	const calendar_review_key = "0123456789abcdef";
	const meeting = note({
		kind: "meeting",
		calendar_review_key,
		summary: "Example meeting",
		about: [{ deal_id: DEAL }],
	});
	const first = await viaApp(meeting);
	const { activity_id } = first.body;
	assert.deepEqual(first, {
		status: 201,
		body: { activity_id, existing: false, about: meeting.about, unmatched: [] },
	});
	assert.deepEqual((await viaApp(meeting)).body, {
		...first.body,
		replayed: true,
	});

	const second = note({
		...meeting,
		idempotency_key: randomUUID(),
		summary: "Changed summary",
		about: [{ party_id: CASEY }],
	});
	const existing = await viaApp(second);
	assert.deepEqual(existing, {
		status: 201,
		body: { ...first.body, existing: true },
	});
	assert.deepEqual((await viaApp(second)).body, {
		...existing.body,
		replayed: true,
	});

	const other = await viaJob(
		{ ...meeting, idempotency_key: randomUUID() },
		otherMailbox,
	);
	assert.equal(other.status, 201);
	assert.equal(other.body.existing, false);
	assert.notEqual(other.body.activity_id, activity_id);
	const { rows } = await db.query(
		`select id, kind, summary, calendar_review_user_id from activity
		where calendar_review_key = $1 order by calendar_review_user_id`,
		[calendar_review_key],
	);
	assert.deepEqual(rows, [
		{
			id: activity_id,
			kind: "meeting",
			summary: "Example meeting",
			calendar_review_user_id: JOE,
		},
		{
			id: other.body.activity_id,
			kind: "meeting",
			summary: "Example meeting",
			calendar_review_user_id: DELL,
		},
	]);
});

test("only a meeting can carry a 16-character lowercase hex calendar review key", async () => {
	const fields = { fields: ["calendar_review_key"] };
	await refused(
		viaApp(note({ calendar_review_key: "0123456789abcdef" })),
		400,
		"invalid_field_value",
		fields,
	);
	for (const calendar_review_key of [
		null,
		"0123456789abcde",
		"0123456789abcdeg",
		"0123456789ABCDEF",
	])
		await refused(
			viaApp(note({ kind: "meeting", calendar_review_key })),
			400,
			"invalid_field_value",
			fields,
		);
});

test("conversation id, sender name and ordered recipients survive a second mailbox copy", async () => {
	const message = mail("router-facts@example.com", {
		sender_name: "Casey Display",
		conversation_id: "Opaque-Outlook-Id=",
	});
	const first = await viaJob(message);
	const second = await viaJob(
		mail("router-facts@example.com", {
			sender_name: "Changed",
			conversation_id: "Different-Outlook-Id",
			subject: "Changed",
			body: "Changed",
			recipients: [],
		}),
		otherMailbox,
	);
	assert.equal(second.body.activity_id, first.body.activity_id);
	assert.equal(second.body.existing, true);
	const { rows } = await db.query(
		`select sender, sender_name, subject, body, conversation_id from email where activity_id = $1`,
		[first.body.activity_id],
	);
	assert.deepEqual(rows, [
		{
			sender: "casey@example.com",
			sender_name: "Casey Display",
			subject: "Example subject",
			body: "Example body",
			conversation_id: "Opaque-Outlook-Id=",
		},
	]);
	assert.deepEqual(
		(
			await db.query(
				`select address, kind from email_recipient where activity_id = $1 order by position`,
				[first.body.activity_id],
			)
		).rows,
		message.email.recipients,
	);
	assert.deepEqual(
		(
			await db.query(
				`select user_id from email_mailbox where activity_id = $1 order by user_id`,
				[first.body.activity_id],
			)
		).rows,
		[{ user_id: JOE }, { user_id: DELL }],
	);
	await refused(
		viaJob(mail("invalid-conversation@example.com", { conversation_id: 42 })),
		400,
		"invalid_field_value",
		{ fields: ["email"] },
	);
	await refused(
		viaJob(
			mail("invalid-kind@example.com", {
				recipients: [{ address: "joe@example.com", kind: "bcc" }],
			}),
		),
		400,
		"invalid_field_value",
		{ fields: ["email"] },
	);
});

const splitText = {
	authored: "Thanks for the update.\n\nFriday works for me.",
	history: "From: Casey Example\nIs Friday open?",
};

async function savedEmailText(activityId: unknown) {
	const { rows } = await db.query<{
		body: string;
		authored: string | null;
		history: string | null;
	}>("select body, authored, history from email where activity_id = $1", [
		activityId,
	]);
	assert.equal(rows.length, 1);
	return rows[0];
}

for (const [form, history] of [
	["with quoted history", splitText.history],
	["without quoted history", ""],
] as const) {
	test(`lead intake stores the sender's words ${form} beside the original body`, async () => {
		const source = notice(
			history ? "lead-with-history" : "lead-without-history",
		);
		const authored = `${source.email.body}\n\nFriday works for me.`;
		const body = history ? `${authored}\n\n${history}` : authored;
		const request = {
			...source,
			email: { ...source.email, body, authored, history },
		};
		const first = await intake(request);
		assert.equal(first.status, 201);
		const replay = await intake(request);
		assert.equal(replay.body.replayed, true);
		assert.equal(replay.body.activity_id, first.body.activity_id);
		assert.equal(replay.body.party_id, first.body.party_id);
		const retry = await intake({ ...request, idempotency_key: randomUUID() });
		assert.equal(retry.status, 200);
		assert.equal(retry.body.activity_id, first.body.activity_id);
		assert.equal(retry.body.party_id, first.body.party_id);
		assert.deepEqual(await savedEmailText(first.body.activity_id), {
			body,
			authored,
			history,
		});
		await assertRows(
			1,
			`select from lead_email_source s join email e using (activity_id)
			where e.message_id = $1`,
			request.email.message_id,
		);
		await assertRows(
			1,
			`select from party_role r join party_email e using (party_id)
			where r.role = 'lead' and e.address = $1`,
			request.prospect.email,
		);
	});
}

for (const field of ["authored", "history"] as const) {
	test(`lead intake refuses NUL in email.${field}`, async () => {
		const request = notice(`lead-nul-${field}`);
		await refused(
			intake({
				...request,
				email: { ...request.email, ...splitText, [field]: "Text\0with NUL" },
			}),
			400,
			"invalid_field_value",
			{ fields: ["email"] },
		);
		assert.deepEqual(await stored(request.email.message_id), []);
	});
}

test("email split: a legacy request saves the unsplit body with no pair", async () => {
	const request = mail("legacy-email@example.test");
	const answer = await viaJob(request);
	assert.equal(answer.status, 201);
	assert.deepEqual(await savedEmailText(answer.body.activity_id), {
		body: request.email.body,
		authored: null,
		history: null,
	});
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	try {
		await assert.rejects(
			db.query("update email set authored = $2 where activity_id = $1", [
				answer.body.activity_id,
				splitText.authored,
			]),
			{ code: "23514", constraint: "email_authored_history_pair" },
		);
	} finally {
		await db.query("rollback");
	}
});

test("email split: a complete request stores both parts beside the body", async () => {
	const body = `${splitText.authored}\n\n${splitText.history}`;
	const answer = await viaJob(
		mail("complete-email@example.test", { body, ...splitText }),
	);
	assert.equal(answer.status, 201);
	assert.deepEqual(await savedEmailText(answer.body.activity_id), {
		body,
		...splitText,
	});
	await assertRows(
		1,
		`select from activity a where id = $1
		and (activity_entry(a)->'email'->>'body') = $2
		and not ((activity_entry(a)->'email') ?| array['authored', 'history'])`,
		answer.body.activity_id,
		body,
	);
});

test("email split: either part can be an empty string", async () => {
	const pairs = [
		{ authored: "", history: splitText.history },
		{ authored: splitText.authored, history: "" },
	];
	for (const [index, pair] of pairs.entries()) {
		const body = pair.authored || pair.history;
		const answer = await viaJob(
			mail(`empty-part-${index}@example.test`, { body, ...pair }),
		);
		assert.equal(answer.status, 201);
		assert.deepEqual(await savedEmailText(answer.body.activity_id), {
			body,
			...pair,
		});
	}
});

test("email split: a partial or non-string pair is refused", async () => {
	const messageId = "partial-split@example.test";
	const idempotency_key = randomUUID();
	for (const fields of [
		{ authored: splitText.authored },
		{ history: splitText.history },
		{ authored: null, history: null },
		{ authored: splitText.authored, history: 42 },
	]) {
		await refused(
			viaJob(mail(messageId, fields, { idempotency_key })),
			400,
			"invalid_field_value",
			{ fields: ["email"] },
		);
	}
	assert.deepEqual(await stored(messageId), []);
	const corrected = await viaJob(
		mail(messageId, splitText, { idempotency_key }),
	);
	assert.equal(corrected.status, 201);
});

test("email split: a retry with a new key keeps the first stored pair", async () => {
	const messageId = "split-retry@example.test";
	const pair = { authored: "", history: splitText.history };
	const body = pair.history;
	const first = await viaJob(mail(messageId, { body, ...pair }));
	assert.equal(first.status, 201);
	const retry = await viaJob(
		mail(messageId, {
			body: "Replacement",
			authored: "Replacement",
			history: "",
		}),
	);
	assert.equal(retry.status, 201);
	assert.equal(retry.body.existing, true);
	assert.equal(retry.body.activity_id, first.body.activity_id);
	assert.deepEqual(await savedEmailText(first.body.activity_id), {
		body,
		...pair,
	});
});

test("email split: only a new mailbox capture fills a preview's missing pair", async () => {
	const messageId = "split-second-mailbox@example.test";
	const preview = "Thanks for the update.";
	const first = await viaJob(mail(messageId, { body: preview }));
	assert.equal(first.status, 201);
	const retry = await viaJob(
		mail(messageId, {
			body: "Same mailbox text",
			authored: "Same mailbox text",
			history: "",
		}),
	);
	assert.equal(retry.status, 201);
	assert.equal(retry.body.existing, true);
	assert.equal(retry.body.activity_id, first.body.activity_id);
	assert.deepEqual(await savedEmailText(first.body.activity_id), {
		body: preview,
		authored: null,
		history: null,
	});
	const second = await viaJob(
		mail(messageId, {
			body: `${splitText.authored}\n\n${splitText.history}`,
			...splitText,
		}),
		otherMailbox,
	);
	assert.equal(second.status, 201);
	assert.equal(second.body.existing, true);
	assert.equal(second.body.activity_id, first.body.activity_id);
	assert.deepEqual(await savedEmailText(first.body.activity_id), {
		body: preview,
		...splitText,
	});
	await assertRows(
		2,
		"select from email_mailbox where activity_id = $1 and user_id in ($2, $3)",
		first.body.activity_id,
		JOE,
		DELL,
	);
});

test("email split: a preview-only capture stores no pair", async () => {
	const preview = "Thanks for the update…";
	const answer = await viaJob(
		mail("preview-only@example.test", { body: preview }),
	);
	assert.equal(answer.status, 201);
	assert.deepEqual(await savedEmailText(answer.body.activity_id), {
		body: preview,
		authored: null,
		history: null,
	});
});

test("an email refuses recipient fields it does not store", async () => {
	const message_id = "recipient-field@example.com";
	await refused(
		viaJob(
			mail(message_id, {
				recipients: [
					{ address: "joe@example.com", kind: "to", name: "Joe Example" },
				],
			}),
		),
		400,
		"invalid_field_value",
		{ fields: ["email"] },
	);
	assert.deepEqual(await stored(message_id), []);
});

const filedEmails = (query: string, job = otherMailbox) =>
	jobRequest(`filed-emails${query}`, undefined, job);

test("filed mail pages by id without an age limit and only for its mailbox", async () => {
	const expected = [];
	for (const outgoing of [false, true]) {
		const { body } = await viaJob(
			mail(
				`filed-${outgoing}@example.com`,
				{ sender: outgoing ? "joe@example.com" : "casey@example.com" },
				{ happened_at: "2001-01-01T00:00:00Z", about: [{ deal_id: DEAL }] },
			),
			otherMailbox,
		);
		expected.push({
			activity_id: body.activity_id,
			deal_ids: [DEAL],
			outgoing,
			body: "Example body",
			happened_at: "2001-01-01T00:00:00.000Z",
		});
	}
	await viaJob(
		mail("other-mailbox@example.com", {}, { about: [{ deal_id: DEAL }] }),
	);
	await viaJob(mail("no-deal@example.com"), otherMailbox);
	expected.sort((a, b) =>
		String(a.activity_id).localeCompare(String(b.activity_id)),
	);
	const first = await filedEmails("?after=&limit=1");
	assert.equal(first.status, 200);
	assert.deepEqual(first.body, {
		emails: [expected[0]],
		next_cursor: expected[0]?.activity_id,
	});
	const second = await filedEmails(`?after=${first.body.next_cursor}&limit=1`);
	assert.deepEqual(second.body, { emails: [expected[1]], next_cursor: null });
	assert.deepEqual(
		(await filedEmails(`?after=${expected[1]?.activity_id}&limit=1`)).body,
		{ emails: [], next_cursor: null },
	);
	for (const [query, fields] of [
		["?after=bad", ["after"]],
		["?limit=0", ["limit"]],
		["?limit=1.5", ["limit"]],
		["?after=bad&limit=0", ["after", "limit"]],
	] as const)
		await refused(filedEmails(query), 400, "invalid_field_value", { fields });
	assert.equal(
		(await filedEmails("", { ...otherMailbox, "Engine-For-User": "unknown" }))
			.status,
		422,
	);
	assert.equal(
		(await filedEmails("", { ...otherMailbox, "Engine-Job": "unknown" }))
			.status,
		403,
	);
	assert.equal((await ask("/jobs/filed-emails", undefined, {})).status, 401);
});
