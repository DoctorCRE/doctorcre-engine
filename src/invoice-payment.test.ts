import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { JsonObject } from "./database.d.ts";
import { isChangeId } from "./request-shape.ts";
import { isArguments } from "./save-door.ts";
import { doorTest } from "./test-door.ts";

const { db, setup, cleanup, save, request } = doorTest();
const user = { user: "example-partner" };
const owner = randomUUID();
const partner = randomUUID();
const client = randomUUID();
const path = "invoices/mark-paid";
const invoicedOn = "2020-04-01";
const receivedOn = "2020-04-02";

before(async () => {
	await setup();
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into party (id, kind, name) values
			('${owner}', 'person', 'Example Partner'), ('${partner}', 'person', 'Other Partner'),
			('${client}', 'company', 'Example Clinic');
		insert into app_user (id, slug) values ('${owner}', '${user.user}'), ('${partner}', 'other-partner');
		insert into commission_tier (user_id, from_deal, partner_user_id, closing_share)
			values ('${owner}', 1, '${partner}', 0.75);
		insert into role (slug, label) values ('client', 'Client');
		insert into how_found (slug, label) values ('referral', 'Referral');
		update party set how_found = 'referral' where id = '${client}';
		insert into party_role (party_id, role) values ('${client}', 'client');
		insert into phase (slug, label) values ('closed', 'Closed');
		commit;`);
});
after(async () => {
	await db.query("rollback");
	await cleanup();
});

async function payments() {
	const [deal, dated, undated] = [randomUUID(), randomUUID(), randomUUID()];
	await db.query(`begin;
		select set_config('engine.job', 'old_system', true);
		insert into deal (id, name, owner_user_id) values ('${deal}', 'Example Lease', '${owner}');
		insert into deal_party (deal_id, party_id, role) values ('${deal}', '${client}', 'client');
		insert into deal_phase_change (deal_id, phase, happened_at) values ('${deal}', 'closed', '2020-03-31');
		insert into commission (deal_id, gross) values ('${deal}', 150);
		insert into commission_payment (id, deal_id, amount, invoiced_on, due_on) values
			('${dated}', '${deal}', 100, '${invoicedOn}', '2020-05-01'),
			('${undated}', '${deal}', 50, null, null);
		commit;`);
	return { deal, dated, undated };
}

async function trackerRow(
	id: string,
): Promise<JsonObject & { base_version: number }> {
	const response = await request(
		user,
		"invoices",
		{ method: "GET" },
		{ INVOICES_READ_SCHEMA: "next" },
	);
	assert.equal(response.status, 200);
	const tracker: unknown = await response.json();
	assert.ok(isArguments(tracker) && Array.isArray(tracker.entries));
	const row = tracker.entries
		.filter(isArguments)
		.find((entry) => entry.commission_id === id);
	assert.ok(row);
	const { as_of: _today, base_version, ...entry } = row;
	assert.ok(isChangeId(base_version) && base_version > 0);
	return { ...entry, base_version };
}

test("a partner's retried Mark paid shows one receipt on the refreshed tracker", async () => {
	const { deal, dated, undated } = await payments();
	const before = await trackerRow(dated);
	const other = await trackerRow(undated);
	assert.equal(before.status, "invoiced");
	const args = {
		commission_id: dated,
		base_version: before.base_version,
		received_on: receivedOn,
		idempotency_key: randomUUID(),
	};
	const answers = await Promise.all([
		save(user, path, args),
		save(user, path, args),
	]);
	assert.ok(
		answers.every(([status]) => status === 200),
		JSON.stringify(answers),
	);
	const first = answers.find(([, answer]) => !answer.replayed)?.[1];
	assert.ok(first);
	assert.deepEqual(answers.find(([, answer]) => answer.replayed)?.[1], {
		...first,
		replayed: true,
	});
	assert.partialDeepStrictEqual(first, {
		ok: true,
		id: dated,
		received_on: receivedOn,
	});

	const paid = await trackerRow(dated);
	assert.partialDeepStrictEqual(paid, {
		deal_id: deal,
		status: "received",
		received_on: receivedOn,
		base_version: first.base_version,
		commission_invoiced_on: before.commission_invoiced_on,
		due_on: before.due_on,
		gross_amount: before.gross_amount,
	});
	assert.ok(paid.base_version > before.base_version);
	assert.deepEqual(await trackerRow(undated), other);
	const history = await db.query(
		`select changed_by_user_id, changed_by_job, new_value from change
		where table_name = 'commission_payment' and record = jsonb_build_object('id', $1::uuid)
		and action = 'update'`,
		[dated],
	);
	assert.deepEqual(history.rows, [
		{
			changed_by_user_id: owner,
			changed_by_job: null,
			new_value: { received_on: receivedOn },
		},
	]);
	const [status, refusal] = await save(user, path, {
		...args,
		received_on: "2020-04-03",
	});
	assert.equal(status, 409);
	assert.equal(refusal.error, "key_reuse");
	const [alreadyPaid, duplicate] = await save(user, path, {
		...args,
		base_version: paid.base_version,
		idempotency_key: randomUUID(),
	});
	assert.equal(alreadyPaid, 422);
	assert.equal(duplicate.error, "invoice_not_unpaid");
});

test("Mark paid refuses stale, ineligible and bad-dated payments", async () => {
	const { dated, undated } = await payments();
	const before = await trackerRow(dated);
	const other = await trackerRow(undated);
	const args = {
		commission_id: dated,
		base_version: before.base_version,
		received_on: receivedOn,
	};
	const cases = [
		[{ base_version: 0 }, 409, "version_conflict"],
		[{ base_version: before.base_version - 1 }, 409, "version_conflict"],
		[
			{ commission_id: undated, base_version: other.base_version },
			422,
			"invoice_not_unpaid",
		],
		[{ commission_id: randomUUID() }, 404, "invoice_not_found"],
		[{ received_on: "2020-03-31" }, 422, "payment_date_out_of_range"],
		[{ received_on: "0000-01-01" }, 422, "payment_date_out_of_range"],
		[{ received_on: "9999-01-01" }, 422, "payment_date_out_of_range"],
		[{ received_on: "2020-02-30" }, 400, "invalid_field_value"],
	] as const;
	for (const [change, expected, error] of cases) {
		const [status, refusal] = await save(user, path, {
			...args,
			...change,
			idempotency_key: randomUUID(),
		});
		assert.equal(status, expected, String(refusal.error));
		assert.equal(refusal.error, error);
	}
	const [jobStatus] = await save({ job: "agent", for_user: user.user }, path, {
		...args,
		idempotency_key: randomUUID(),
	});
	assert.equal(jobStatus, 404);
	assert.deepEqual(await trackerRow(dated), before);
	assert.deepEqual(await trackerRow(undated), other);
});

test("only one Mark paid save can use a payment version", {
	timeout: 10000,
}, async (t) => {
	const { dated } = await payments();
	const { base_version } = await trackerRow(dated);
	await db.query("begin");
	await db.query("select id from commission_payment where id = $1 for update", [
		dated,
	]);
	const markPaid = (received_on: string) =>
		save(user, path, {
			commission_id: dated,
			base_version,
			received_on,
			idempotency_key: randomUUID(),
		});
	const pending = Promise.all([markPaid(receivedOn), markPaid("2020-04-03")]);
	try {
		// Hold both saves at the payment until each has reached the database lock.
		let waiting = 0;
		while (waiting < 2) {
			t.signal.throwIfAborted();
			await db.query("select pg_stat_clear_snapshot()");
			const { rows } = await db.query<{
				waiting: number;
			}>(`select count(*)::int as waiting
				from pg_stat_activity where datname = current_database()
				and wait_event_type = 'Lock' and usename like 'door_%'`);
			waiting = rows[0]?.waiting ?? 0;
		}
	} finally {
		await db.query("rollback");
		await pending;
	}
	const answers = await pending;
	answers.sort(([first], [second]) => first - second);
	assert.deepEqual(
		answers.map(([status]) => status),
		[200, 409],
	);
	const [[, saved], [, refusal]] = answers;
	assert.partialDeepStrictEqual(refusal, {
		error: "version_conflict",
		current_version: saved.base_version,
	});
	assert.partialDeepStrictEqual(await trackerRow(dated), {
		base_version: saved.base_version,
		received_on: saved.received_on,
	});
});
