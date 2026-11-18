import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, save } = doorTest();
const path = "invoice-emails";
const mail = { job: "mail_capture", for_user: "alex" };
const nightly = { job: "lead_stage" };
const owner = randomUUID();
const partner = randomUUID();
const client = randomUUID();
const deal = randomUUID();
const payment = randomUUID();
const sender = "invoices@example.test";
const occurred_at = "2020-04-01T23:30:00-05:00";
const deal_name = "example  DEal";
const client_name = "example dental";
const request = (fields = {}) => ({
	idempotency_key: randomUUID(),
	evidence_ref: `local-mail:${randomUUID()}`,
	sender,
	deal_name,
	client_name,
	occurred_at,
	...fields,
});
const list = () => save(nightly, path, {}, "GET");

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${owner}', 'person', 'Alex Example'), ('${partner}', 'person', 'Blair Example'),
			('${client}', 'company', 'Example Dental');
		insert into app_user (id, slug) values ('${owner}', 'alex'), ('${partner}', 'blair');
		insert into commission_tier (user_id, from_deal, partner_user_id, closing_share)
			values ('${partner}', 1, '${owner}', 0.8);
		insert into role (slug, label) values ('client', 'Client');
		insert into how_found (slug, label) values ('referral', 'Referral');
		update party set how_found = 'referral' where id = '${client}';
		insert into party_role (party_id, role) values ('${client}', 'client');
		insert into phase (slug, label) values ('closing', 'Closing'), ('closed', 'Closed');
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Deal', '${partner}');
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${client}', 'client');
		insert into deal_phase_change (deal_id, happened_at, phase) values ('${deal}', '2020-03-01', 'closing');
		insert into commission (deal_id, gross) values ('${deal}', 1000);
		insert into commission_payment (id, deal_id, amount) values ('${payment}', '${deal}', 1000);
		insert into invoice_mailbox (address) values ('${sender}');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

test("only the mail job for a provisioned mailbox partner can capture invoice facts", async () => {
	const evidence = request();
	for (const [caller, args, status, error, fields] of [
		[nightly, evidence, 403, "unknown_job"],
		[{ job: "mail_capture" }, evidence, 422, "actor_not_provisioned"],
		[
			{ ...mail, for_user: "unprovisioned" },
			evidence,
			422,
			"actor_not_provisioned",
		],
		[
			mail,
			{ ...evidence, evidence_ref: " " },
			400,
			"invalid_field_value",
			["evidence_ref"],
		],
		[
			mail,
			{ ...evidence, occurred_at: "2020-02-31T00:00:00Z" },
			400,
			"invalid_field_value",
			["occurred_at"],
		],
		[
			mail,
			{ ...evidence, amount: 100, payment_id: payment },
			400,
			"invalid_field_value",
			["amount", "payment_id"],
		],
	] as const) {
		const [code, answer] = await save(caller, path, args);
		assert.equal(code, status);
		assert.equal(answer.error, error);
		if (fields) assert.deepEqual(answer.fields, fields);
	}
	assert.equal((await save({ user: "alex" }, path, evidence))[0], 404);
	assert.equal((await save(mail, path, {}, "GET"))[0], 403);
});

test("capture converges by reference and the nightly list gives only captured evidence", async () => {
	const evidence = request();
	const freshKey = { ...evidence, idempotency_key: randomUUID() };
	const [first, second] = await Promise.all([
		save(mail, path, evidence),
		save(mail, path, freshKey),
	]);
	const invoice_id = first[1].invoice_id;
	assert.ok(typeof invoice_id === "string");
	const saved = { invoice_id, evidence_ref: evidence.evidence_ref };
	assert.deepEqual(first, [200, saved]);
	assert.deepEqual(second, first);
	assert.deepEqual(await save(mail, path, evidence), [
		200,
		{ ...saved, replayed: true },
	]);
	const [reused, refusal] = await save(mail, path, {
		...evidence,
		deal_name: "Changed",
	});
	assert.deepEqual([reused, refusal.error], [409, "key_reuse"]);
	assert.deepEqual(
		await save(
			mail,
			path,
			request({
				evidence_ref: evidence.evidence_ref,
				deal_name: "Changed",
			}),
		),
		first,
	);

	const stamp = await db.query(
		`select changed_by_job, changed_for_user_id, changed_by_user_id, deal_id, payment_id
		from invoice_email where evidence_ref = $1`,
		[evidence.evidence_ref],
	);
	assert.deepEqual(stamp.rows, [
		{
			changed_by_job: "mail_capture",
			changed_for_user_id: owner,
			changed_by_user_id: null,
			deal_id: null,
			payment_id: null,
		},
	]);
	const history = await db.query(
		`select action from change where table_name = 'invoice_email' and record = jsonb_build_object('id', $1::uuid)`,
		[invoice_id],
	);
	assert.deepEqual(history.rows, [{ action: "insert" }]);

	const doubtful = request({
		occurred_at: "2020-03-01T12:00:00Z",
		client_name: null,
	});
	const [status, waiting] = await save(mail, path, doubtful);
	assert.equal(status, 200);
	const pending = {
		invoice_id: waiting.invoice_id,
		evidence_ref: doubtful.evidence_ref,
		sender,
		deal_name,
		client_name: null,
		property_address: null,
		occurred_at: "2020-03-01T12:00:00.000Z",
		email_date: "2020-03-01",
		target: null,
	};
	const ready = {
		...saved,
		sender,
		deal_name,
		client_name,
		property_address: null,
		occurred_at: "2020-04-02T04:30:00.000Z",
		email_date: "2020-04-01",
		target: { deal_id: deal, payment_id: payment, for_user: "blair" },
	};
	assert.deepEqual(await list(), [200, { invoices: [pending, ready] }]);
	assert.deepEqual(await list(), [200, { invoices: [pending, ready] }]);

	await db.query("begin; select set_config('engine.job', 'lead_stage', true)");
	await db.query(
		`update invoice_email set status = 'applied', deal_id = $1, payment_id = $2
		where id = $3`,
		[deal, payment, invoice_id],
	);
	await db.query("commit");
	assert.deepEqual(await list(), [200, { invoices: [pending] }]);
	assert.deepEqual(
		await save(mail, path, request({ evidence_ref: evidence.evidence_ref })),
		first,
	);
});
