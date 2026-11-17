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
const [JOE, CASEY, DEAL, MISSING] = [id(1), id(2), id(3), id(4)];
const ORIGIN = "https://engine.example.test";
const TEAM = "https://example.cloudflareaccess.com";
const access = await generateKeyPair("RS256", { extractable: true });

before(async () => {
	const key = await exportJWK(access.publicKey);
	mock.method(globalThis, "fetch", async () =>
		Response.json({ keys: [{ ...key, kid: "made-up-kid" }] }),
	);
	await setup();
	await db.query(`create role ${writer} login; grant engine to ${writer};
		begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values ('${JOE}', 'person', 'Joe Example'), ('${CASEY}', 'person', 'Casey Example');
		insert into app_user (id, slug) values ('${JOE}', 'joe');
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
async function ask(path: string, body: object, headers: object) {
	const url = new URL(connectionString);
	url.username = writer;
	const session = { actor: { slug: "joe", display: "Joe" }, csrf_token: "x" };
	const response = await app.request(
		`${ORIGIN}${path}`,
		{ method: "POST", headers: { ...headers }, body: JSON.stringify(body) },
		{
			ACCESS_TEAM_DOMAIN: TEAM,
			JOBS_ACCESS_AUD: "made-up-jobs",
			DATABASE_WRITER: { connectionString: url.href },
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
