import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, mock, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { copyTest } from "../test-copy.ts";
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
			CARR: { fetch: async () => Response.json(session) },
		},
	);
	const answer = (await response.json()) as Answer["body"];
	return { status: response.status, body: answer };
}
const MAIL_CAPTURE = { "Engine-Job": "mail_capture", "Engine-For-User": "joe" };
const viaJob = async (body: object, job: object = MAIL_CAPTURE, path = "") =>
	ask(`/jobs/activities${path}`, body, {
		"Cf-Access-Jwt-Assertion": await new SignJWT({})
			.setProtectedHeader({ alg: "RS256", kid: "made-up-kid" })
			.setIssuer(TEAM)
			.setAudience("made-up-jobs")
			.setExpirationTime("5 minutes")
			.sign(access.privateKey),
		...job,
	});
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
const stored = async (message_id: string) =>
	(
		await db.query(
			`select e.sender, e.body, a.from_party_id, a.changed_by_job, a.changed_for_user_id
			from email e join activity a on a.id = e.activity_id where e.message_id = $1`,
			[message_id],
		)
	).rows;

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

async function filedEmails(query: string, job = otherMailbox) {
	return ask(`/jobs/filed-emails${query}`, undefined, {
		"Cf-Access-Jwt-Assertion": await new SignJWT({})
			.setProtectedHeader({ alg: "RS256", kid: "made-up-kid" })
			.setIssuer(TEAM)
			.setAudience("made-up-jobs")
			.setExpirationTime("5 minutes")
			.sign(access.privateKey),
		...job,
	});
}

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
