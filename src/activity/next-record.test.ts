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
			CARR: { fetch: async () => Response.json(session) },
		},
	);
	const answer = (await response.json()) as Answer["body"];
	return { status: response.status, body: answer };
}
const MAIL_CAPTURE = { "Engine-Job": "mail_capture", "Engine-For-User": "joe" };
async function jobPost(path: string, body: object, job: object) {
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
	jobPost(`activities${path}`, body, job);
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

const intake = (body: object, user = "joe") =>
	jobPost("leads/email-intake", body, {
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

test("a notice files the named prospect and the exact source once for both mailboxes", async () => {
	const request = notice("Intake-A");
	const first = await intake(request);
	assert.equal(first.status, 201);
	assert.equal((await intake(request)).body.replayed, true);
	const second = await intake(
		{ ...request, idempotency_key: randomUUID() },
		"dell",
	);
	assert.equal(second.status, 200);
	assert.equal(second.body.party_id, first.body.party_id);
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
	await assertRows(0, "select from proposal");
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
