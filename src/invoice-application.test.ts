import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, save, request: read } = doorTest();
const user = { user: "alex" };
const job = { job: "lead_stage", for_user: "alex" };
const owner = randomUUID();
const partner = randomUUID();
const client = randomUUID();
const invoiceDate = "2020-04-01";

before(async () => {
	await setup();
	await db.query(`begin; select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${owner}', 'person', 'Alex Example'), ('${partner}', 'person', 'Blair Example'),
			('${client}', 'company', 'Example Dental');
		insert into app_user (id, slug) values ('${owner}', 'alex'), ('${partner}', 'blair');
		insert into commission_tier (user_id, from_deal, partner_user_id, closing_share)
			values ('${owner}', 1, '${partner}', 0.8);
		insert into role (slug, label) values ('client', 'Client');
		insert into how_found (slug, label) values ('referral', 'Referral');
		update party set how_found = 'referral' where id = '${client}';
		insert into party_role (party_id, role) values ('${client}', 'client');
		insert into phase (slug, label) values ('closing', 'Closing'), ('closed', 'Closed');
		insert into invoice_mailbox values ('invoices@example.test');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function addInvoice(
	invoiceId: string,
	dealName: string,
	sender = "invoices@example.test",
) {
	await db.query(
		`insert into invoice_email (id, evidence_ref, sender, deal_name, client_name, occurred_at, email_date)
		values ($1, 'local-mail:' || $1::uuid::text, $2, $3, 'example dental', '2020-04-01T23:30:00-05:00', $4)`,
		[invoiceId, sender, dealName, invoiceDate],
	);
}

async function fixture() {
	const [deal, payment, invoice] = [randomUUID(), randomUUID(), randomUUID()];
	const name = `Example Deal ${deal}`;
	await db.query("begin; select set_config('engine.job', 'old_system', true)");
	await db.query(
		"insert into deal (id, name, owner_user_id) values ($1, $2, $3)",
		[deal, name, owner],
	);
	await db.query(
		"insert into deal_party (deal_id, party_id, role) values ($1, $2, 'client')",
		[deal, client],
	);
	await db.query(
		"insert into deal_phase_change (deal_id, happened_at, phase) values ($1, '2020-03-01', 'closing')",
		[deal],
	);
	await db.query("insert into commission (deal_id, gross) values ($1, 1000)", [
		deal,
	]);
	await db.query(
		"insert into commission_payment (id, deal_id, amount) values ($1, $2, 1000)",
		[payment, deal],
	);
	await addInvoice(invoice, name.toLowerCase());
	await db.query("commit");
	return { deal, payment, invoice, name };
}

const applyPath = (id: string) => `invoice-emails/${id}/apply`;
const undoPath = (id: string) => `invoice-emails/${id}/undo`;
const key = () => ({ idempotency_key: randomUUID() });

async function trackerEntries() {
	const response = await read(
		user,
		"invoices",
		{ method: "GET" },
		{
			INVOICES_READ_SCHEMA: "next",
		},
	);
	assert.equal(response.status, 200);
	const tracker = await response.json();
	assert.ok(tracker && typeof tracker === "object" && "entries" in tracker);
	return tracker.entries;
}

async function records(deal: string, payment: string) {
	return (
		await db.query(
			`select invoiced_on::text, received_on::text, changed_by_job, changed_for_user_id, changed_by_user_id,
			array(select phase from deal_phase_change where deal_id = $1 order by happened_at) as phases
		from commission_payment where id = $2`,
			[deal, payment],
		)
	).rows[0];
}

test("lead stages close and date an invoice once, and a partner can undo both changes", async () => {
	const { deal, payment, invoice, name } = await fixture();
	const target = { deal_id: deal, payment_id: payment };
	const request = { ...key(), ...target };
	const applied = {
		invoice_id: invoice,
		...target,
		status: "applied",
		application_id: null,
	};
	assert.deepEqual(await save(job, applyPath(invoice), request), [
		200,
		applied,
	]);
	assert.deepEqual(await save(job, applyPath(invoice), request), [
		200,
		{ replayed: true, ...applied },
	]);
	const [reused, refusal] = await save(job, applyPath(invoice), {
		...request,
		payment_id: randomUUID(),
	});
	assert.deepEqual([reused, refusal.error], [409, "key_reuse"]);
	assert.deepEqual(await records(deal, payment), {
		invoiced_on: invoiceDate,
		received_on: null,
		changed_by_job: "lead_stage",
		changed_for_user_id: owner,
		changed_by_user_id: null,
		phases: ["closing", "closed"],
	});
	assert.partialDeepStrictEqual(await trackerEntries(), [
		{
			deal_id: deal,
			commission_id: payment,
			status: "invoiced",
			gross_amount: "1000.00",
			commission_invoiced_on: invoiceDate,
		},
	]);
	const stamps = await db.query(
		`select changed_by_job, changed_for_user_id
		from deal_phase_change where deal_id = $1 and phase = 'closed'
		union all select changed_by_job, changed_for_user_id from invoice_email where id = $2`,
		[deal, invoice],
	);
	assert.deepEqual(
		stamps.rows,
		Array(2).fill({ changed_by_job: "lead_stage", changed_for_user_id: owner }),
	);

	const undo = key();
	const undone = { ...applied, status: "undone" };
	assert.equal((await save(job, undoPath(invoice), undo))[0], 404);
	assert.deepEqual(await save(user, undoPath(invoice), undo), [200, undone]);
	assert.deepEqual(await trackerEntries(), []);
	assert.deepEqual(await save(user, undoPath(invoice), undo), [
		200,
		{ replayed: true, ...undone },
	]);
	const [repeat, repeated] = await save(job, applyPath(invoice), {
		...key(),
		...target,
	});
	assert.deepEqual(
		[repeat, repeated.rule],
		[422, "invoice_email_status_moves"],
	);

	const resend = randomUUID();
	await db.query(
		"begin; select set_config('engine.job', 'mail_capture', true)",
	);
	await addInvoice(resend, name);
	await db.query("commit");
	assert.deepEqual(
		await save(job, applyPath(resend), { ...key(), ...target }),
		[
			200,
			{
				invoice_id: resend,
				...target,
				status: "attached",
				application_id: invoice,
			},
		],
	);
	assert.deepEqual(await records(deal, payment), {
		invoiced_on: null,
		received_on: null,
		changed_by_job: null,
		changed_for_user_id: null,
		changed_by_user_id: owner,
		phases: ["closing", "closed", "closing"],
	});
});

test("doubtful or invalid applications leave the phase and payment alone", async () => {
	const { deal, payment, invoice, name } = await fixture();
	const target = { deal_id: deal, payment_id: payment };
	const request = { ...key(), ...target };
	assert.equal((await save(user, applyPath(invoice), request))[0], 404);
	const [wrongJob, refused] = await save(
		{ job: "mail_capture", for_user: "alex" },
		applyPath(invoice),
		request,
	);
	assert.deepEqual([wrongJob, refused.error], [403, "unknown_job"]);
	const [missing, invalid] = await save(job, applyPath(invoice), {
		...key(),
		deal_id: deal,
	});
	assert.deepEqual(
		[missing, invalid.error, invalid.fields],
		[400, "missing_required", ["payment_id"]],
	);
	assert.equal((await save(job, applyPath(randomUUID()), request))[0], 404);

	const doubtful = randomUUID();
	await db.query(
		"begin; select set_config('engine.job', 'mail_capture', true)",
	);
	await addInvoice(doubtful, name, "other@example.test");
	await db.query("select set_config('engine.job', 'old_system', true)");
	await db.query(
		"update commission_payment set due_on = '2020-03-31' where id = $1",
		[payment],
	);
	await db.query("commit");
	const before = await records(deal, payment);
	const [untrusted, untrustedAnswer] = await save(job, applyPath(doubtful), {
		...key(),
		...target,
	});
	assert.deepEqual(
		[untrusted, untrustedAnswer.rule],
		[422, "invoice_email_needs_user"],
	);
	const [earlyDue, earlyDueAnswer] = await save(
		job,
		applyPath(invoice),
		request,
	);
	assert.deepEqual(
		[earlyDue, earlyDueAnswer.rule],
		[422, "commission_payment_dates_in_order"],
	);
	assert.deepEqual(await records(deal, payment), before);
	assert.deepEqual(
		(
			await db.query("select status from invoice_email where id in ($1, $2)", [
				invoice,
				doubtful,
			])
		).rows,
		[{ status: "captured" }, { status: "captured" }],
	);
});

test("undo refuses later invoice-date work even if the date was changed back", async () => {
	const { deal, payment, invoice } = await fixture();
	assert.equal(
		(
			await save(job, applyPath(invoice), {
				...key(),
				deal_id: deal,
				payment_id: payment,
			})
		)[0],
		200,
	);
	await db.query("begin");
	await db.query("select set_config('engine.user_id', $1, true)", [owner]);
	await db.query(
		"update commission_payment set invoiced_on = '2020-04-02' where id = $1",
		[payment],
	);
	await db.query(
		"update commission_payment set invoiced_on = $2 where id = $1",
		[payment, invoiceDate],
	);
	await db.query("commit");
	const before = await records(deal, payment);
	const [status, refusal] = await save(user, undoPath(invoice), key());
	assert.deepEqual([status, refusal.rule], [422, "invoice_email_undo_current"]);
	assert.deepEqual(await records(deal, payment), before);
});
